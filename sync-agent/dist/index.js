/**
 * StyleShoots Sync Agent
 *
 * Watches /Volumes/StyleShootsDrive/UsedCameraGear/ and syncs photos to GCS.
 * Modes:
 *   --once   One-time full sync, then exit
 *   --watch  Watch for changes and sync continuously (default)
 */
import fs from 'node:fs';
import path from 'node:path';
import { Storage } from '@google-cloud/storage';
import { watch } from 'chokidar';
// ── Config ──────────────────────────────────────────────────────────────
const DRIVE_PATH = process.env.DRIVE_PATH ?? '/Volumes/StyleShootsDrive/UsedCameraGear/';
const BUCKET_NAME = process.env.GCS_BUCKET ?? 'pictureline-product-photos';
const GCS_PREFIX = process.env.GCS_PREFIX ?? 'UsedCameraGear/';
const MANIFEST_PATH = process.env.MANIFEST_PATH ?? path.join(process.env.HOME ?? '/tmp', '.styleshoots-sync-manifest.json');
const LOG_PATH = process.env.LOG_PATH ?? path.join(process.env.HOME ?? '/tmp', 'Library/Logs/styleshoots-sync.log');
const IMAGE_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp', '.heic', '.heif',
]);
// ── Logging ─────────────────────────────────────────────────────────────
function ensureDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
function log(level, msg) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] ${msg}`;
    console.log(line);
    try {
        ensureDir(LOG_PATH);
        fs.appendFileSync(LOG_PATH, line + '\n');
    }
    catch { /* ignore */ }
}
function loadManifest() {
    try {
        return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    }
    catch {
        return {};
    }
}
function saveManifest(manifest) {
    ensureDir(MANIFEST_PATH);
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}
// ── GCS Upload ──────────────────────────────────────────────────────────
const storage = new Storage(); // uses ADC (gcloud auth application-default)
const bucket = storage.bucket(BUCKET_NAME);
async function uploadFile(localPath, gcsKey) {
    try {
        await bucket.upload(localPath, {
            destination: gcsKey,
            metadata: {
                cacheControl: 'public, max-age=86400',
            },
        });
        return true;
    }
    catch (err) {
        log('ERROR', `Upload failed ${gcsKey}: ${err.message}`);
        return false;
    }
}
// ── Scanning ────────────────────────────────────────────────────────────
function isImage(filename) {
    if (filename.startsWith('.') || filename.startsWith('._'))
        return false;
    const ext = path.extname(filename).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
}
function scanDrive() {
    const files = [];
    if (!fs.existsSync(DRIVE_PATH)) {
        log('WARN', `Drive not mounted: ${DRIVE_PATH}`);
        return files;
    }
    const presets = fs.readdirSync(DRIVE_PATH, { withFileTypes: true });
    for (const preset of presets) {
        if (!preset.isDirectory() || preset.name.startsWith('.'))
            continue;
        const presetPath = path.join(DRIVE_PATH, preset.name);
        let productDirs;
        try {
            productDirs = fs.readdirSync(presetPath, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const dir of productDirs) {
            if (!dir.isDirectory() || dir.name.startsWith('.'))
                continue;
            const folderPath = path.join(presetPath, dir.name);
            let entries;
            try {
                entries = fs.readdirSync(folderPath);
            }
            catch {
                continue;
            }
            for (const entry of entries) {
                if (!isImage(entry))
                    continue;
                const filePath = path.join(folderPath, entry);
                try {
                    const stat = fs.statSync(filePath);
                    const gcsKey = `${GCS_PREFIX}${preset.name}/${dir.name}/${entry}`;
                    files.push({
                        localPath: filePath,
                        gcsKey,
                        mtime: stat.mtimeMs,
                        size: stat.size,
                    });
                }
                catch {
                    continue;
                }
            }
        }
    }
    return files;
}
// ── Sync Logic ──────────────────────────────────────────────────────────
async function syncAll() {
    const manifest = loadManifest();
    const files = scanDrive();
    let uploaded = 0, skipped = 0, errors = 0;
    log('INFO', `Found ${files.length} image files to check`);
    for (const file of files) {
        const existing = manifest[file.localPath];
        if (existing && existing.mtime === file.mtime && existing.size === file.size) {
            skipped++;
            continue;
        }
        const ok = await uploadFile(file.localPath, file.gcsKey);
        if (ok) {
            manifest[file.localPath] = {
                mtime: file.mtime,
                size: file.size,
                gcsKey: file.gcsKey,
            };
            uploaded++;
            if (uploaded % 50 === 0) {
                log('INFO', `Progress: ${uploaded} uploaded, ${skipped} skipped`);
                saveManifest(manifest);
            }
        }
        else {
            errors++;
        }
    }
    saveManifest(manifest);
    return { uploaded, skipped, errors };
}
// ── Watch Mode ──────────────────────────────────────────────────────────
function startWatcher() {
    log('INFO', `Watching ${DRIVE_PATH} for changes...`);
    const watcher = watch(DRIVE_PATH, {
        ignoreInitial: true,
        depth: 3,
        awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
        ignored: /(^|[\/\\])\../, // ignore dotfiles
    });
    let debounceTimer = null;
    const triggerSync = () => {
        if (debounceTimer)
            clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            log('INFO', 'Change detected, syncing...');
            const result = await syncAll();
            log('INFO', `Sync complete: ${result.uploaded} uploaded, ${result.skipped} skipped, ${result.errors} errors`);
        }, 5000); // wait 5s after last change before syncing
    };
    watcher.on('add', (filePath) => {
        if (isImage(path.basename(filePath))) {
            log('INFO', `New file: ${filePath}`);
            triggerSync();
        }
    });
    watcher.on('change', (filePath) => {
        if (isImage(path.basename(filePath))) {
            log('INFO', `Changed file: ${filePath}`);
            triggerSync();
        }
    });
    // Keep alive
    process.on('SIGINT', () => {
        log('INFO', 'Shutting down watcher...');
        watcher.close();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        log('INFO', 'Shutting down watcher...');
        watcher.close();
        process.exit(0);
    });
}
// ── Main ────────────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);
    const mode = args.includes('--once') ? 'once' : 'watch';
    log('INFO', `StyleShoots Sync Agent starting (mode: ${mode})`);
    log('INFO', `Drive: ${DRIVE_PATH}`);
    log('INFO', `Bucket: gs://${BUCKET_NAME}/${GCS_PREFIX}`);
    // Always do a full sync first
    log('INFO', 'Running full sync...');
    const result = await syncAll();
    log('INFO', `Full sync complete: ${result.uploaded} uploaded, ${result.skipped} skipped, ${result.errors} errors`);
    if (mode === 'watch') {
        startWatcher();
    }
}
main().catch((err) => {
    log('ERROR', `Fatal: ${err.message}`);
    process.exit(1);
});
