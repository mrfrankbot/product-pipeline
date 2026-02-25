/**
 * Photo Templates Service — Phase 3
 *
 * Templates are named sets of PhotoRoom params { background, padding, shadow }.
 * Each template optionally maps to a StyleShoots preset category so the
 * watcher can auto-apply the right settings when a new product folder appears.
 *
 * DB table: photo_templates
 */
import { info } from '../utils/logger.js';
import { getRawDb } from '../db/client.js';
// ── Table Init ─────────────────────────────────────────────────────────
export async function initPhotoTemplatesTable() {
    const db = await getRawDb();
    db.exec(`
    CREATE TABLE IF NOT EXISTS photo_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT,
      params_json TEXT NOT NULL DEFAULT '{}',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_photo_templates_category ON photo_templates(category);
    CREATE INDEX IF NOT EXISTS idx_photo_templates_default ON photo_templates(is_default);
  `);
    info('[PhotoTemplates] Table initialized');
}
// ── Helpers ────────────────────────────────────────────────────────────
function rowToTemplate(row) {
    let params;
    try {
        params = JSON.parse(row.params_json);
    }
    catch {
        params = { background: '#FFFFFF', padding: 0.1, shadow: true };
    }
    return {
        id: row.id,
        name: row.name,
        category: row.category,
        params,
        isDefault: row.is_default === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
// ── CRUD Functions ─────────────────────────────────────────────────────
export async function createTemplate(name, params, category, isDefault) {
    const db = await getRawDb();
    const now = new Date().toISOString();
    // If setting as default, clear other defaults for same category
    if (isDefault && category) {
        db.prepare(`UPDATE photo_templates SET is_default = 0, updated_at = ? WHERE category = ? AND is_default = 1`).run(now, category);
    }
    const result = db.prepare(`INSERT INTO photo_templates (name, category, params_json, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`).run(name, category ?? null, JSON.stringify(params), isDefault ? 1 : 0, now, now);
    info(`[PhotoTemplates] Created template: ${name} (id=${result.lastInsertRowid})`);
    return getTemplate(Number(result.lastInsertRowid));
}
export async function getTemplate(id) {
    const db = await getRawDb();
    const row = db.prepare(`SELECT * FROM photo_templates WHERE id = ?`).get(id);
    return row ? rowToTemplate(row) : null;
}
export async function getTemplateByName(name) {
    const db = await getRawDb();
    const row = db.prepare(`SELECT * FROM photo_templates WHERE name = ? COLLATE NOCASE`).get(name);
    return row ? rowToTemplate(row) : null;
}
export async function listTemplates(category) {
    const db = await getRawDb();
    let rows;
    if (category) {
        rows = db.prepare(`SELECT * FROM photo_templates WHERE category = ? COLLATE NOCASE ORDER BY is_default DESC, name ASC`).all(category);
    }
    else {
        rows = db.prepare(`SELECT * FROM photo_templates ORDER BY category ASC, is_default DESC, name ASC`).all();
    }
    return rows.map(rowToTemplate);
}
export async function updateTemplate(id, updates) {
    const db = await getRawDb();
    const existing = db.prepare(`SELECT * FROM photo_templates WHERE id = ?`).get(id);
    if (!existing)
        return null;
    const now = new Date().toISOString();
    const currentParams = JSON.parse(existing.params_json);
    const newName = updates.name ?? existing.name;
    const newCategory = updates.category !== undefined ? updates.category : existing.category;
    const newParams = updates.params
        ? { ...currentParams, ...updates.params }
        : currentParams;
    const newIsDefault = updates.isDefault !== undefined ? updates.isDefault : existing.is_default === 1;
    // If setting as default, clear other defaults for same category
    if (newIsDefault && newCategory) {
        db.prepare(`UPDATE photo_templates SET is_default = 0, updated_at = ? WHERE category = ? AND is_default = 1 AND id != ?`).run(now, newCategory, id);
    }
    db.prepare(`UPDATE photo_templates SET name = ?, category = ?, params_json = ?, is_default = ?, updated_at = ? WHERE id = ?`).run(newName, newCategory, JSON.stringify(newParams), newIsDefault ? 1 : 0, now, id);
    info(`[PhotoTemplates] Updated template ${id}: ${newName}`);
    return getTemplate(id);
}
export async function deleteTemplate(id) {
    const db = await getRawDb();
    const result = db.prepare(`DELETE FROM photo_templates WHERE id = ?`).run(id);
    if (result.changes > 0) {
        info(`[PhotoTemplates] Deleted template ${id}`);
        return true;
    }
    return false;
}
export async function getDefaultForCategory(category) {
    const db = await getRawDb();
    const row = db.prepare(`SELECT * FROM photo_templates WHERE category = ? COLLATE NOCASE AND is_default = 1 LIMIT 1`).get(category);
    return row ? rowToTemplate(row) : null;
}
export async function setDefaultForCategory(templateId, category) {
    const db = await getRawDb();
    const now = new Date().toISOString();
    // Clear existing defaults for this category
    db.prepare(`UPDATE photo_templates SET is_default = 0, updated_at = ? WHERE category = ? COLLATE NOCASE AND is_default = 1`).run(now, category);
    // Set the new default (also update the template's category if different)
    db.prepare(`UPDATE photo_templates SET is_default = 1, category = ?, updated_at = ? WHERE id = ?`).run(category, now, templateId);
    info(`[PhotoTemplates] Set template ${templateId} as default for category: ${category}`);
    return getTemplate(templateId);
}
/**
 * Find or create a template by name. Used by the chat to upsert.
 */
export async function upsertTemplate(name, params, category, isDefault) {
    const existing = await getTemplateByName(name);
    if (existing) {
        return (await updateTemplate(existing.id, { params, category, isDefault }));
    }
    return createTemplate(name, params, category, isDefault);
}
