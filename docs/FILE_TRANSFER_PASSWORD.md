# File Transfer password recovery

The File Transfer account can set a new password from an already signed-in device.

- Page: `/password`
- API: `POST /api/auth/change-password`
- The API requires an authenticated non-anonymous session and calls Supabase Auth `updateUser({ password })`.
- Transfer-only accounts are explicitly allowed to access this page and API route.
- No admin reset and no CreatorHub test-area access is required.

This is the fastest recovery path when a user successfully signed up on one device but later receives `invalid_credentials` on another device.
