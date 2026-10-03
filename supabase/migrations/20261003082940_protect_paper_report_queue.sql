-- Best-effort queue read restriction; extension-owned grants may require its owner.
-- net must remain outside the Data API exposed schemas (public, graphql_public).
revoke select on net.http_request_queue, net._http_response from public, anon, authenticated;

-- Rotate this collector's scheduler credential without returning it to the caller.
do $$
declare v_id uuid;
begin
  select id into strict v_id from vault.secrets where name = 'creatorhub-paper-report-cron';
  perform vault.update_secret(v_id, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
    'creatorhub-paper-report-cron', 'Private paper report collector scheduler token');
  update public.paper_report_state set cron_token_hash = (
    select encode(sha256(convert_to(decrypted_secret, 'UTF8')), 'hex')
    from vault.decrypted_secrets where id = v_id
  ) where report_key = 'main';
end $$;
