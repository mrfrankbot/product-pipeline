import { Router, type Request, type Response } from 'express';
import { getRawDb } from '../../db/client.js';
import { info } from '../../utils/logger.js';

const router = Router();

const VALID_STATUSES = ['new', 'planned', 'in_progress', 'completed', 'declined'] as const;
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

/** POST /api/features — Submit a feature request */
router.post('/api/features', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const { title, description, requested_by, priority } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    if (!description || typeof description !== 'string' || !description.trim()) {
      res.status(400).json({ error: 'description is required' });
      return;
    }

    const prio = priority && VALID_PRIORITIES.includes(priority) ? priority : 'medium';

    const result = db.prepare(
      `INSERT INTO feature_requests (title, description, requested_by, priority) VALUES (?, ?, ?, ?)`
    ).run(title.trim(), description.trim(), requested_by || null, prio);

    info(`[Features] New request: "${title.trim().slice(0, 60)}"`);

    const created = db.prepare(
      `SELECT
        fr.*,
        (SELECT COUNT(*) FROM feature_votes fv WHERE fv.feature_id = fr.id) as votes
       FROM feature_requests fr
       WHERE id = ?`
    ).get(result.lastInsertRowid);
    res.status(201).json({ ok: true, feature: created });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit feature request', detail: String(err) });
  }
});

/** GET /api/features — List all (supports ?status= filter) */
router.get('/api/features', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const status = (req.query.status as string || '').trim();

    let features;
    if (status && VALID_STATUSES.includes(status as any)) {
      features = db.prepare(
        `SELECT
          fr.*,
          (SELECT COUNT(*) FROM feature_votes fv WHERE fv.feature_id = fr.id) as votes
         FROM feature_requests fr
         WHERE status = ?
         ORDER BY
          CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
          created_at DESC`
      ).all(status);
    } else {
      features = db.prepare(
        `SELECT
          fr.*,
          (SELECT COUNT(*) FROM feature_votes fv WHERE fv.feature_id = fr.id) as votes
         FROM feature_requests fr
         ORDER BY
          CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
          created_at DESC`
      ).all();
    }

    res.json({ data: features, total: features.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch feature requests', detail: String(err) });
  }
});

/** GET /api/features/:id — Get single */
router.get('/api/features/:id', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const id = req.params.id;
    const feature = db.prepare(
      `SELECT
        fr.*,
        (SELECT COUNT(*) FROM feature_votes fv WHERE fv.feature_id = fr.id) as votes
       FROM feature_requests fr
       WHERE id = ?`
    ).get(id);

    if (!feature) {
      res.status(404).json({ error: 'Feature request not found' });
      return;
    }

    res.json(feature);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch feature request', detail: String(err) });
  }
});

/** POST /api/features/:id/vote — Vote for a feature request */
router.post('/api/features/:id/vote', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const id = req.params.id;
    const voterId = req.body?.voterId;

    if (!voterId || typeof voterId !== 'string') {
      res.status(400).json({ error: 'voterId is required' });
      return;
    }

    const feature = db.prepare(`SELECT id FROM feature_requests WHERE id = ?`).get(id);
    if (!feature) {
      res.status(404).json({ error: 'Feature request not found' });
      return;
    }

    const insert = db.prepare(
      `INSERT OR IGNORE INTO feature_votes (feature_id, voter_id) VALUES (?, ?)`
    ).run(id, voterId.trim());

    const votesRow = db.prepare(
      `SELECT COUNT(*) as count FROM feature_votes WHERE feature_id = ?`
    ).get(id) as any;

    res.json({
      ok: true,
      alreadyVoted: insert.changes === 0,
      votes: votesRow?.count ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to vote on feature request', detail: String(err) });
  }
});

/** PUT /api/features/:id — Update (status, priority, admin_notes) */
router.put('/api/features/:id', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const id = req.params.id;
    const { status, priority, admin_notes, title, description } = req.body;

    const updates: string[] = [];
    const params: unknown[] = [];

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status as any)) {
        res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
        return;
      }
      updates.push('status = ?');
      params.push(status);

      // Auto-set completed_at when marking complete
      if (status === 'completed') {
        updates.push("completed_at = datetime('now')");
      } else {
        updates.push('completed_at = NULL');
      }
    }

    if (priority !== undefined) {
      if (!VALID_PRIORITIES.includes(priority as any)) {
        res.status(400).json({ error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}` });
        return;
      }
      updates.push('priority = ?');
      params.push(priority);
    }

    if (admin_notes !== undefined) {
      updates.push('admin_notes = ?');
      params.push(admin_notes);
    }

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title);
    }

    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push("updated_at = datetime('now')");
    params.push(id);

    const result = db.prepare(
      `UPDATE feature_requests SET ${updates.join(', ')} WHERE id = ?`
    ).run(...params);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Feature request not found' });
      return;
    }

    const updated = db.prepare(
      `SELECT
        fr.*,
        (SELECT COUNT(*) FROM feature_votes fv WHERE fv.feature_id = fr.id) as votes
       FROM feature_requests fr
       WHERE id = ?`
    ).get(id);
    info(`[Features] Request ${id} updated`);
    res.json({ ok: true, feature: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update feature request', detail: String(err) });
  }
});

/** DELETE /api/features/:id — Delete */
router.delete('/api/features/:id', async (req: Request, res: Response) => {
  try {
    const db = await getRawDb();
    const id = req.params.id;

    const result = db.prepare(`DELETE FROM feature_requests WHERE id = ?`).run(id);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Feature request not found' });
      return;
    }

    info(`[Features] Request ${id} deleted`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete feature request', detail: String(err) });
  }
});

export default router;
