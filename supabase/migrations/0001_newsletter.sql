-- 𖹭 Mae Tao newsletter: tables + security
-- Run once: Supabase dashboard → SQL Editor → paste this whole file → Run.
-- Then run:  insert into public.admins(email) values ('mtao.author@gmail.com');  (your admin login email)

create extension if not exists pgcrypto;

-- who may use /admin --------------------------------------------------------
create table if not exists public.admins (
  email text primary key check (email = lower(email))
);
alter table public.admins enable row level security;
-- nobody reads/writes admins through the API; edit it in the SQL editor only.

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- subscribers ---------------------------------------------------------------
create table if not exists public.subscribers (
  id                uuid primary key default gen_random_uuid(),
  email             text not null unique check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  first_name        text check (length(first_name) <= 60),
  status            text not null default 'pending' check (status in ('pending','confirmed','unsubscribed')),
  source            text check (length(source) <= 60),
  magnet_delivered  boolean not null default false,
  consent_at        timestamptz not null default now(),
  confirm_token     uuid not null default gen_random_uuid(),
  unsubscribe_token uuid not null default gen_random_uuid(),
  confirm_sent_at   timestamptz,
  confirmed_at      timestamptz,
  unsubscribed_at   timestamptz,
  created_at        timestamptz not null default now()
);
create unique index if not exists subscribers_confirm_token on public.subscribers(confirm_token);
create unique index if not exists subscribers_unsub_token   on public.subscribers(unsubscribe_token);
create index if not exists subscribers_status on public.subscribers(status);
alter table public.subscribers enable row level security;

-- public may only INSERT a brand-new pending row, and only these columns
revoke all on public.subscribers from anon, authenticated;
grant insert (email, first_name, source) on public.subscribers to anon, authenticated;
grant select, update, delete on public.subscribers to authenticated;
drop policy if exists "public can sign up" on public.subscribers;
create policy "public can sign up" on public.subscribers
  for insert to anon, authenticated with check (status = 'pending' and magnet_delivered = false);
create policy "admin reads subscribers"   on public.subscribers for select to authenticated using (public.is_admin());
drop policy if exists "admin updates subscribers" on public.subscribers;
create policy "admin updates subscribers" on public.subscribers for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin deletes subscribers" on public.subscribers;
create policy "admin deletes subscribers" on public.subscribers for delete to authenticated using (public.is_admin());

-- polls ----------------------------------------------------------------------
create table if not exists public.polls (
  id         uuid primary key default gen_random_uuid(),
  question   text not null check (length(question) <= 200),
  options    jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 8),
  is_active  boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.polls enable row level security;
grant select on public.polls to anon, authenticated;
grant insert, update, delete on public.polls to authenticated;
drop policy if exists "anyone sees active polls" on public.polls;
create policy "anyone sees active polls" on public.polls for select using (is_active or public.is_admin());
drop policy if exists "admin writes polls" on public.polls;
create policy "admin writes polls" on public.polls for all to authenticated using (public.is_admin()) with check (public.is_admin());

create table if not exists public.poll_votes (
  id               uuid primary key default gen_random_uuid(),
  poll_id          uuid not null references public.polls(id) on delete cascade,
  option_index     int  not null check (option_index between 0 and 7),
  voter_key        uuid not null,                -- random id kept in the reader's browser: one vote per browser
  subscriber_email text check (subscriber_email is null or length(subscriber_email) <= 254),
  created_at       timestamptz not null default now(),
  unique (poll_id, voter_key)
);
alter table public.poll_votes enable row level security;
revoke all on public.poll_votes from anon, authenticated;
grant insert (poll_id, option_index, voter_key, subscriber_email) on public.poll_votes to anon, authenticated;
grant select, delete on public.poll_votes to authenticated;
drop policy if exists "public votes on active polls" on public.poll_votes;
create policy "public votes on active polls" on public.poll_votes for insert to anon, authenticated
  with check (exists (select 1 from public.polls p where p.id = poll_id and p.is_active
                      and option_index < jsonb_array_length(p.options)));
drop policy if exists "admin reads votes" on public.poll_votes;
create policy "admin reads votes" on public.poll_votes for select to authenticated using (public.is_admin());
drop policy if exists "admin deletes votes" on public.poll_votes;
create policy "admin deletes votes" on public.poll_votes for delete to authenticated using (public.is_admin());

-- live results without exposing who voted
create or replace function public.poll_results(p uuid)
returns table(option_index int, votes bigint)
language sql stable security definer set search_path = public as $$
  select v.option_index, count(*) from public.poll_votes v
  join public.polls pl on pl.id = v.poll_id and (pl.is_active or public.is_admin())
  where v.poll_id = p group by v.option_index;
$$;
grant execute on function public.poll_results(uuid) to anon, authenticated;

-- "ask me anything" ---------------------------------------------------------
create table if not exists public.ama_questions (
  id         uuid primary key default gen_random_uuid(),
  question   text not null check (length(question) between 3 and 600),
  name       text check (length(name) <= 60),
  issue_ref  text check (length(issue_ref) <= 60),
  answered   boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.ama_questions enable row level security;
revoke all on public.ama_questions from anon, authenticated;
grant insert (question, name, issue_ref) on public.ama_questions to anon, authenticated;
grant select, update, delete on public.ama_questions to authenticated;
drop policy if exists "public asks" on public.ama_questions;
create policy "public asks" on public.ama_questions for insert to anon, authenticated with check (answered = false);
drop policy if exists "admin manages questions" on public.ama_questions;
create policy "admin manages questions" on public.ama_questions for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- author newsletter swaps (the book-bestie exchange) -------------------------
create table if not exists public.swaps (
  id              uuid primary key default gen_random_uuid(),
  month           text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),   -- which month they want to swap, e.g. 2027-01
  author_name     text not null check (length(author_name) between 1 and 80),
  email           text not null check (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  book_title      text not null check (length(book_title) between 1 and 120),
  where_to_buy    text check (length(where_to_buy) <= 400),
  trope           text check (length(trope) <= 120),
  genre           text check (length(genre) <= 60),
  heat            text check (length(heat) <= 30),
  release_date    date,
  newsletter_link text check (length(newsletter_link) <= 400),   -- their BookFunnel/StoryOrigin swap link or signup page
  news_link       text check (length(news_link) <= 400),         -- their latest news / preorder / announcement
  cover_url       text check (length(cover_url) <= 400),
  list_size       int  check (list_size between 0 and 10000000),
  blurb           text check (length(blurb) <= 600),
  notes           text check (length(notes) <= 600),
  status          text not null default 'new' check (status in ('new','approved','declined','scheduled','sent')),
  issue_id        uuid,
  reciprocal_sent boolean not null default false,   -- did they feature you back?
  created_at      timestamptz not null default now()
);
alter table public.swaps enable row level security;
revoke all on public.swaps from anon, authenticated;
grant insert (month, author_name, email, book_title, where_to_buy, trope, genre, heat, release_date,
              newsletter_link, news_link, cover_url, list_size, blurb, notes) on public.swaps to anon, authenticated;
grant select, update, delete on public.swaps to authenticated;
drop policy if exists "authors request swaps" on public.swaps;
create policy "authors request swaps" on public.swaps for insert to anon, authenticated with check (status = 'new');
drop policy if exists "admin manages swaps" on public.swaps;
create policy "admin manages swaps" on public.swaps for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- issues you write (drafts, scheduled, sent) --------------------------------
create table if not exists public.issues (
  id           uuid primary key default gen_random_uuid(),
  subject      text not null default '' check (length(subject) <= 150),
  preheader    text not null default '' check (length(preheader) <= 200),
  blocks       jsonb not null default '[]',      -- what you typed, so drafts reopen exactly
  body_html    text not null default '',         -- rendered email (footer is always added by the server)
  status       text not null default 'draft' check (status in ('draft','scheduled','sending','sent')),
  scheduled_for timestamptz,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.issues enable row level security;
grant select, insert, update, delete on public.issues to authenticated;
drop policy if exists "admin manages issues" on public.issues;
create policy "admin manages issues" on public.issues for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.swaps drop constraint if exists swaps_issue_fk;
alter table public.swaps add constraint swaps_issue_fk foreign key (issue_id) references public.issues(id) on delete set null;

-- calendar notes / reminders you add yourself --------------------------------
create table if not exists public.reminders (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(title) <= 120),
  due_at     timestamptz not null,
  kind       text not null default 'note' check (kind in ('note','release','deadline','promo','event')),
  done       boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.reminders enable row level security;
grant select, insert, update, delete on public.reminders to authenticated;
drop policy if exists "admin manages reminders" on public.reminders;
create policy "admin manages reminders" on public.reminders for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- send log -------------------------------------------------------------------
create table if not exists public.newsletter_sends (
  id              uuid primary key default gen_random_uuid(),
  issue_id        uuid references public.issues(id) on delete set null,
  subject         text not null,
  body_html       text not null,
  sent_at         timestamptz not null default now(),
  recipient_count int not null default 0,
  is_test         boolean not null default false
);
alter table public.newsletter_sends enable row level security;
grant select on public.newsletter_sends to authenticated;
drop policy if exists "admin reads sends" on public.newsletter_sends;
create policy "admin reads sends" on public.newsletter_sends for select to authenticated using (public.is_admin());

-- one row of public counters for the site ("join 240 readers") -------------
create or replace function public.reader_count() returns bigint
language sql stable security definer set search_path = public as $$
  select count(*) from public.subscribers where status = 'confirmed';
$$;
grant execute on function public.reader_count() to anon, authenticated;

-- starter poll -------------------------------------------------------------
insert into public.polls (question, options, is_active)
select 'Pick the next trope 𖹭', '["rivals-to-lovers","fake dating","forced proximity","forbidden coach-player"]'::jsonb, true
where not exists (select 1 from public.polls);
