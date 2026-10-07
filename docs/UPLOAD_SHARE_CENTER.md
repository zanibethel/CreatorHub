# CreatorHub Upload Share Center

## Current MVP

CreatorHub now has a standalone `/upload` page for moving files between devices.

- Uploads go directly from the signed-in browser to the private Supabase Storage bucket `creatorhub-uploads`.
- The Vercel app does not proxy the file bytes.
- Each upload creates a row in `public.creator_uploads` with an opaque UUID share token.
- The UI returns two stable CreatorHub URLs:
  - `/api/files/<token>/open` — opens the file using a fresh short-lived signed Storage URL.
  - `/api/files/<token>/download` — generates a fresh signed Storage URL with download disposition.
- The bucket remains private.
- Upload/list/delete permissions are scoped by the first Storage path segment matching the authenticated user's ID.
- Anonymous/guest accounts are intentionally excluded from upload storage.
- Per-file size limit: 5 GB. The current browser uploader uses Supabase standard uploads; resumable TUS uploads are the next reliability upgrade for very large files.

## Why stable CreatorHub links

Raw Supabase signed URLs expire. The CreatorHub capability URL stays the same and creates a fresh 10-minute signed Storage URL each time it is used. That makes a copied link useful on another device while keeping the underlying bucket private.

## Next storage-center steps

Future work can add folders/collections, quota display, link revocation, expiration controls, file deletion, previews/thumbnails, version history, and cloud editing without changing the basic storage/share architecture.
