-- 𖹭 Step 3: send from Mae's Gmail through a Google Apps Script relay.
-- Every email waits in mail_queue; the relay (running inside Mae's Google account) picks it up and
-- sends it with Gmail, a few at a time, within Gmail's daily limit. Safe to run twice.

create table if not exists public.mail_queue (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('confirm', 'welcome', 'swap', 'test', 'newsletter')),
  priority      int  not null default 1,          -- 0 = right away (confirm, welcome…), 1 = newsletter
  to_email      text not null,
  subject       text not null,
  html          text not null,
  text_body     text not null default '',
  headers       jsonb not null default '{}',
  issue_id      uuid references public.issues(id) on delete cascade,
  subscriber_id uuid references public.subscribers(id) on delete cascade,
  status        text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts      int  not null default 0,
  error         text,
  claimed_at    timestamptz,
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists mail_queue_pick on public.mail_queue(status, priority, created_at);
create index if not exists mail_queue_issue on public.mail_queue(issue_id, status);
create unique index if not exists mail_queue_once on public.mail_queue(issue_id, subscriber_id) where kind = 'newsletter';
alter table public.mail_queue enable row level security;
grant select on public.mail_queue to authenticated;
drop policy if exists "admin sees the queue" on public.mail_queue;
create policy "admin sees the queue" on public.mail_queue for select to authenticated using (public.is_admin());

-- hand out the next emails to send, safely (two relays can never grab the same email)
create or replace function public.claim_mail(n int)
returns setof public.mail_queue
language sql security definer set search_path = public as $$
  update public.mail_queue q set status = 'sending', claimed_at = now(), attempts = q.attempts + 1
  where q.id in (
    select id from public.mail_queue
    where status = 'queued' or (status = 'sending' and claimed_at < now() - interval '15 minutes' and attempts < 3)
    order by priority, created_at
    limit greatest(0, least(n, 50))
    for update skip locked
  )
  returning q.*;
$$;
revoke all on function public.claim_mail(int) from public, anon, authenticated;

-- how many emails went out in the last 24 hours (Gmail's limit is a rolling 24h)
create or replace function public.mail_sent_24h() returns bigint
language sql stable security definer set search_path = public as $$
  select count(*) from public.mail_queue where status = 'sent' and sent_at > now() - interval '24 hours';
$$;
revoke all on function public.mail_sent_24h() from public, anon, authenticated;

alter table public.issues add column if not exists queued_count int;
grant execute on function public.claim_mail(int) to service_role;
grant execute on function public.mail_sent_24h() to service_role;
