# 𖹭 Your newsletter: setup guide

Everything is free to start: **GitHub Pages** (website), **Supabase** (database + email functions), **Resend** (sending).
**Firebase** stays only for your community board, as it is today. The newsletter doesn't use it.
Set aside about an hour. Do the steps in order.

### How sending is split (so the free limits never stop a send)
| Email | Sent as | Resend free limit |
|---|---|---|
| confirm-your-email, welcome + bonus chapter, swap edit links, your test sends | **transactional** (`/emails`) | 100 a day, 3,000 a month |
| your 2x/month letter | **one Broadcast** to your newsletter segment | unlimited emails to up to 1,000 contacts |

Only **confirmed** readers are ever added to the Resend segment, so pending readers can't receive a letter.
Unsubscribes, bounces and spam complaints come back through a webhook and update your database automatically.

## What's in the repo

| Where | What it is |
|---|---|
| `index.html` | your website, now with the signup pop-up, release-day reminder and trope poll |
| `newsletter/` | landing page for the reader magnet (Stephen's first-date chapter), poll, ask-me-anything |
| `thanks/` `confirmed/` `unsubscribe/` | the signup → confirm → unsubscribe pages |
| `swap/` | **book besties**: other authors request a newsletter swap (month, name, email, title, where to buy, trope, heat, release date, swap link, news link, cover, hook) |
| `admin/` | **mae's desk**, just for you: write + preview + schedule + send, calendar, reminders, readers, swaps, polls, questions |
| `nl/config.js` | the only file you edit on the website side |
| `supabase/` | database rules (`migrations/`) and the five email functions (`functions/`) |

Until step 6 is done, every page runs in **preview mode** with sample data, so you can look around at `yoursite/admin/`.

---

## 1 · Supabase (database)
1. supabase.com → New project (free). Pick the region closest to your readers.
2. **SQL Editor** → paste all of `supabase/migrations/0001_newsletter.sql` → Run. Then do the same with `0002_broadcasts_and_self_serve_swaps.sql`.
3. In the SQL editor run: `insert into public.admins(email) values ('mtao.author@gmail.com');`
4. **Authentication → Users → Add user**: `mtao.author@gmail.com` with a strong password, and tick *auto-confirm*.
5. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up". Only you can log in.
6. **Authentication → URL Configuration**: Site URL = `https://YOURDOMAIN`, and add `https://YOURDOMAIN/admin/` to Redirect URLs (for the "email me a link" login).

## 2 · Resend (sending) + your domain
1. resend.com → sign up → **Domains → Add domain**. Use a sending subdomain such as `mail.YOURDOMAIN` (keeps your main domain's reputation safe).
2. Resend shows the DNS records. Add them **exactly** at your domain registrar (see checklist below).
3. Click **Verify**. Usually 15 minutes, up to 72 hours.
4. **API Keys**: use your key (or make one with **Full access**: Broadcasts and contacts need more than "sending access"). It goes in step 3 only. Never paste it into the website, GitHub, or a chat.
5. **Audience → Segments → create** one called `newsletter`. Copy its id → `RESEND_SEGMENT_ID` in step 3.
6. **Webhooks → Add endpoint**: `https://YOUR-PROJECT.supabase.co/functions/v1/resend-webhook`, tick `email.bounced`, `email.complained` and `contact.updated`. Copy its signing secret (`whsec_…`) → `RESEND_WEBHOOK_SECRET`.

### Deliverability checklist (don't skip!)
| Type | Name / host | Value | Why |
|---|---|---|---|
| MX | `send.mail` (as Resend shows) | `feedback-smtp.<region>.amazonses.com`, priority 10 | bounces come back to Resend (SPF) |
| TXT | `send.mail` | `v=spf1 include:amazonses.com ~all` | SPF: Resend may send for you |
| TXT | `resend._domainkey.mail` | the long `p=MIGf…` key Resend generates | DKIM: proves the email wasn't changed |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:you@YOURDOMAIN;` | DMARC: tells Gmail/Yahoo what to do with fakes |

- Copy names and values from Resend's **Records** tab. The table shows the pattern; your values will differ.
- On Cloudflare, set records to **DNS only** (grey cloud).
- **Supabase needs no DNS records.** Optional: Supabase → Auth → SMTP Settings → host `smtp.resend.com`, port `465`, user `resend`, password = a Resend API key. Then your login emails come from your domain too.
- After verifying, send yourself a test to Gmail and open **⋮ → Show original**: SPF, DKIM and DMARC should all say **PASS**.
- After about a month of clean sends, tighten DMARC to `p=quarantine`, and later to `p=reject`.
- Use a real postal address in POSTAL_ADDRESS (a PO box or virtual mailbox is fine). Anti-spam laws (CAN-SPAM and others) require it.

## 3 · Secrets (Supabase → Edge Functions → Secrets)
Add each name from `.env.example` with your real value: `RESEND_API_KEY`, `RESEND_SEGMENT_ID`, `RESEND_WEBHOOK_SECRET`, `FROM_EMAIL` (`Mae Tao <hello@mail.YOURDOMAIN>`), `REPLY_TO`, `SITE_URL`, `POSTAL_ADDRESS`, `MAGNET_URL` (your BookFunnel/PDF link for the bonus chapter), `MAGNET_NAME`, `BOOK_RELEASE`, `SEND_DAYS`, plus two random passwords you make up: `CRON_SECRET` and `CALENDAR_KEY`.

**Never** put the Resend key or the Supabase *service_role* key in `nl/config.js`, `index.html`, or anywhere in GitHub.

## 4 · Deploy the email functions
Easiest: GitHub → Settings → Secrets and variables → Actions → add `SUPABASE_ACCESS_TOKEN` (supabase.com → Account → Access Tokens) and `SUPABASE_PROJECT_REF` (the `abcdxyz` in `https://abcdxyz.supabase.co`). Every push to `main` then deploys them automatically (`.github/workflows/deploy.yml`).
Or by hand, with the Supabase CLI: `supabase functions deploy subscribe --no-verify-jwt`, and the same for `confirm`, `unsubscribe`, `send-newsletter`, `calendar-feed`, `swap` and `resend-webhook`.

## 5 · Website
1. GitHub → Settings → Pages → **Source: GitHub Actions** (the workflow builds and publishes the site and blocks a deploy if a secret key slips in). Custom domain: `YOURDOMAIN`.
   DNS for the website: four `A` records on `@` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`, plus `CNAME www → maetao-author.github.io`.
2. Edit `nl/config.js`: `supabaseUrl` and `anonKey` (Supabase → Project Settings → API → the **anon / publishable** key), and `siteUrl`.

## 6 · Automations
- **Automatic scheduled sending:** run `supabase/cron.sql` (instructions inside). Letters you schedule in /admin then go out by themselves within 10 minutes of their time. Without it, /admin shows a "due now" pop-up and you press send.
- **Your calendar:** /admin → calendar → paste your CALENDAR_KEY → **+ Google Calendar** or **+ Apple Calendar**. One subscription keeps updating by itself: send days (1st & 15th), "draft due" 3 days before, scheduled letters, swap months, swap partners' release days, your own reminders, and Call It a Let's release day.
  Apple Calendar uses the alerts built into the feed. Google ignores alerts inside subscribed calendars, so in Google Calendar → Settings → "Mae newsletter" → *Event notifications*, add "1 day before" and "2 hours before".
- **Pop-up reminders in /admin:** every time you open the desk, it pops up what needs you (letter due, swap requests, unanswered questions, approved swaps not placed yet, partners' release days, did-they-feature-you-back). Tap **turn on reminders** to also get browser notifications.

## 6½ · Book besties: self-serve swaps for author friends and co-authors
- Anyone can request a swap at `/swap`. It waits in **mae's desk → swaps** for you to approve.
- **Friend passes:** in mae's desk → swaps → *make a pass* for each author friend or co-author, then **copy their link** (`/swap/?code=…`) and send it to them. Their swap is approved instantly and drops into your next letter by itself.
- Every author gets an email with a **private edit link**, so they can fix their cover, links or hook until the letter goes out. The letter always uses their latest version.

## 7 · Before you call it done (acceptance tests)
The same list lives in /admin → setup with tick boxes.
- [ ] Sign up on /newsletter → confirmation email arrives
- [ ] Click confirm → magnet + welcome email arrive, secret shelf unlocks
- [ ] A pending (unconfirmed) address does **not** receive a newsletter (send yourself one from /admin with a second, unconfirmed email on the list)
- [ ] Unsubscribe link → one click → never emailed again (also try Gmail's own "Unsubscribe" button)
- [ ] Resend → Audience: only confirmed readers appear in the `newsletter` segment
- [ ] A friend-pass swap shows up as approved, and its edit link works
- [ ] Vote in the poll → results update, a second vote from the same browser doesn't count
- [ ] No keys in the browser: open the live site → right-click → View source, and search for `re_` and `service_role`
- [ ] Every page on your phone: no sideways scrolling

Already checked here, before you got it: the database rules (readers can't read emails, one vote per browser, only your login can see data) against a real Postgres; 43 end-to-end checks of the email functions (sign up → confirm → only confirmed readers reach the Resend segment → one Broadcast per letter → unsubscribe, bounce and complaint webhooks → self-serve swaps with friend passes and edit links → scheduled sending → calendar feed) against a stand-in Supabase and Resend; and every page at phone and desktop sizes. The live run with your real accounts is the list above.

## Pop-up ideas you can switch on later
- **Release week countdown bar** across the top of the site the 7 days before launch (`nl/embed.js` already has the corner nudge; easy to extend).
- **"You finished the sample!" pop-up** when someone reaches the end of the excerpt on the books tab, offering the bonus chapter.
- **Exit-intent on the books page** with a different hook ("leaving? take Stephen with you").
- **Anniversary note**: on a reader's one-year mark, send an automatic thank-you with a deleted scene.
- **Swap reminder email to partners** 3 days before their slot, so they remember to feature you back.

Tune the signup pop-up in `nl/config.js → popup` (delay, scroll %, exit intent, snooze days).
