-- 𖹭 Step 2: Resend Broadcasts sync + self-serve author swaps.
-- Run after 0001 (SQL Editor → paste → Run). Safe to run twice.

-- subscribers: remember their Resend contact + why they left -----------------
alter table public.subscribers add column if not exists resend_state text not null default 'none'
  check (resend_state in ('none', 'subscribed', 'unsubscribed'));
alter table public.subscribers add column if not exists unsub_reason text
  check (unsub_reason is null or unsub_reason in ('link', 'resend', 'bounced', 'complained', 'admin'));

-- issues: which Resend broadcast carried them ---------------------------------
alter table public.issues add column if not exists broadcast_id text;

-- swaps: authors add and edit their own entry through the "swap" function -----
alter table public.swaps add column if not exists edit_token uuid not null default gen_random_uuid();
alter table public.swaps add column if not exists invited boolean not null default false;   -- came in with a friend pass
alter table public.swaps add column if not exists invite_code text;
alter table public.swaps add column if not exists updated_at timestamptz not null default now();
create unique index if not exists swaps_edit_token on public.swaps(edit_token);

-- the public no longer writes to swaps directly: the function checks codes, emails the edit link
revoke insert on public.swaps from anon, authenticated;
drop policy if exists "authors request swaps" on public.swaps;

-- friend passes: codes Mae gives to author friends / co-authors ------------------
-- With a code, a swap is approved straight away and lands in the next letter on its own.
create table if not exists public.swap_invites (
  code       text primary key check (code ~ '^[A-Za-z0-9-]{4,40}$'),
  label      text not null check (length(label) between 1 and 80),   -- who it's for, e.g. "Jo (co-author)"
  max_uses   int check (max_uses is null or max_uses > 0),
  uses       int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.swap_invites enable row level security;
grant select, insert, update, delete on public.swap_invites to authenticated;
drop policy if exists "admin manages invites" on public.swap_invites;
create policy "admin manages invites" on public.swap_invites for all to authenticated using (public.is_admin()) with check (public.is_admin());
