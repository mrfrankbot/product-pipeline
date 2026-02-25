/**
 * Photo Edit API — Client-side canvas compositing upload
 *
 * POST /api/photos/edit — Upload an edited photo blob, store in GCS,
 * return the signed URL for use in draft_images_json.
 */
import { Router } from 'express';
import multer from 'multer';
import { info, error as logError } from '../../utils/logger.js';
import { uploadProcessedImage } from '../../watcher/drive-search.js';
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
// ── POST /api/photos/edit — Upload edited photo ───────────────────────
router.post('/api/photos/edit', upload.single('image'), async (req, res) => {
    try {
        const file = req.file;
        if (!file || !file.buffer) {
            res.status(400).json({ error: 'No image file provided' });
            return;
        }
        const draftId = req.body?.draftId || 'unknown';
        const imageIndex = req.body?.imageIndex || '0';
        const filename = `edited-draft${draftId}-img${imageIndex}-${Date.now()}.png`;
        info(`[PhotoEdit] Uploading edited photo: ${filename} (${(file.buffer.length / 1024).toFixed(0)}KB)`);
        const url = await uploadProcessedImage(file.buffer, filename);
        info(`[PhotoEdit] ✅ Uploaded: ${filename}`);
        res.json({ ok: true, url, filename });
    }
    catch (err) {
        logError(`[PhotoEdit] Upload failed: ${err}`);
        res.status(500).json({ error: 'Failed to upload edited photo', detail: String(err) });
    }
});
export default router;
