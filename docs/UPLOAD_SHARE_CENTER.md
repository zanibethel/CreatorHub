# CreatorHub Upload Share Center

## Current MVP

CreatorHub has a standalone `/upload` page for moving files between devices.

- Uploads go directly from the signed-in browser to the private Supabase Storage bucket `creatorhub-uploads`.
- The Vercel app does not proxy the file bytes.
- Large uploads use Supabase's TUS resumable-upload endpoint on the direct Storage hostname.
- Uploads are sent in 6 MB chunks, with retry delays of 0s, 3s, 5s, 10s, and 20s.
- The browser stores the resumable upload URL and object path locally using a fingerprint derived from the signed-in user and selected file.
- If an upload is interrupted, selecting the same file again checks the server offset and resumes from the last confirmed byte.
- Supabase resumable upload URLs are valid for up to 24 hours.
- Each completed upload creates or updates a row in `public.creator_uploads` with an opaque UUID share token.
- The UI returns two stable CreatorHub URLs:
  - `/api/files/<token>/open` — opens the file using a fresh short-lived signed Storage URL.
  - `/api/files/<token>/download` — generates a fresh signed Storage URL with download disposition.
- The bucket remains private.
- Upload/list/delete permissions are scoped by the first Storage path segment matching the authenticated user's ID.
- Anonymous/guest accounts are intentionally excluded from upload storage.
- Per-file size limit: 5 GB.

## Why stable CreatorHub links

Raw Supabase signed URLs expire. The CreatorHub capability URL stays the same and creates a fresh 10-minute signed Storage URL each time it is used. That makes a copied link useful on another device while keeping the underlying bucket private.

## Resume behavior

The resumable state is deliberately kept until both the object upload and the `creator_uploads` metadata/share-link record succeed. If the object reaches 100% but link creation fails, the user can select the same file again and CreatorHub can continue from the already-completed object rather than re-uploading it.

## Next storage-center steps

Future work can add folders/collections, quota display, link revocation, expiration controls, file deletion, previews/thumbnails, version history, and cloud editing without changing the basic storage/share architecture.
