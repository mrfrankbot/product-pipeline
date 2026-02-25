/**
 * Photo Edit API — Client-side canvas compositing upload
 *
 * POST /api/photos/edit — Upload an edited photo blob, store in GCS,
 * return the signed URL for use in draft_images_json.
 */
declare const router: import("express-serve-static-core").Router;
export default router;
