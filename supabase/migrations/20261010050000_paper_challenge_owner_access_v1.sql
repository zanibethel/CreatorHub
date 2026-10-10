-- Step 5: owner access to challenge administration, never derived from general
-- CreatorHub 'full' access. Owner identity is a confirmed auth.users id,
-- not editable JWT user_metadata or untrusted browser email.
CREATE TABLE IF NOT EXISTS public.paper_challenge_owner_access (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 access_scope text NOT NULL DEFAULT 'owner' CHECK(access_scope='owner'),
 granted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paper_challenge_owner_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.paper_challenge_owner_access FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.paper_challenge_owner_access TO service_role;

-- Bootstrap the one previously verified owner, fail closed on ambiguity.
DO $owner$
DECLARE v_count integer;
BEGIN
 SELECT count(*) INTO v_count FROM auth.users u
 JOIN public.creatorhub_account_access a ON a.user_id=u.id
 WHERE lower(u.email)='zanibethel@gmail.com'
   AND u.email_confirmed_at IS NOT NULL AND a.access_level='full';
 IF v_count<>1 THEN
   RAISE EXCEPTION 'Expected one verified CreatorHub owner, refusing owner-access bootstrap.';
 END IF;
 INSERT INTO public.paper_challenge_owner_access(user_id)
 SELECT u.id FROM auth.users u
 JOIN public.creatorhub_account_access a ON a.user_id=u.id
 WHERE lower(u.email)='zanibethel@gmail.com'
   AND u.email_confirmed_at IS NOT NULL AND a.access_level='full'
 ON CONFLICT (user_id) DO NOTHING;
END;
$owner$;