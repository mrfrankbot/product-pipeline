import { Router, type Request, type Response } from 'express';
import { info, error as logError } from '../../utils/logger.js';
import { getCapabilities } from '../capabilities.js';
import {
  listTemplates,
  getTemplateByName,
  upsertTemplate,
  setDefaultForCategory,
  type PhotoRoomParams,
} from '../../services/photo-templates.js';

const router = Router();

const PORT = parseInt(process.env.PORT || '3000', 10);

// ---------------------------------------------------------------------------
// Persistent container state (module-level, survives across chat messages)
// ---------------------------------------------------------------------------
let containerId: string | null = null;
let previousResponseId: string | null = null;

// ---------------------------------------------------------------------------
// Page context helper
// ---------------------------------------------------------------------------
const PAGE_CONTEXT = `Available pages: / (Dashboard), /listings (Products), /listings/:id (Product Detail), /orders (Orders), /mappings (Mappings), /logs (Analytics), /settings (Settings), /images (Image Processor)`;

function buildPageAwareBlock(currentPage?: string): string {
  if (!currentPage) return '';
  return `\nThe user is currently viewing: ${currentPage}\n${PAGE_CONTEXT}\n`;
}

// ---------------------------------------------------------------------------
// Dynamic capabilities block (auto-populated from registry)
// ---------------------------------------------------------------------------
function buildCapabilitiesBlock(): string {
  const caps = getCapabilities();
  const grouped = new Map<string, typeof caps>();
  for (const cap of caps) {
    const list = grouped.get(cap.category) || [];
    list.push(cap);
    grouped.set(cap.category, list);
  }

  let block = '\n## Available Capabilities\n';
  block += 'Below is the full list of things this app can do. When a user asks for help, use this list to suggest relevant features.\n\n';

  for (const [category, items] of grouped) {
    block += `### ${category.charAt(0).toUpperCase() + category.slice(1)}\n`;
    for (const cap of items) {
      const prefix = cap.isNew ? '🆕 NEW: ' : '';
      block += `- ${prefix}**${cap.name}** — ${cap.description}\n`;
      block += `  Endpoints: ${cap.apiEndpoints.join(', ')}\n`;
      block += `  Example prompts: ${cap.examplePrompts.map((p) => `"${p}"`).join(', ')}\n`;
    }
    block += '\n';
  }

  const newCaps = caps.filter((c) => c.isNew);
  if (newCaps.length > 0) {
    block += '### Recently Added\n';
    block += 'Proactively mention these new features when they are relevant to the conversation:\n';
    for (const cap of newCaps) {
      block += `- 🆕 **${cap.name}** — ${cap.description}\n`;
    }
    block += '\n';
  }

  return block;
}

// ---------------------------------------------------------------------------
// Photo editing instruction block (Phase 3)
// ---------------------------------------------------------------------------
const PHOTO_EDITING_INSTRUCTIONS = `
## Photo Editing Commands
You can help users edit product photos using PhotoRoom. When a user asks for photo changes,
translate their natural language into PhotoRoom parameters and call the reprocess API.

Available parameters:
- **background**: Hex color string (e.g. "#FFFFFF" for white, "#000000" for black, "#E0E0E0" for gray)
- **padding**: Number 0–0.5 (ratio). 0 = tight crop, 0.1 = 10% padding, 0.3 = lots of whitespace
- **shadow**: Boolean (true = AI soft shadow, false = no shadow)

Natural language mappings:
- "Add more white space" / "more padding" → increase padding (e.g. 0.2 or 0.3)
- "Tighter crop" / "less padding" → decrease padding (e.g. 0.02 or 0.05)
- "Remove the shadow" / "no shadow" → shadow: false
- "Add a shadow" → shadow: true
- "Make background gray" → background: "#E0E0E0"
- "Make background white" → background: "#FFFFFF"
- "Make background black" → background: "#000000"
- "Reprocess all photos" → trigger reprocess-all endpoint
- "Reprocess this image" → trigger single reprocess

Photo reprocess API:
- Single image: POST /api/products/{productId}/images/reprocess  body: { imageUrl, background, padding, shadow }
- All images:   POST /api/products/{productId}/images/reprocess-all  body: { background, padding, shadow }

## Photo Template Commands
Users can save and manage photo processing templates.
- "Save these settings as [name]" → Create/update a template
- "Apply the [name] template" → Apply a template to current product
- "What templates do we have?" / "list templates" → List all templates
- "Set this as default for [category]" → Set template as default for a StyleShoots category
- "Delete the [name] template" → Delete a template

Template API:
- GET /api/templates — list all templates
- POST /api/templates — create (body: { name, params: { background, padding, shadow }, category?, isDefault? })
- PUT /api/templates/:id — update
- DELETE /api/templates/:id — delete
- POST /api/templates/:id/apply/:productId — apply to product
- POST /api/templates/:id/set-default — set as default (body: { category? })

When the user mentions photo editing or templates, respond with the appropriate action.
If you detect a photo editing intent, include a "photoAction" object in your JSON response.
`;

// ---------------------------------------------------------------------------
// Navigation instruction block (shared across both prompts)
// ---------------------------------------------------------------------------
const NAVIGATION_INSTRUCTIONS = `
## Navigation
You can navigate the user to a different page by including a "navigate" field in your response.
When the user asks to see a specific page (e.g. "show me the orders", "go to settings", "take me to products"),
respond with helpful text AND include a navigate field with the target path.
Valid paths: /, /listings, /orders, /mappings, /logs, /settings, /images
Example: if the user says "show me the orders", respond with navigate: "/orders"
You can also proactively suggest navigation when it makes sense based on the user's current page.
`;

// ---------------------------------------------------------------------------
// System prompt for the Responses API + shell tool agent
// ---------------------------------------------------------------------------
function buildShellSystemPrompt(currentPage?: string): string {
  return `You are a ProductPipeline Assistant for a Shopify ↔ eBay integration app used by a camera store (UsedCameraGear.com / Pictureline).

You have access to a shell environment. You can run commands to help the user manage their product listings, orders, and sync operations.
${buildPageAwareBlock(currentPage)}
## Internal API (running at http://localhost:${PORT})
You can use curl to hit these endpoints. The full list is below in "Available Capabilities".
${buildCapabilitiesBlock()}
${PHOTO_EDITING_INSTRUCTIONS}
${NAVIGATION_INSTRUCTIONS}
## Rules
- NEVER sync orders without a date filter. Do not call POST /api/sync/trigger without an explicit date range.
- NEVER delete production data.
- Be concise and friendly in your responses.
- When you run commands, summarize the results in plain language for the user.
- If something fails, explain the error clearly and suggest next steps.
- Reference what page the user is currently on when relevant — e.g. "I see you're on the Products page."

## Response format
When you want the frontend to navigate the user, include the text "NAVIGATE:/path" on its own line at the end of your response.
For example: NAVIGATE:/orders

## Available tools in the shell
- curl for API calls
- node / Node.js for data processing
- sqlite3 for direct database queries (the app uses SQLite via better-sqlite3)
- Standard Unix tools (jq, grep, awk, etc.)
`;
}

// ---------------------------------------------------------------------------
// Fallback system prompt for Chat Completions (gpt-4o-mini)
// ---------------------------------------------------------------------------
function buildFallbackSystemPrompt(currentPage?: string): string {
  return `You are a ProductPipeline Assistant for a Shopify ↔ eBay integration app used by a camera store. You help users manage their product listings, orders, and sync operations.

You have access to internal API endpoints. When the user asks you to do something, determine which API to call, call it, and report the results in a friendly way.
${buildPageAwareBlock(currentPage)}
${buildCapabilitiesBlock()}
${PHOTO_EDITING_INSTRUCTIONS}
${NAVIGATION_INSTRUCTIONS}
Respond with a JSON object (and ONLY a JSON object, no markdown fences):
{
  "intent": "the_action_name or chat",
  "api_calls": [
    { "method": "GET|POST|PUT", "path": "/api/...", "body": null }
  ],
  "message": "A friendly message to show the user (you'll fill in results after I provide them)",
  "navigate": "/optional-path-to-navigate-user-to"
}

If the user is just chatting or asking for help, set intent to "chat" and api_calls to an empty array.
If you need to call an API, include it in api_calls. I will execute the calls and send the results back for you to format.
If the user wants to go to a page or see something that maps to a page, include "navigate" with the path.
Reference the user's current page when it's relevant.`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ResponsesApiResponse {
  id: string;
  object: string;
  status: string;
  output: ResponsesOutputItem[];
  error?: { message: string } | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface ResponsesOutputItem {
  type: string;
  // message items
  role?: string;
  content?: Array<{ type: string; text?: string }>;
  // shell_call items
  call_id?: string;
  action?: {
    commands?: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
  // shell_call_output items
  output?: Array<{
    stdout?: string;
    stderr?: string;
    outcome?: { type: string; exit_code?: number };
  }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface ApiCall {
  method: string;
  path: string;
  body?: unknown;
}

interface AiParsedResponse {
  intent: string;
  api_calls: ApiCall[];
  message: string;
  navigate?: string;
}

// ---------------------------------------------------------------------------
// Container management
// ---------------------------------------------------------------------------
async function getOrCreateContainer(apiKey: string): Promise<string> {
  if (containerId) return containerId;

  info('[Chat] Creating new OpenAI shell container...');
  const response = await fetch('https://api.openai.com/v1/containers', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      name: 'product-pipeline-chat',
      expires_after: { anchor: 'last_active_at', minutes: 30 },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to create container (${response.status}): ${errText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await response.json()) as any;
  containerId = data.id as string;
  info(`[Chat] Container created: ${containerId}`);
  return containerId!;
}

// ---------------------------------------------------------------------------
// Extract NAVIGATE:/path from AI text
// ---------------------------------------------------------------------------
function extractNavigate(text: string): { cleanText: string; navigate?: string } {
  const match = text.match(/\nNAVIGATE:(\/[a-z/:-]*)\s*$/i);
  if (match) {
    return {
      cleanText: text.replace(match[0], '').trimEnd(),
      navigate: match[1],
    };
  }
  return { cleanText: text };
}

// ---------------------------------------------------------------------------
// Responses API call (GPT-5.2 + shell tool)
// ---------------------------------------------------------------------------
async function callResponsesApi(
  userMessage: string,
  apiKey: string,
  currentPage?: string,
): Promise<{ text: string; actions: Array<{ type: string; detail: string }>; navigate?: string }> {
  const cId = await getOrCreateContainer(apiKey);

  // Build input — use previous_response_id for conversational continuity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: Record<string, any> = {
    model: 'gpt-5.2',
    instructions: buildShellSystemPrompt(currentPage),
    tools: [
      {
        type: 'shell',
        environment: {
          type: 'container_reference',
          container_id: cId,
        },
      },
    ],
    tool_choice: 'auto',
    input: userMessage,
  };

  if (previousResponseId) {
    body.previous_response_id = previousResponseId;
  }

  info(`[Chat] Calling Responses API (model: gpt-5.2, container: ${cId})`);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    // If gpt-5.2 isn't available, the error will bubble up and we'll fallback
    throw new Error(`Responses API error (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as ResponsesApiResponse;
  info(`[Chat] Responses API status: ${data.status}, output items: ${data.output?.length ?? 0}`);

  // Save response ID for conversational continuity
  previousResponseId = data.id;

  // Extract text and actions from output
  const actions: Array<{ type: string; detail: string }> = [];
  let finalText = '';

  for (const item of data.output || []) {
    if (item.type === 'message' && item.content) {
      for (const part of item.content) {
        if (part.type === 'output_text' && part.text) {
          finalText += part.text;
        }
      }
    } else if (item.type === 'shell_call') {
      const cmds = item.action?.commands?.join('; ') || 'shell command';
      actions.push({ type: 'shell', detail: cmds });
    } else if (item.type === 'shell_call_output') {
      for (const out of item.output || []) {
        const exitCode = out.outcome?.exit_code ?? '?';
        actions.push({
          type: exitCode === 0 ? 'success' : 'error',
          detail: `exit ${exitCode}`,
        });
      }
    }
  }

  if (!finalText && data.status === 'completed') {
    finalText = 'Done — the operation completed but produced no text output.';
  }

  if (data.error) {
    throw new Error(`Responses API returned error: ${data.error.message}`);
  }

  // Extract navigation directive from text
  const { cleanText, navigate } = extractNavigate(finalText);

  return { text: cleanText, actions, navigate };
}

// ---------------------------------------------------------------------------
// Fallback: Chat Completions API (gpt-4o-mini) — existing 2-pass flow
// ---------------------------------------------------------------------------
async function callChatCompletions(
  messages: Array<{ role: string; content: string }>,
  apiKey: string,
): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await response.json()) as any;
  return data.choices?.[0]?.message?.content || '';
}

async function callInternalApi(apiCall: ApiCall): Promise<{ status: number; data: unknown }> {
  const url = `http://localhost:${PORT}${apiCall.path}`;
  const options: RequestInit = {
    method: apiCall.method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (apiCall.body && apiCall.method !== 'GET') {
    options.body = JSON.stringify(apiCall.body);
  }

  const response = await fetch(url, options);
  const data = await response.json();
  return { status: response.status, data };
}

async function handleFallbackChat(
  message: string,
  apiKey: string,
  currentPage?: string,
): Promise<{ response: string; actions: Array<{ type: string; detail: string }>; navigate?: string }> {
  info('[Chat] Using fallback Chat Completions (gpt-4o-mini)');

  const parseMessages = [
    { role: 'system', content: buildFallbackSystemPrompt(currentPage) },
    { role: 'user', content: message },
  ];

  const aiRaw = await callChatCompletions(parseMessages, apiKey);
  info(`[Chat] AI parse response: ${aiRaw.substring(0, 200)}`);

  let parsed: AiParsedResponse;
  try {
    const cleaned = aiRaw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return { response: aiRaw, actions: [] };
  }

  const actions: Array<{ type: string; detail: string }> = [];
  const apiResults: Array<{ path: string; status: number; data: unknown }> = [];
  const navigatePath = parsed.navigate || undefined;

  if (parsed.api_calls && parsed.api_calls.length > 0) {
    for (const call of parsed.api_calls) {
      try {
        info(`[Chat] Calling internal API: ${call.method} ${call.path}`);
        const result = await callInternalApi(call);
        apiResults.push({ path: call.path, status: result.status, data: result.data });
        actions.push({
          type: result.status < 400 ? 'success' : 'error',
          detail: `${call.method} ${call.path} → ${result.status}`,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        apiResults.push({ path: call.path, status: 500, data: { error: errMsg } });
        actions.push({ type: 'error', detail: `${call.method} ${call.path} failed: ${errMsg}` });
      }
    }

    const followUpMessages = [
      { role: 'system', content: buildFallbackSystemPrompt(currentPage) },
      { role: 'user', content: message },
      { role: 'assistant', content: aiRaw },
      {
        role: 'user',
        content: `Here are the API results. Please provide a friendly, concise summary for the user. Respond with plain text (not JSON).\n\n${JSON.stringify(apiResults, null, 2)}`,
      },
    ];

    const summary = await callChatCompletions(followUpMessages, apiKey);
    info(`[Chat] AI summary: ${summary.substring(0, 200)}`);
    return { response: summary, actions, navigate: navigatePath };
  }

  return { response: parsed.message || aiRaw, actions, navigate: navigatePath };
}

// ---------------------------------------------------------------------------
// Photo command detection & handling (Phase 3)
// ---------------------------------------------------------------------------

interface PhotoCommandResult {
  handled: boolean;
  response?: string;
  actions?: Array<{ type: string; detail: string }>;
}

/**
 * Detect and handle photo editing / template commands locally without AI.
 * Returns { handled: true, ... } if the command was handled.
 */
async function tryHandlePhotoCommand(
  message: string,
  currentPage?: string,
): Promise<PhotoCommandResult> {
  const lower = message.toLowerCase().trim();

  // ── List templates ────────────────────────────────────────────
  if (
    /what templates|list templates|show templates|available templates/i.test(lower)
  ) {
    try {
      const templates = await listTemplates();
      if (templates.length === 0) {
        return {
          handled: true,
          response: '📋 No photo templates have been created yet.\n\nYou can create one by saying something like:\n"Save current settings as Small Lenses template"',
          actions: [],
        };
      }
      let text = `📋 **Photo Templates** (${templates.length} total)\n\n`;
      for (const t of templates) {
        const defaultBadge = t.isDefault ? ' ⭐ Default' : '';
        const cat = t.category ? ` (${t.category})` : '';
        text += `• **${t.name}**${cat}${defaultBadge}\n`;
        text += `  BG: ${t.params.background} | Padding: ${Math.round(t.params.padding * 100)}% | Shadow: ${t.params.shadow ? 'On' : 'Off'}\n`;
      }
      return { handled: true, response: text, actions: [] };
    } catch (err) {
      return { handled: true, response: `❌ Failed to list templates: ${err}`, actions: [] };
    }
  }

  // ── Save / create template ────────────────────────────────────
  const saveMatch = lower.match(
    /save (?:these |current |the )?settings as (?:the )?["']?(.+?)["']?\s*(?:template)?$/i,
  ) || lower.match(
    /create (?:a )?(?:new )?template (?:called |named )["']?(.+?)["']?$/i,
  );
  if (saveMatch) {
    const name = saveMatch[1].trim().replace(/\s+template$/i, '');
    // Extract params from the message or use defaults
    const params = parsePhotoParamsFromMessage(message);
    try {
      const template = await upsertTemplate(name, params);
      return {
        handled: true,
        response: `✅ Template **"${template.name}"** saved!\n\n` +
          `• Background: ${template.params.background}\n` +
          `• Padding: ${Math.round(template.params.padding * 100)}%\n` +
          `• Shadow: ${template.params.shadow ? 'On' : 'Off'}\n\n` +
          `You can apply it with "apply the ${template.name} template".`,
        actions: [{ type: 'success', detail: `Template "${template.name}" saved` }],
      };
    } catch (err) {
      return { handled: true, response: `❌ Failed to save template: ${err}`, actions: [] };
    }
  }

  // ── Set default for category ──────────────────────────────────
  const defaultMatch = lower.match(
    /set (?:this |that )?(?:template )?as default for ["']?(.+?)["']?$/i,
  ) || lower.match(
    /make ["']?(.+?)["']? (?:the )?default(?: template)? for ["']?(.+?)["']?$/i,
  );
  if (defaultMatch) {
    const category = (defaultMatch[2] || defaultMatch[1]).trim();
    // Try to find a template name in the message or use the last mentioned one
    const templateNameMatch = lower.match(/["'](.+?)["']/);
    if (templateNameMatch) {
      const templateName = templateNameMatch[1];
      const template = await getTemplateByName(templateName);
      if (template) {
        try {
          await setDefaultForCategory(template.id, category);
          return {
            handled: true,
            response: `⭐ Template **"${template.name}"** is now the default for **"${category}"**.`,
            actions: [{ type: 'success', detail: `Set default template for ${category}` }],
          };
        } catch (err) {
          return { handled: true, response: `❌ Failed to set default: ${err}`, actions: [] };
        }
      }
    }
    // Fallback — just indicate the intent
    return {
      handled: false,
    };
  }

  // ── Apply template ────────────────────────────────────────────
  const applyMatch = lower.match(
    /apply (?:the )?["']?(.+?)["']?\s*template/i,
  );
  if (applyMatch) {
    const name = applyMatch[1].trim();
    const template = await getTemplateByName(name);
    if (!template) {
      return {
        handled: true,
        response: `❌ No template found named "${name}". Use "list templates" to see available templates.`,
        actions: [],
      };
    }

    // Extract product ID from the current page URL
    const productIdMatch = currentPage?.match(/\/listings\/(\d+)/);
    if (!productIdMatch) {
      return {
        handled: true,
        response: `📋 Template **"${template.name}"** found. Navigate to a product page first, then say "apply the ${name} template" to apply it.`,
        actions: [],
      };
    }

    const productId = productIdMatch[1];
    try {
      const applyRes = await fetch(`http://localhost:${PORT}/api/templates/${template.id}/apply/${productId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = (await applyRes.json()) as any;
      if (data.ok) {
        return {
          handled: true,
          response: `✅ Applied template **"${template.name}"** to product ${productId}!\n\n` +
            `• ${data.succeeded}/${data.total} images processed successfully\n` +
            `• Background: ${template.params.background}\n` +
            `• Padding: ${Math.round(template.params.padding * 100)}%\n` +
            `• Shadow: ${template.params.shadow ? 'On' : 'Off'}`,
          actions: [{ type: 'success', detail: `Applied template to ${data.succeeded} images` }],
        };
      }
      return { handled: true, response: `❌ Failed to apply template: ${data.error}`, actions: [] };
    } catch (err) {
      return { handled: true, response: `❌ Failed to apply template: ${err}`, actions: [] };
    }
  }

  // ── Photo editing commands (reprocess) ────────────────────────
  const isPhotoEdit = /(?:add|more|increase|less|decrease|tighter|remove|make|change|set|reprocess)/i.test(lower) &&
    /(?:white ?space|padding|shadow|background|crop|photo|image)/i.test(lower);

  if (isPhotoEdit) {
    const productIdMatch = currentPage?.match(/\/listings\/(\d+)/);
    if (!productIdMatch) {
      // If user isn't on a product page, give guidance
      const params = parsePhotoParamsFromMessage(message);
      return {
        handled: true,
        response: `🖼️ I understood your photo editing request:\n\n` +
          `• Background: ${params.background}\n` +
          `• Padding: ${Math.round(params.padding * 100)}%\n` +
          `• Shadow: ${params.shadow ? 'On' : 'Off'}\n\n` +
          `Navigate to a product page to apply these settings, or save them as a template with:\n"Save these settings as [name] template"`,
        actions: [],
      };
    }

    const productId = productIdMatch[1];
    const params = parsePhotoParamsFromMessage(message);
    const isReprocessAll = /all\s*(?:photos|images)|reprocess\s*all/i.test(lower);
    // Extract image URL from message for single-image reprocess
    const imageUrlMatch = message.match(/https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s"'<>]*)?/i);
    const imageUrl = imageUrlMatch ? imageUrlMatch[0] : undefined;

    try {
      const endpoint = isReprocessAll
        ? `http://localhost:${PORT}/api/products/${productId}/images/reprocess-all`
        : `http://localhost:${PORT}/api/products/${productId}/images/reprocess`;

      const body = isReprocessAll
        ? params
        : { ...params, ...(imageUrl ? { imageUrl } : {}) };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as any;

      if (data.ok) {
        return {
          handled: true,
          response: `✅ Reprocessed ${data.succeeded}/${data.total} images for product ${productId}!\n\n` +
            `• Background: ${params.background}\n` +
            `• Padding: ${Math.round(params.padding * 100)}%\n` +
            `• Shadow: ${params.shadow ? 'On' : 'Off'}\n\n` +
            `Refresh the page to see the updated images.`,
          actions: [{ type: 'success', detail: `Reprocessed ${data.succeeded} images` }],
        };
      }
      return { handled: true, response: `❌ Reprocessing failed: ${data.error}`, actions: [] };
    } catch (err) {
      return { handled: true, response: `❌ Reprocessing failed: ${err}`, actions: [] };
    }
  }

  return { handled: false };
}

/**
 * Parse natural language into PhotoRoom params.
 */
function parsePhotoParamsFromMessage(message: string): PhotoRoomParams {
  const lower = message.toLowerCase();

  // Background color
  let background = '#FFFFFF';
  if (/(?:background|bg)\s*(?:to\s+)?(?:gray|grey)/i.test(lower)) background = '#E0E0E0';
  else if (/(?:background|bg)\s*(?:to\s+)?black/i.test(lower)) background = '#000000';
  else if (/(?:background|bg)\s*(?:to\s+)?cream/i.test(lower)) background = '#FFF9E6';
  else if (/(?:background|bg)\s*(?:to\s+)?blue/i.test(lower)) background = '#E8F0FE';
  else if (/(?:background|bg)\s*(?:to\s+)?silver/i.test(lower)) background = '#F0F0F0';
  // Check for hex color
  const hexMatch = lower.match(/#([0-9a-f]{6})/i);
  if (hexMatch) background = `#${hexMatch[1].toUpperCase()}`;

  // Padding
  let padding = 0.1;
  if (/(?:more|increase|add)\s*(?:white\s*space|padding|space)/i.test(lower)) padding = 0.25;
  else if (/(?:lots? of|much more|extra)\s*(?:white\s*space|padding)/i.test(lower)) padding = 0.4;
  else if (/(?:tighter|tight|less|decrease|reduce)\s*(?:crop|padding|space)/i.test(lower)) padding = 0.03;
  else if (/(?:no|zero|minimal)\s*(?:padding|space)/i.test(lower)) padding = 0.0;
  // Check for explicit percentage
  const pctMatch = lower.match(/(?:padding|space)\s*(?:to\s+)?(\d+)\s*%/i);
  if (pctMatch) padding = Math.min(parseInt(pctMatch[1], 10) / 100, 0.5);

  // Shadow
  let shadow = true;
  if (/(?:remove|no|without|disable|off)\s*(?:the\s+)?shadow/i.test(lower)) shadow = false;
  else if (/(?:add|enable|with|on)\s*(?:a\s+)?shadow/i.test(lower)) shadow = true;

  return { background, padding, shadow };
}

// ---------------------------------------------------------------------------
// POST /api/chat — AI-powered chat endpoint
// ---------------------------------------------------------------------------
router.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { message, currentPage } = req.body as { message?: string; currentPage?: string };

    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    info(`[Chat] User message: ${message} (page: ${currentPage || 'unknown'})`);

    // --- Phase 3: Try photo/template commands first (no AI needed) ---
    try {
      const photoResult = await tryHandlePhotoCommand(message, currentPage || undefined);
      if (photoResult.handled) {
        info(`[Chat] Photo command handled locally`);
        res.json({
          response: photoResult.response,
          actions: photoResult.actions || [],
        });
        return;
      }
    } catch (err) {
      logError(`[Chat] Photo command handler error: ${err}`);
      // Fall through to AI
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(500).json({
        response:
          '⚠️ The AI assistant is not configured yet. Please set the OPENAI_API_KEY environment variable.',
        actions: [],
      });
      return;
    }

    // --- Primary path: Responses API + Shell tool (GPT-5.2) ---
    try {
      const result = await callResponsesApi(message, apiKey, currentPage || undefined);
      info(`[Chat] Responses API success — text length: ${result.text.length}, actions: ${result.actions.length}`);
      res.json({ response: result.text, actions: result.actions, navigate: result.navigate });
      return;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logError(`[Chat] Responses API failed, falling back to Chat Completions: ${errMsg}`);

      // Reset container state on failure so we retry fresh next time
      containerId = null;
      previousResponseId = null;
    }

    // --- Fallback: Chat Completions (gpt-4o-mini) ---
    const fallbackResult = await handleFallbackChat(message, apiKey, currentPage || undefined);
    res.json(fallbackResult);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logError(`[Chat] Error: ${errMsg}`);

    if (errMsg.includes('OPENAI_API_KEY')) {
      res.status(500).json({
        response:
          '⚠️ The AI assistant is not configured yet. Please set the OPENAI_API_KEY environment variable.',
        actions: [],
      });
      return;
    }

    res.status(500).json({
      response: `❌ Something went wrong: ${errMsg}`,
      actions: [],
    });
  }
});

export default router;
