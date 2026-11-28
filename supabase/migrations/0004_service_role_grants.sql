-- 𖹭 Step 4: let the email functions (server role) use the newsletter tables.
-- Some Supabase projects don't grant new tables to service_role automatically.
grant select, insert, update, delete on
  public.admins, public.subscribers, public.polls, public.poll_votes, public.ama_questions, public.swaps,
  public.swap_invites, public.issues, public.reminders, public.newsletter_sends, public.mail_queue
to service_role;
grant execute on function public.is_admin(), public.poll_results(uuid), public.reader_count(),
  public.claim_mail(int), public.mail_sent_24h() to service_role;
