# CreatorHub same-origin authentication

CreatorHub real-account sign in, sign up, and sign out use same-origin Next.js route handlers:

- `POST /api/auth/login`
- `POST /api/auth/signup`
- `POST /api/auth/logout`

The browser talks only to the CreatorHub origin for these actions. The route handlers call Supabase Auth server-side and let `@supabase/ssr` write the auth cookies on the CreatorHub response.

This avoids browser CORS failures caused by credentialed cross-origin auth requests on devices or browsers that strictly reject wildcard `Access-Control-Allow-Origin` responses when credentials mode is `include`.

Transfer-only access controls remain unchanged. The auth endpoints are explicitly allowed through the transfer-only proxy gate so users can sign out after authentication.
