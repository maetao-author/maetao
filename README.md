# mae tao ♡ author website

A single-file website for author Mae Tao: your debut book (3D cover, mini 3D library, release countdown),
eBook / signed-copy buy buttons, newsletter + secret shelf, community board (characters, emoji reactions, GIFs and photos), early reader team, events and letters in envelopes.

## Editing
Everything you'll change lives in the **settings block at the top of `index.html`** (`window.MAE_SITE`):
books, prices, buy links, bio, events, letters, newsletter and contact links, socials, bonus content.

## Hosting
Served with GitHub Pages from the `main` branch. Any change pushed to `main` goes live in a minute or two.

## Community board
Runs in preview mode until a free Supabase database is connected. See `SETUP-community.md` and `supabase/schema.sql`.

## Newsletter (own system: Supabase + Gmail relay)
Signup pop-up, reader magnet, double opt-in, trope poll, ask-me-anything, author swap exchange (`/swap`) and a private dashboard (`/admin`).
Letters send from mtao.author@gmail.com through a Google Apps Script relay (`apps-script/`).
Setup steps, deliverability notes and launch tests: **`SETUP-newsletter.md`**. Website settings: `nl/config.js`.
