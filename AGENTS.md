# AGENTS.md — ProductPipeline

> Rules for any agent (human or AI) working on this codebase.

## Before You Start
1. **Read `PROJECT.md`** — understand architecture, current state, known issues
2. **Read this file** — follow these rules

## Before You Finish
1. **Update `PROJECT.md`** — every change gets documented:
   - New features → add to Feature Status table
   - Bug fixes → add to Changelog with commit hash
   - Architecture changes → update Architecture section
   - New env vars → add to Environment Variables table
   - New integrations → add to Key Integrations section
   - Deployment changes → update Deployment section
   - Decisions → add to Decision Log
2. **Update Next Steps** — remove completed items, add new ones
3. **Commit PROJECT.md** in the same PR/commit as your changes

## Code Conventions
- **TypeScript ESM** — all server code uses ESM imports
- **Express 5** — async route handlers, no callback patterns
- **Drizzle ORM** — type-safe queries, schema in `src/db/schema.ts`
- **React 19 + Polaris** — Shopify Polaris components for all UI
- **Zustand** — state management (not Redux, not Context)
- **Capability registry** — new features must register in `src/server/capabilities.ts`
- **Factory pattern** — for services with multiple providers (see image-service-factory.ts)

## File Organization
- API routes: `src/server/routes/`
- Frontend pages: `src/web/pages/`
- Services/business logic: `src/services/`
- DB schema: `src/db/schema.ts`
- Nav: `src/web/components/AppNavigation.tsx`
- App routes: `src/web/App.tsx`

## Testing
- Run `npm test` before committing
- Test files in `src/services/__tests__/`

## Deployment
- Railway auto-deploys from git push to `main`
- Push to both remotes: `origin` (mrfrankbot) and `chris` (chrisbachmaxwell)
- Build: `tsc` (server) + `vite build` (frontend)
- Static frontend served by Express from `dist/web/`

## Don't
- Don't use Polaris Modal for overlays that need high z-index (use raw HTML)
- Don't send full-res images to PhotoRoom (resize to 2000px first)
- Don't overwrite draft images with empty arrays on pipeline failure
- Don't use `require()` — ESM only
- Don't hardcode credentials — use env vars or `~/.clawdbot/credentials/`
