-- ♡ Mae Tao community: database for posts, threads, the chat room, reactions, photos and bookshelves.
-- How to use: Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
-- Before running it, put the Google email you sign in with on the line marked ✎ below (lowercase).
-- It is safe to run again after changes; it only adds what is missing and refreshes the rules.

-- ---------- who is Mae ----------
create schema if not exists private;
create table if not exists private.owner (email text primary key);
delete from private.owner;
insert into private.owner (email) values ('your-email@gmail.com');   -- ✎ your Google email
grant usage on schema private to anon, authenticated;
grant select on private.owner to anon, authenticated;   -- "private" isn't reachable from the website, only from these rules

-- Mae = signed in with Google, with the owner email. Anonymous readers and email/password accounts never count.
create or replace function public.is_mae() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(
    not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
    and coalesce((select auth.jwt()) -> 'app_metadata' -> 'providers', '[]'::jsonb) ? 'google'
    and lower(coalesce((select auth.jwt()) ->> 'email', '')) in (select lower(o.email) from private.owner o),
  false)
$$;

-- ---------- reader profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_.]{3,20}$'),
  emoji text not null check (char_length(emoji) between 1 and 8),
  color text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  updated_at timestamptz not null default now()
);

-- ---------- shared pieces of a post, reply or chat message ----------
-- gif / sticker: a GIPHY id.  photo: "<user id>/<name>.jpg" in the photos storage bucket.
-- song: { id, t, a, art, p, y } (iTunes id, title, artist, cover, 30 s preview, optional YouTube id)
create or replace function private.ok_song(s jsonb) returns boolean language sql immutable set search_path = '' as $$
  select s is null or coalesce(
    jsonb_typeof(s) = 'object' and s ?& array['id', 't', 'a', 'art', 'p']
    and (s - array['id', 't', 'a', 'art', 'p', 'y']) = '{}'::jsonb
    and (s ->> 'id') ~ '^[0-9]{1,15}$'
    and char_length(s ->> 't') <= 120 and char_length(s ->> 'a') <= 120
    and char_length(s ->> 'art') <= 450 and (s ->> 'art') ~ '^https://is[0-9]-ssl\.mzstatic\.com/[^\s"''<>]+$'
    and char_length(s ->> 'p') <= 550 and (s ->> 'p') ~ '^https://audio-ssl\.itunes\.apple\.com/[^\s"''<>]+$'
    and (not s ? 'y' or (s ->> 'y') ~ '^[A-Za-z0-9_-]{11}$'),
  false)
$$;
grant execute on function private.ok_song(jsonb) to anon, authenticated;

-- ---------- posts (the threads feed) ----------
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  uid uuid not null default auth.uid() references auth.users (id) on delete cascade,
  handle text not null default '', emoji text not null default '', color text not null default '',
  type text not null default 'chat' check (type in ('chat', 'ask', 'idea')),
  text text not null default '' check (char_length(text) <= 1000),
  gif text check (gif ~ '^[A-Za-z0-9]{4,40}$'),
  sticker text check (sticker ~ '^[A-Za-z0-9]{4,40}$'),
  photo text check (photo ~ '^[0-9a-f-]{36}/[A-Za-z0-9]{6,40}\.jpg$'),
  reply_count int not null default 0,
  status text not null default '' check (status in ('', 'considering', 'planned', 'done')),
  pinned boolean not null default false,
  is_mae boolean not null default false,
  mae_replied boolean not null default false,
  created_at timestamptz not null default now(),
  constraint post_has_body check (char_length(text) > 0 or gif is not null or sticker is not null or photo is not null)
);
create index if not exists posts_created on public.posts (created_at desc);

-- ---------- replies (nested: parent is the reply being answered) ----------
create table if not exists public.replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  parent uuid references public.replies (id) on delete set null,
  uid uuid not null default auth.uid() references auth.users (id) on delete cascade,
  handle text not null default '', emoji text not null default '', color text not null default '',
  text text not null default '' check (char_length(text) <= 1000),
  gif text check (gif ~ '^[A-Za-z0-9]{4,40}$'),
  sticker text check (sticker ~ '^[A-Za-z0-9]{4,40}$'),
  photo text check (photo ~ '^[0-9a-f-]{36}/[A-Za-z0-9]{6,40}\.jpg$'),
  is_mae boolean not null default false,
  created_at timestamptz not null default now(),
  constraint reply_has_body check (char_length(text) > 0 or gif is not null or sticker is not null or photo is not null)
);
create index if not exists replies_post on public.replies (post_id, created_at);

-- ---------- the live chat room ----------
create table if not exists public.chat (
  id uuid primary key default gen_random_uuid(),
  uid uuid not null default auth.uid() references auth.users (id) on delete cascade,
  handle text not null default '', emoji text not null default '', color text not null default '',
  text text not null default '' check (char_length(text) <= 500),
  gif text check (gif ~ '^[A-Za-z0-9]{4,40}$'),
  sticker text check (sticker ~ '^[A-Za-z0-9]{4,40}$'),
  photo text check (photo ~ '^[0-9a-f-]{36}/[A-Za-z0-9]{6,40}\.jpg$'),
  song jsonb check (private.ok_song(song)),
  is_mae boolean not null default false,
  created_at timestamptz not null default now(),
  constraint chat_has_body check (char_length(text) > 0 or gif is not null or sticker is not null or photo is not null or song is not null)
);
create index if not exists chat_created on public.chat (created_at desc);

-- ---------- emoji reactions and hearts: one row per person per emoji ----------
create table if not exists public.reactions (
  id bigint generated always as identity primary key,
  uid uuid not null default auth.uid() references auth.users (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  post_id uuid references public.posts (id) on delete cascade,
  reply_id uuid references public.replies (id) on delete cascade,
  chat_id uuid references public.chat (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint one_target check (num_nonnulls(post_id, reply_id, chat_id) = 1)
);
create unique index if not exists reactions_once on public.reactions (uid, emoji, coalesce(post_id, reply_id, chat_id));
create index if not exists reactions_post on public.reactions (post_id);
create index if not exists reactions_reply on public.reactions (reply_id);
create index if not exists reactions_chat on public.reactions (chat_id);

create table if not exists public.post_hearts (
  post_id uuid not null references public.posts (id) on delete cascade,
  uid uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (post_id, uid)
);

-- ---------- each reader's bookshelf (private to them and Mae) ----------
create table if not exists public.user_library (
  id uuid primary key default gen_random_uuid(),
  uid uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book text not null check (book ~ '^[A-Za-z0-9_-]{1,60}$'),
  edition text not null default 'paperback' check (edition in ('ebook', 'paperback', 'hardcover', 'special')),
  signed boolean not null default false,
  source text not null default 'reader' check (source in ('reader', 'store')),
  added_at timestamptz not null default now(),
  unique (uid, book, edition)
);

-- ---------- private forms: signing notes and early reader applications (only Mae reads them) ----------
create table if not exists public.signings (
  id uuid primary key default gen_random_uuid(),
  book text not null default '' check (char_length(book) <= 80),
  format text not null default '' check (char_length(format) <= 40),
  sign_to text not null check (char_length(sign_to) between 1 and 80),
  message text not null default '' check (char_length(message) <= 300),
  email text not null check (char_length(email) between 3 and 120),
  created_at timestamptz not null default now()
);
create table if not exists public.arc (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  email text not null check (char_length(email) between 3 and 120),
  profile text not null default '' check (char_length(profile) <= 200),
  why text not null default '' check (char_length(why) <= 800),
  "where" text not null default '' check (char_length("where") <= 10),
  created_at timestamptz not null default now()
);

-- ---------- filled in by the database, so nobody can post as someone else ----------
-- name, character, colour and the "author" badge are copied from the writer's profile; the time is the server's.
create or replace function private.stamp() returns trigger language plpgsql set search_path = '' as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = (select auth.uid());
  if p.id is null then raise exception 'make a profile first' using errcode = '42501'; end if;
  new.uid := p.id; new.handle := p.handle; new.emoji := p.emoji; new.color := p.color;
  new.is_mae := public.is_mae(); new.created_at := now();
  if tg_table_name = 'posts' then
    new.reply_count := 0; new.status := ''; new.pinned := false; new.mae_replied := false;
  end if;
  return new;
end $$;

-- replying bumps the post's reply count (and marks "Mae replied"). Runs as the table owner because readers can't edit others' posts.
create or replace function private.count_replies() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.posts set reply_count = reply_count + 1, mae_replied = mae_replied or new.is_mae where id = new.post_id;
  else
    update public.posts set reply_count = greatest(reply_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end $$;
revoke all on function private.count_replies() from public, anon, authenticated;

-- no more than 20 reactions per person on one thing, and no more than 60 books per shelf
create or replace function private.limit_reactions() returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.reactions r where r.uid = new.uid
      and coalesce(r.post_id, r.reply_id, r.chat_id) = coalesce(new.post_id, new.reply_id, new.chat_id)) >= 20 then
    raise exception 'too many reactions' using errcode = '42501';
  end if;
  return new;
end $$;
create or replace function private.limit_shelf() returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.user_library l where l.uid = new.uid) >= 60 then
    raise exception 'the shelf is full' using errcode = '42501';
  end if;
  return new;
end $$;

-- the author can only change a post's status and pin (it's the "planned / done" tracker), not someone's words
create or replace function private.mae_edits_only() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.uid, new.handle, new.emoji, new.color, new.type, new.text, new.gif, new.sticker, new.photo, new.is_mae, new.created_at)
     is distinct from (old.uid, old.handle, old.emoji, old.color, old.type, old.text, old.gif, old.sticker, old.photo, old.is_mae, old.created_at)
     and current_user in ('anon', 'authenticated') then
    raise exception 'only the status and pin can change' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists stamp on public.posts;   create trigger stamp before insert on public.posts for each row execute function private.stamp();
drop trigger if exists stamp on public.replies; create trigger stamp before insert on public.replies for each row execute function private.stamp();
drop trigger if exists stamp on public.chat;    create trigger stamp before insert on public.chat for each row execute function private.stamp();
drop trigger if exists counts on public.replies; create trigger counts after insert or delete on public.replies for each row execute function private.count_replies();
drop trigger if exists limits on public.reactions; create trigger limits before insert on public.reactions for each row execute function private.limit_reactions();
drop trigger if exists limits on public.user_library; create trigger limits before insert on public.user_library for each row execute function private.limit_shelf();
drop trigger if exists mae_edits on public.posts; create trigger mae_edits before update on public.posts for each row execute function private.mae_edits_only();

-- ---------- who can do what (row level security) ----------
-- Readers sign in anonymously (no account, no email); they still count as "authenticated" here.
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.replies enable row level security;
alter table public.chat enable row level security;
alter table public.reactions enable row level security;
alter table public.post_hearts enable row level security;
alter table public.user_library enable row level security;
alter table public.signings enable row level security;
alter table public.arc enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
    and tablename in ('profiles', 'posts', 'replies', 'chat', 'reactions', 'post_hearts', 'user_library', 'signings', 'arc')
  loop execute format('drop policy %I on public.%I', r.policyname, r.tablename); end loop;
end $$;

-- profiles: everyone can see them; you edit only your own; mae / admin-style names are only for Mae
create policy "read profiles" on public.profiles for select to anon, authenticated using (true);
create policy "make my profile" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()) and (handle not in ('mae', 'maetao', 'mae_tao', 'mae.tao', 'admin', 'official', 'moderator') or (select public.is_mae())));
create policy "edit my profile" on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and (handle not in ('mae', 'maetao', 'mae_tao', 'mae.tao', 'admin', 'official', 'moderator') or (select public.is_mae())));

-- posts, replies, chat: everyone reads; you write as yourself (and only attach your own photos); you or Mae can delete
create policy "read posts" on public.posts for select to anon, authenticated using (true);
create policy "write a post" on public.posts for insert to authenticated
  with check (uid = (select auth.uid()) and (photo is null or split_part(photo, '/', 1) = (select auth.uid())::text));
create policy "mae sets status and pins" on public.posts for update to authenticated using ((select public.is_mae())) with check ((select public.is_mae()));
create policy "delete a post" on public.posts for delete to authenticated using (uid = (select auth.uid()) or (select public.is_mae()));

create policy "read replies" on public.replies for select to anon, authenticated using (true);
create policy "write a reply" on public.replies for insert to authenticated
  with check (uid = (select auth.uid()) and (photo is null or split_part(photo, '/', 1) = (select auth.uid())::text)
    and (parent is null or exists (select 1 from public.replies p where p.id = replies.parent and p.post_id = replies.post_id)));
create policy "delete a reply" on public.replies for delete to authenticated using (uid = (select auth.uid()) or (select public.is_mae()));

create policy "read chat" on public.chat for select to anon, authenticated using (true);
create policy "say something" on public.chat for insert to authenticated
  with check (uid = (select auth.uid()) and (photo is null or split_part(photo, '/', 1) = (select auth.uid())::text));
create policy "delete a message" on public.chat for delete to authenticated using (uid = (select auth.uid()) or (select public.is_mae()));

-- reactions and hearts: add or remove only your own
create policy "read reactions" on public.reactions for select to anon, authenticated using (true);
create policy "react" on public.reactions for insert to authenticated with check (uid = (select auth.uid()));
create policy "unreact" on public.reactions for delete to authenticated using (uid = (select auth.uid()));
create policy "read hearts" on public.post_hearts for select to anon, authenticated using (true);
create policy "heart" on public.post_hearts for insert to authenticated with check (uid = (select auth.uid()));
create policy "unheart" on public.post_hearts for delete to authenticated using (uid = (select auth.uid()));

-- bookshelf: yours only (Mae can see everyone's). A store webhook adds books with the service key, which skips these.
create policy "see my shelf" on public.user_library for select to authenticated using (uid = (select auth.uid()) or (select public.is_mae()));
create policy "add to my shelf" on public.user_library for insert to authenticated with check (uid = (select auth.uid()) and source = 'reader');
create policy "edit my shelf" on public.user_library for update to authenticated using (uid = (select auth.uid())) with check (uid = (select auth.uid()));
create policy "remove from my shelf" on public.user_library for delete to authenticated using (uid = (select auth.uid()));

-- private forms: anyone can send one; only Mae can read or delete them
create policy "send a signing note" on public.signings for insert to authenticated with check (true);
create policy "mae reads signing notes" on public.signings for select to authenticated using ((select public.is_mae()));
create policy "mae deletes signing notes" on public.signings for delete to authenticated using ((select public.is_mae()));
create policy "apply for early copies" on public.arc for insert to authenticated with check (true);
create policy "mae reads applications" on public.arc for select to authenticated using ((select public.is_mae()));
create policy "mae deletes applications" on public.arc for delete to authenticated using ((select public.is_mae()));

-- the website can only reach these tables, in these ways (row level security above narrows it further)
revoke all on public.profiles, public.posts, public.replies, public.chat, public.reactions, public.post_hearts,
  public.user_library, public.signings, public.arc from anon, authenticated;
grant select on public.profiles, public.posts, public.replies, public.chat, public.reactions, public.post_hearts to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant insert, delete on public.posts, public.replies, public.chat, public.reactions, public.post_hearts to authenticated;
grant update (status, pinned) on public.posts to authenticated;
grant select, insert, update (signed), delete on public.user_library to authenticated;
grant insert, select, delete on public.signings, public.arc to authenticated;
grant execute on function public.is_mae() to anon, authenticated;

-- ---------- live updates ----------
do $$ declare t text; begin
  foreach t in array array['posts', 'replies', 'chat', 'reactions', 'post_hearts', 'user_library'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
-- so a removed reaction or heart tells everyone which post it was on
alter table public.reactions replica identity full;
alter table public.post_hearts replica identity full;

-- ---------- photos (Storage bucket, free up to 1 GB) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 800000, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 800000, allowed_mime_types = array['image/jpeg'];

drop policy if exists "upload my photos" on storage.objects;
drop policy if exists "see my photos" on storage.objects;
drop policy if exists "delete my photos" on storage.objects;
create policy "upload my photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "see my photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_mae())));
create policy "delete my photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_mae())));
