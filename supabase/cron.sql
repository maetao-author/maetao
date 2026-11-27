-- ♡ OPTIONAL: automatic sending of scheduled letters (every 10 minutes).
-- Without this, scheduled letters still show a "due now, press send" pop-up in /admin.
--
-- 1. Supabase → Database → Extensions: turn on pg_cron and pg_net.
-- 2. Replace YOUR-PROJECT and YOUR_CRON_SECRET below (same value as the CRON_SECRET function secret).
-- 3. Paste into the SQL Editor and Run.
-- The secret lives only in your database, never in the website or GitHub.

select cron.schedule(
  'send-scheduled-letters',
  '*/10 * * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR-PROJECT.supabase.co/functions/v1/send-newsletter',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR_CRON_SECRET'),
    body    := '{"mode":"scheduled"}'::jsonb
  );
  $$
);

-- to stop it later:  select cron.unschedule('send-scheduled-letters');
