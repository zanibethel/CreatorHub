# BigOrders Challenge Manager — account recovery

Issue: the verified owner using a password unknown to the current CreatorHub Supabase Auth account saw `Invalid login credentials`. CreatorHub had a password-change form only for *already-signed-in* users, and no self-serve recovery from the Challenge Manager.

## Changes
- Same existing verified owner login; `zanibethel@gmail.com` is a verified email/password Supabase Auth account on the private exact-UUID owner allowlist. **No password is readable and no new account is created.**
- Sign-in page has a **Forgot password?** link that opens an in-place email request.
- Public same-origin POST `/api/auth/request-password-reset`: strictly validates email input, denies foreign origins, never accepts redirectTo from caller, uses only the public Supabase key and `resetPasswordForEmail`, and returns a generic message that doesn't reveal whether the email belongs to an account.
- Recovery email points to the constant first-party `https://creatorhub-gray.vercel.app/auth/recover`.
- The recovery page handles Supabase implicit `#access_token` and `#refresh_token` links and compatible PKCE `?code=` and `token_hash` recovery links. It strips the secrets from browser history and verifies the resulting session with Supabase. A successful recovery allows a new 12+ character password via the **existing**, same-origin `/api/auth/change-password` route.
- After success, the user returns directly to the Challenge Manager. No redirect to the generic AI CreatorHub homepage.
- Proxy permits recovery for other already-signed-in account types without granting them challenge-owner status.

## Safeguards
- The challenge page and API still require an active, verified user with the exact private owner allowlist UUID **and** current full access.
- No Supabase admin action, auth.users password read, bypass, direct SQL password reset, or service role in the client.
- No changes to PAPER capital, research, trading bots, order logic, or broker positions.
- Some Supabase projects restrict email sending and redirect allowlists. If the recovery email is rejected, investigate the SMTP/provider settings and allowed redirect URLs. Do not claim a recovery email was delivered without evidence.

## Verification
CI typecheck + lint + node tests + Next.js build. Verify preview READY, merge only on green CI, then production exact-SHA READY. A full user inbox click and password entry must be performed by the owner; never request a password or recovery token in chat.
