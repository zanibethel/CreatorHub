# AI Clipper Pass 2 — Direct YouTube URL entry

**Status:** Draft PR for review. Not merged, migrated, or deployed. Stacked after [Pass 1 PR #139](https://github.com/zanibethel/CreatorHub/pull/139), itself stacked after [Discovery PR #137](https://github.com/zanibethel/CreatorHub/pull/137).

## Deliverable

- CreatorHub `/clipper` now displays **Paste YouTube URL** as a prominent alternative to channel/video search.
- A pasted watch video URL, mobile watch URL, `youtu.be` URL, `/shorts/`, `/live/`, or `/embed/` opens its actual video's metadata and YouTube iframe preview.
- A channel ID URL (`/channel/UC...`) or `/@handle` URL (including common `/videos` and `/shorts` tabs) resolves canonical channel metadata through the official YouTube Data API and offers *Browse videos* and *Save channel* controls.
- A public playlist URL (`/playlist?list=...` or a `/watch?list=...` link without a video ID) lists up to the first **12** publicly exposed videos for selection/preview. **No multi-page pagination** is implemented in this pass.
- A watch URL containing both `v` and `list` deliberately selects the video, not the playlist. Invalid/private/deleted content gets an error or is filtered. Unsupported legacy custom channel slugs are rejected explicitly instead of guessed.

## Security and compliance

- Parse locally using the standard URL parser; strictly allow `youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`, and `www.youtu.be`. Reject credentials, arbitrary ports, encoded path segments, invalid/duplicate IDs, redirect paths, unsafe schemes, and non-YouTube hosts.
- **No arbitrary HTTP request** is made to a pasted URL. The server calls only fixed Google YouTube Data API endpoints with validated IDs/handles. All requests require an authenticated full-access CreatorHub account and ownership of the selected creator workspace.
- `videos.list`, `channels.list`, `playlistItems.list` all reserve their own server-side quota buckets **before outbound requests**; requests fail closed if quota/RPC/key is unavailable.
- A follow-on migration expands the service-role-only quota schema for the new resource buckets. Default **metadata project caps are now 3,000 each** for `channels.list`, `videos.list`, and `playlistItems.list` (maximum 9,000 combined 1-unit metadata requests/day if only these methods use the project). Search stays at 90 requests/day for its separate reserved search budget. This is application protection, **not extra quota supplied by Google**; operators must verify live project quota and other API consumers. Do not raise individual bucket caps such that combined calls exceed permitted project allowance.
- Displaying a public video via YouTube's iframe **never downloads audiovisual bytes for clipping**. Actual clip creation requires separately authorized media as planned in future passes.
- The client never receives the YouTube server API key or service-role secret.

## Verification before production

1. Review **both** this migration and the prior discovery/quota migrations in order. Do not apply them without explicit approval.
2. CI: `npm run test:clipper`, TypeScript, ESLint, existing PAPER regression tests, `npm run build`.
3. Test a real public video, Short, channel ID, @handle, playlist, private/missing video, quota failures, and mobile UI with a restricted test API key.
4. Confirm real Postgres concurrency and account isolation using a controlled environment; JS unit tests are not a substitute for DB transaction testing.
5. Confirm Google Cloud quota limits and that all applications using that project leave adequate quota headroom.

**Explicit non-goals:** media downloading, original upload ingestion, clipping jobs, AI multimodel processing, FFmpeg rendering, social publishing/OAuth, payments, merging PRs, applying migrations, or modifying trading systems.

**Next pass:** Discovery acceptance/review, then authorized-media intake if approved. Stop and wait for `continue` or `ok go`.
