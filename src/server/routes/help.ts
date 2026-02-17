import { Router, type Request, type Response } from 'express';
import { getRawDb } from '../../db/client.js';
import { info, error as logError } from '../../utils/logger.js';
import { getCapabilities } from '../capabilities.js';

const router = Router();

/**
 * Generate an AI answer for a help question using OpenAI.
 * Returns the answer string, or null if OPENAI_API_KEY is not set or on error.
 */
async function generateAIAnswer(question: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    info('[Help] OPENAI_API_KEY not set — skipping AI auto-answer');
    return null;
  }

  try {
    const capabilities = getCapabilities();
    const capList = capabilities
      .map((c) => `- **${c.name}** (${c.category}): ${c.description}\n  Endpoints: ${c.apiEndpoints.join(', ')}`)
      .join('\n');

    const systemPrompt = `You are the help assistant for ProductPipeline, a Shopify ↔ eBay listing automation app built for Pictureline, a camera store in Salt Lake City, Utah.

Your job is to answer user questions about the app clearly and helpfully. Be professional but friendly. Use step-by-step instructions when appropriate.

## App Purpose
ProductPipeline syncs products from Shopify to eBay, manages listings, processes images, handles orders, and automates the listing pipeline. It's designed specifically for a used camera gear business.

## App Capabilities
${capList}

## Common Workflows
1. **Sync Products**: Go to Products page → select items → click Sync to eBay. Products are mapped with field mappings.
2. **Manage Listings**: Use the Listings page to browse, search, and filter active eBay listings.
3. **Auto-Listing Pipeline**: New Shopify products flow through stages: pending → enriched (AI titles/descriptions) → images processed → listed on eBay.
4. **Field Mappings**: Configure how Shopify fields map to eBay fields across 4 categories: Sales, Listing, Shipping, Payment.
5. **Image Processing**: Images are processed through PhotoRoom for background removal and enhancement before listing.
6. **Orders**: eBay orders are synced to Shopify for unified fulfillment (with date-filter safety guards).
7. **Per-Product Overrides**: Customize individual product settings that differ from global mappings.
8. **Price Drops & Republishing**: Stale listings can be automatically republished or have prices dropped.
9. **Feature Requests**: Users can submit feature requests at /features to suggest improvements.

## Guidelines
- Answer in 2-5 paragraphs
- Use clear, step-by-step instructions when explaining how to do something
- Reference specific pages and navigation paths in the app
- Be accurate — only describe features that exist in the capabilities list
- If unsure about something, say so honestly`;

    // Use fetch directly to call OpenAI API (avoid importing the full SDK at runtime)
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      logError(`[Help] OpenAI API error: ${response.status} ${errText}`);
      return null;
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const answer = data.choices?.[0]?.message?.content?.trim();
    if (answer) {
      info(`[Help] AI auto-answer generated (${answer.length} chars)`);
      return answer;
    }

    return null;
  } catch (err) {
    logError(`[Help] AI auto-answer error: ${err}`);
    return null;
  }
}

/** POST /api/help/questions — Submit a new question */
router.post('/api/help/questions', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const { question, asked_by, category } = req.body;

    if (!question || typeof question !== 'string' || !question.trim()) {
      res.status(400).json({ error: 'question is required' });
      return;
    }

    const result = db.prepare(
      `INSERT INTO help_questions (question, asked_by, category) VALUES (?, ?, ?)`
    ).run(question.trim(), asked_by || null, category || null);

    info(`[Help] New question submitted: "${question.trim().slice(0, 60)}..."`);

    // Attempt AI auto-answer (non-blocking for the response — we update in-place)
    const questionId = result.lastInsertRowid;

    // Generate AI answer and update the row
    const aiAnswer = await generateAIAnswer(question.trim());
    if (aiAnswer) {
      db.prepare(
        `UPDATE help_questions SET answer = ?, status = 'answered', answered_by = 'AI', updated_at = datetime('now') WHERE id = ?`
      ).run(aiAnswer, questionId);
      info(`[Help] Question ${questionId} auto-answered by AI`);
    }

    const created = db.prepare(`SELECT * FROM help_questions WHERE id = ?`).get(questionId);
    res.status(201).json({ ok: true, question: created });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit question', detail: String(err) });
  }
});

/** GET /api/help/questions — List all questions (admin, supports ?status= filter) */
router.get('/api/help/questions', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const status = (req.query.status as string || '').trim();

    let questions;
    if (status) {
      questions = db.prepare(
        `SELECT * FROM help_questions WHERE status = ? ORDER BY created_at DESC`
      ).all(status);
    } else {
      questions = db.prepare(
        `SELECT * FROM help_questions ORDER BY created_at DESC`
      ).all();
    }

    res.json({ data: questions, total: questions.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch questions', detail: String(err) });
  }
});

/** GET /api/help/questions/:id — Get single question */
router.get('/api/help/questions/:id', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const id = req.params.id;
    const question = db.prepare(`SELECT * FROM help_questions WHERE id = ?`).get(id);

    if (!question) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    res.json(question);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch question', detail: String(err) });
  }
});

/** PUT /api/help/questions/:id — Update question (answer, status, category) */
router.put('/api/help/questions/:id', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const id = req.params.id;
    const { answer, status, category, answered_by } = req.body;

    // Build dynamic SET clause
    const updates: string[] = [];
    const params: unknown[] = [];

    if (answer !== undefined) {
      updates.push('answer = ?');
      params.push(answer);
    }
    if (status !== undefined) {
      const validStatuses = ['pending', 'answered', 'published', 'archived'];
      if (!validStatuses.includes(status)) {
        res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        return;
      }
      updates.push('status = ?');
      params.push(status);
    }
    if (category !== undefined) {
      updates.push('category = ?');
      params.push(category);
    }
    if (answered_by !== undefined) {
      updates.push('answered_by = ?');
      params.push(answered_by);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push("updated_at = datetime('now')");
    params.push(id);

    const result = db.prepare(
      `UPDATE help_questions SET ${updates.join(', ')} WHERE id = ?`
    ).run(...params);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    const updated = db.prepare(`SELECT * FROM help_questions WHERE id = ?`).get(id);
    info(`[Help] Question ${id} updated: ${updates.filter(u => !u.startsWith('updated_at')).join(', ')}`);
    res.json({ ok: true, question: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update question', detail: String(err) });
  }
});

/** DELETE /api/help/questions/:id — Delete a question */
router.delete('/api/help/questions/:id', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const id = req.params.id;

    const result = db.prepare(`DELETE FROM help_questions WHERE id = ?`).run(id);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Question not found' });
      return;
    }

    info(`[Help] Question ${id} deleted`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete question', detail: String(err) });
  }
});

/** GET /api/help/faq — Get published Q&A pairs (public endpoint) */
router.get('/api/help/faq', async (_req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const faq = db.prepare(
      `SELECT id, question, answer, category, sort_order, updated_at FROM help_questions WHERE status = 'published' ORDER BY category, sort_order ASC, created_at ASC`
    ).all();

    res.json({ data: faq, total: faq.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch FAQ', detail: String(err) });
  }
});

/** GET /api/help/categories — Returns categories with article counts */
router.get('/api/help/categories', async (_req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const cats = db.prepare(
      `SELECT category, COUNT(*) as count FROM help_questions WHERE status = 'published' AND category IS NOT NULL GROUP BY category ORDER BY category`
    ).all() as { category: string; count: number }[];

    res.json({ data: cats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories', detail: String(err) });
  }
});

/** GET /api/help/articles — List published articles, optionally filter by category */
router.get('/api/help/articles', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const category = (req.query.category as string || '').trim();

    let articles;
    if (category) {
      articles = db.prepare(
        `SELECT id, question, answer, category, sort_order, updated_at FROM help_questions WHERE status = 'published' AND category = ? ORDER BY sort_order ASC, created_at ASC`
      ).all(category);
    } else {
      articles = db.prepare(
        `SELECT id, question, answer, category, sort_order, updated_at FROM help_questions WHERE status = 'published' ORDER BY category, sort_order ASC, created_at ASC`
      ).all();
    }

    res.json({ data: articles, total: articles.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch articles', detail: String(err) });
  }
});

/** GET /api/help/articles/:id — Get single article with prev/next IDs */
router.get('/api/help/articles/:id', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const id = Number(req.params.id);

    const article = db.prepare(
      `SELECT id, question, answer, category, sort_order, updated_at FROM help_questions WHERE id = ? AND status = 'published'`
    ).get(id) as { id: number; category: string; sort_order: number } | undefined;

    if (!article) {
      res.status(404).json({ error: 'Article not found' });
      return;
    }

    // Get all published articles ordered to find prev/next
    const allArticles = db.prepare(
      `SELECT id FROM help_questions WHERE status = 'published' ORDER BY category, sort_order ASC, created_at ASC`
    ).all() as { id: number }[];

    const idx = allArticles.findIndex((a) => a.id === id);
    const prevId = idx > 0 ? allArticles[idx - 1].id : null;
    const nextId = idx < allArticles.length - 1 ? allArticles[idx + 1].id : null;

    res.json({ ...article, prevId, nextId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch article', detail: String(err) });
  }
});

export default router;
