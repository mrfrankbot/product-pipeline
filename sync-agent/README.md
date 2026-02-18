# StyleShoots Sync Agent

Syncs product photos from the StyleShoots network drive to Google Cloud Storage, so the ProductPipeline app on Railway can access them.

## Architecture

```
StyleShoots Drive (SMB) → Sync Agent (Mac) → GCS Bucket → ProductPipeline (Railway)
```

## Prerequisites

1. **Google Cloud Storage bucket** with billing enabled:
   ```bash
   gcloud storage buckets create gs://pictureline-product-photos --location=us-west1 --uniform-bucket-level-access
   ```

2. **GCS authentication** — the sync agent uses Application Default Credentials:
   ```bash
   gcloud auth application-default login
   ```

3. **StyleShoots drive mounted** at `/Volumes/StyleShootsDrive/`

## Setup

```bash
cd ~/projects/product-pipeline/sync-agent
npm install
npm run build
```

## Usage

### One-time full sync
```bash
npm run sync
```

### Watch mode (continuous)
```bash
npm run watch
```

### Install as launchd service (auto-start on login)
```bash
cp com.pictureline.styleshoots-sync.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.pictureline.styleshoots-sync.plist
```

### Uninstall service
```bash
launchctl unload ~/Library/LaunchAgents/com.pictureline.styleshoots-sync.plist
rm ~/Library/LaunchAgents/com.pictureline.styleshoots-sync.plist
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DRIVE_PATH` | `/Volumes/StyleShootsDrive/UsedCameraGear/` | Local mount path |
| `GCS_BUCKET` | `pictureline-product-photos` | GCS bucket name |
| `GCS_PREFIX` | `UsedCameraGear/` | Prefix within bucket |
| `MANIFEST_PATH` | `~/.styleshoots-sync-manifest.json` | Sync state file |
| `LOG_PATH` | `~/Library/Logs/styleshoots-sync.log` | Log file path |

## ProductPipeline Integration

Set these env vars on Railway:
```
DRIVE_MODE=cloud
GCS_BUCKET=pictureline-product-photos
GCS_PREFIX=UsedCameraGear/
```

The `drive-search.ts` module auto-switches between local filesystem and GCS based on `DRIVE_MODE`.

## Logs
```bash
tail -f ~/Library/Logs/styleshoots-sync.log
```
