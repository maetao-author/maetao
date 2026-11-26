# Turning on the community (about 15 minutes, free)

The threads, chat room, reactions, photos, bookshelves, signing notes and early reader applications all run on **Supabase** (a free database with live updates). Until it's connected they run in **preview mode**: everything works, but it's saved only in the browser you're using.

## 1. Make the database

1. Go to **supabase.com** → sign up → **New project**. Pick any name (e.g. `maetao-site`), make up a database password (you won't need it for the site), and pick the region closest to your readers.
2. When it's ready, open **SQL Editor** → **New query**.
3. Open `supabase/schema.sql` from this folder. On the line marked ✎ near the top, change `your-email@gmail.com` to the Google email you'll sign in with (lowercase).
4. Paste the whole file into the SQL Editor and click **Run**. It should say *Success*. (Safe to run again later: it only adds what's missing and refreshes the rules.)

## 2. Sign-in

Readers never make an account: the site signs them in anonymously in the background. Only you sign in, with Google.

1. **Authentication → Sign In / Providers**: turn on **Allow anonymous sign-ins**. Turn **Email** off (nobody needs it, and it keeps anyone from making an account with your email).
2. Still there, open **Google** and turn it on. It asks for a *Client ID* and *Client Secret* from Google:
   - Go to **console.cloud.google.com** → create a project → **APIs & Services → OAuth consent screen** (External, app name "Mae Tao", your email) → **Credentials → Create credentials → OAuth client ID** → *Web application*.
   - Under **Authorized redirect URIs** paste the *Callback URL* that Supabase shows on its Google page (it looks like `https://xxxx.supabase.co/auth/v1/callback`).
   - Copy the Client ID and Client Secret back into Supabase and **Save**.
3. **Authentication → URL Configuration**: set **Site URL** to your website's address (e.g. `https://maetao.com`) and add the same address under **Redirect URLs**.

## 3. Connect the site

1. **Project Settings → API Keys** (or the **Connect** button at the top): copy the **Project URL** and the **publishable key** (starts with `sb_publishable_`). Never use the *secret* key on the website.
2. In `index.html`, paste them into `community.supabase` in the settings block: `supabase: { url: "https://xxxx.supabase.co", key: "sb_publishable_…" }`.
3. Upload the site. Open the **community** tab, scroll to "house rules" and click **are you Mae? sign in**. After Google sends you back you'll see the "♡ author" badge, pin / delete / status buttons, and **mae's desk** with signing notes and early reader applications.

## What's stored where

| What | Table / place | Who can see it |
|---|---|---|
| Profiles (@name, character, colour) | `profiles` | everyone |
| Threads and nested replies | `posts`, `replies` | everyone |
| Chat room | `chat` | everyone |
| Emoji reactions, ♡ votes | `reactions`, `post_hearts` | everyone |
| Photos | Storage bucket `photos` (free up to 1 GB) | everyone |
| Bookshelves | `user_library` | only that reader, and you |
| Signing notes, early reader applications | `signings`, `arc` | only you |

The rules in `schema.sql` make sure nobody can post as someone else, take the name *maetao*, edit other people's posts or reactions, or read the private forms. Names, characters and the author badge are filled in by the database from each person's profile, not by the browser.

## GIFs (GIPHY)

The key is already in `giphyKey`. To use a different one: **developers.giphy.com** → **Create an App** → **API** → copy the key into `giphyKey`.

## Chat room, music and bookshelf

- **Chat room:** one live room for everyone. "here now" shows who has the chat open right now.
- **Music:** each CD plays the full song through YouTube's own player (it has to stay visible, so it sits in the corner). Some videos start with an ad; that's the video owner's choice. Change songs in the `music` block: `title`, `artist`, and a `youtube` link. The cover comes from Apple Music; if a phone can't reach Apple, the YouTube picture is used instead. Songs readers find with search play 30-second previews.
- **My bookshelf:** each reader adds the books they own (edition and whether it's signed). Set `pages` on each book so the spine is the right thickness.
- **New purchases dropping onto the shelf automatically:** a store webhook can add a row to `user_library` with the secret key (from a small server or a Supabase Edge Function) and it slides onto that reader's shelf live. Readers are anonymous, so the store purchase needs to be matched to a reader somehow (for example a code they paste). Tell Claude which store you use and it can set this up.

## Notifications (next)

Firebase stays only for push notifications when someone @mentions a reader. That part isn't built yet: it needs a Firebase project for the notification keys and a small Supabase function to send them.

**Moderating:** as Mae you can delete any post, reply or chat message, pin posts, and mark ideas as *thinking about it*, *planned* or *done*.
