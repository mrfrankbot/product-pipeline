import { Router, type Request, type Response } from 'express';
import { info } from '../../utils/logger.js';

const router = Router();

const PORT = parseInt(process.env.PORT || '3000', 10);

const SYSTEM_PROMPT = `You are an eBay Sync Assistant for a Shopify ↔ eBay integration app used by a camera store. You help users manage their product listings, orders, and sync operations.

You have access to internal API endpoints. When the user asks you to do something, determine which API to call, call it, and report the results in a friendly way.

Available capabilities:
- "sync products" → POST /api/sync/products (requires { productIds: string[] } body — if user doesn't specify, explain this)
- "show status" / "check status" → GET /api/status
- "list products" / "show listings" → GET /api/listings
- "show mappings" → GET /api/mappings
- "update mapping" → PUT /api/mappings/:category/:field_name (body: { mapping_type, source_value, target_value })
- "show orders" / "list orders" → GET /api/orders
- "sync orders" → POST /api/sync/trigger
- "show settings" → GET /api/settings
- "show stale listings" → GET /api/listings/stale
- "show listing health" → GET /api/listings/health
- "republish stale listings" → POST /api/listings/republish-stale
- "apply price drops" → POST /api/listings/apply-price-drops

Respond with a JSON object (and ONLY a JSON object, no markdown fences):
{
  "intent": "the_action_name or chat",
  "api_calls": [
    { "method": "GET|POST|PUT", "path": "/api/...", "body": null }
  ],
  "message": "A friendly message to show the user (you'll fill in results after I provide them)"
}

If the user is just chatting or asking for help, set intent to "chat" and api_calls to an empty array.
If you need to call an API, include it in api_calls. I will execute the calls and send the results back for you to format.`;

interface ApiCall {
  method: string;
  path: string;
  body?: unknown;
}

interface AiParsedResponse {
  intent: string;
  api_calls: ApiCall[];
  message: string;
}

async function callOpenAI(messages: Array<{ role: string; content: string }>): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
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

  const data = await response.json() as any;
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

/** POST /api/chat — AI-powered chat endpoint */
router.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { message } = req.body as { message?: string };

    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    info(`[Chat] User message: ${message}`);

    // Step 1: Ask AI to parse intent and determine API calls
    const parseMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: message },
    ];

    const aiRaw = await callOpenAI(parseMessages);
    info(`[Chat] AI parse response: ${aiRaw.substring(0, 200)}`);

    let parsed: AiParsedResponse;
    try {
      // Strip markdown fences if present
      const cleaned = aiRaw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // If AI didn't return valid JSON, treat it as a chat response
      res.json({ response: aiRaw, actions: [] });
      return;
    }

    // Step 2: Execute any API calls
    const actions: Array<{ type: string; detail: string }> = [];
    const apiResults: Array<{ path: string; status: number; data: unknown }> = [];

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

      // Step 3: Send results back to AI for a human-friendly summary
      const followUpMessages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message },
        { role: 'assistant', content: aiRaw },
        {
          role: 'user',
          content: `Here are the API results. Please provide a friendly, concise summary for the user. Respond with plain text (not JSON).\n\n${JSON.stringify(apiResults, null, 2)}`,
        },
      ];

      const summary = await callOpenAI(followUpMessages);
      info(`[Chat] AI summary: ${summary.substring(0, 200)}`);

      res.json({ response: summary, actions });
    } else {
      // No API calls needed — just a chat response
      res.json({ response: parsed.message || aiRaw, actions });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    info(`[Chat] Error: ${errMsg}`);

    if (errMsg.includes('OPENAI_API_KEY')) {
      res.status(500).json({
        response: '⚠️ The AI assistant is not configured yet. Please set the OPENAI_API_KEY environment variable.',
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
