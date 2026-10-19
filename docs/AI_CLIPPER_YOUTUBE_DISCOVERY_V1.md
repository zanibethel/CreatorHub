# CreatorHub AI Clipper — YouTube discovery foundation

Status: Proposed PR, not deployed. Scope: public-source discovery/bookmarks/preview only.

## Product intent

Serve both the owner's personal clipping projects and future paid creator workspaces from one multi-tenant feature. A user should be able to search YouTube for a channel or video, save a channel to their creator workspace, browse that channel's public uploads, and preview a video without copying an MCP URL or configuring a clipping plugin.

This first slice deliberately does **not** render clips, download YouTube files, transcribe videos from YouTube, publish anything, or authorize a YouTube account.

## Files and behavior

- `/clipper`: full-access authenticated CreatorHub workspace page.
- `/api/clipper/youtube/search`: authenticated, server-keyed search by channel, video, or video within a channel, returning only normalized public result metadata. One submitted search triggers one YouTube search request. No keystroke-by-keystroke API calls.
- `/api/clipper/youtube/sources`: save, list, and remove public channel bookmarks with canonical metadata fetched from YouTube. Saving a channel does **not** imply ownership, permission, access to analytics, or publishing rights.
- `clipper_youtube_channels`: Supabase table with per-user, per-creator RLS and unique channel bookmarks.
- Embedded playback uses YouTube's privacy-enhanced iframe and never proxies audio/video bytes. Creators can open CreatorHub's existing `/upload` page to transfer their original/licensed source files.

## Required configuration

1. Enable YouTube Data API v3 in a Google Cloud project and create a **server-side** API key restricted appropriately to that API. Set `YOUTUBE_DATA_API_KEY` as a Vercel/server secret. Do not use a `NEXT_PUBLIC_` key. A serverless environment may need application-level key protection because HTTP referrer restrictions are not suitable for server-to-server calls.
2. Apply `supabase/migrations/20261019190000_clipper_youtube_saved_channels.sql` to the intended environment only after reviewing it.
3. Run `npm run test:clipper`, `npx tsc --noEmit`, `npm run lint`, and `npm run build`.
4. Verify search by channel, search by video, channel-specific browsing, saving, reloading, removing, cross-user isolation, anonymous rejection, transfer-only-account rejection, quota exhaustion, missing API key, and small mobile screens.
5. **Do not promote to public paid SaaS until per-account API rate limiting/abuse protection, production quotas, monitoring, and YouTube policy/branding review are completed.** Search has an upstream API quota (currently a default of 100 search calls/day) and a five-minute Next data-cache hint; cached responses or simple client input constraints are not a substitute for an enforceable rate limiter.

## YouTube compliance boundary

The YouTube Data API permits discovery of public metadata with an application API key. Discovery and iframe playback are separate from obtaining audiovisual bytes. The YouTube API Services developer policies generally prohibit downloading, importing, caching, or storing YouTube audiovisual content without YouTube's prior written approval. A creator's Google OAuth authorization also does not, by itself, lift that platform API restriction.

Therefore, the rendering pipeline will operate on original user-uploaded files, other licensed media supplied outside the YouTube API, or another workflow explicitly approved under applicable platform terms. Never add an automatic YouTube stream downloader or a hidden backend fallback that downloads public YouTube videos.

Official references:
- https://developers.google.com/youtube/data/api-reference
- https://developers.google.com/youtube/v3/docs/search/list
- https://developers.google.com/youtube/terms/developer-policies

## Approved direction for next implementation slices

### Source and account experience

- A saved channel is a **public bookmark** and can be followed with one click.
- A claimed/owned YouTube channel is a **separate OAuth connection**, with secure state, minimum scopes, revocable tokens, ownership checks, and a clear authorization screen. Do not pretend saved channels are connected accounts.
- Make browser search, save, select, and supported publishing native CreatorHub actions. Keep manual URL entry only as an optional fallback; do not require external MCP copy/paste.
- Add playlists, search filters, previously selected videos, channel-monitoring preferences, and clear source-ownership flags after validating policy/quotas.

### Multi-model clipping engine (not yet implemented)

Use CoOperative for routing by **capability, privacy, latency, cost, and maximum budget** rather than hard-coding one model for every stage. Provide Auto/Economy/Balanced/Premium presets with optional task-level overrides.

Expected tasks are ingest of authorized media, transcription and word-level timing, optional diarization, candidate highlight generation, hook/retention scoring with confidence, silence removal, reframing/speaker tracking, subtitles, quality assurance, FFmpeg rendering, and private asset storage. Different models can perform different stages. Prefer suitable creator-owned/local nodes, then permitted linked nodes and economical hosted fallback, and report estimated vs actual cost. This is a plan, not a claim of present capability.

Long-running rendering should run in isolated asynchronous workers with per-job caps and deadlines, not in Vercel request handlers. Reuse CreatorHub's existing resumable Supabase Storage uploads where appropriate. Record job lifecycle, error details, per-stage cost and retries, plus resource ownership and usage-credit reservations for the eventual paid SaaS product.

### Publishing and monetization (not yet implemented)

Keep human approval before publishing initially. Add YouTube uploading or other supported social publishing only through scope-limited platform authorization. Build creator/workspace quotas and billing around actual duration and rendering complexity, not a flat unprotected proxy to an expensive model.

## Explicit non-goals for this PR

No YouTube OAuth, no FFmpeg worker, no unlicensed downloads, no fake clipping button, no billing, no database migration deployment, and no changes to CreatorHub PAPER-trading routes or schedules.
