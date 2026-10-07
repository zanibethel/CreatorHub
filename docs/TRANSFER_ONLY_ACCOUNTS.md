# CreatorHub transfer-only accounts

CreatorHub has a restricted File Transfer account mode for people who only need upload/download access.

## Access model

- Existing Auth users at rollout are grandfathered as `full`.
- Every newly created Auth user defaults to `transfer_only`.
- Transfer-only users may use:
  - `/upload`
  - `/download`
  - `/api/files/<token>/open`
  - `/api/files/<token>/download`
- Requests to other CreatorHub pages are redirected to `/upload`.
- Requests to other CreatorHub API routes return HTTP 403.
- The root page independently checks the access table before rendering the test dashboard.
- The access table is RLS-protected and signed-in users can only read their own access row.

The default-deny behavior is deliberate: if an access row is missing, the account is treated as transfer-only.

## Promotion

There is intentionally no self-service promotion UI. A transfer-only account can only become a full CreatorHub account through an owner/admin database change.
