# Creator reference library

CreatorHub stores per-creator character and brand references in the private `creator-reference-assets` bucket and metadata in `public.creator_assets`.

## Intended generation behavior

1. Load `/api/creators/{creatorId}/image-context`.
2. Use the primary approved reference as the identity anchor.
3. Use up to five secondary approved references for expression, angle, wardrobe, lighting, and style continuity.
4. Send image references only to generation providers that explicitly support reference/edit inputs.
5. If the selected renderer does not support reference images, use the saved creator visual description and generation notes instead. Do not imply pixel-level identity consistency in that fallback path.
6. Generated images that the creator approves should be eligible to be saved back into this library with `source = generated`.
7. Never expose long-lived storage credentials or provider tokens to the browser.

The library is intentionally provider-agnostic so CoOperative can later route to a local worker, Vercel AI Gateway model, RunPod, Hugging Face, or another renderer without changing the creator asset model.
