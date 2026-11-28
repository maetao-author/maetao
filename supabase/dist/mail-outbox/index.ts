// mail-outbox: single-file build of supabase/functions/mail-outbox (generated; edit the source files instead)
// ===== util.ts =====
// Shared helpers for the edge functions. Secrets come ONLY from Supabase function secrets
// (supabase secrets set ...), never from the website or GitHub.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.

const env = (k: string, d = '') => (globalThis as any).Deno?.env.get(k) ?? d;

const cfg = {
  url: env('SUPABASE_URL'),
  service: env('SUPABASE_SERVICE_ROLE_KEY'),
  resendKey: env('RESEND_API_KEY'),
  segmentId: env('RESEND_SEGMENT_ID'),                          // Resend → Audience → Segments → your newsletter segment id
  webhookSecret: env('RESEND_WEBHOOK_SECRET'),                   // Resend → Webhooks → signing secret (whsec_...)
  mailProvider: env('MAIL_PROVIDER', 'gmail'),                   // 'gmail' (Apps Script relay) or 'resend' (needs your own domain)
  gmailUser: env('GMAIL_USER', 'mtao.author@gmail.com'),
  relayUrl: env('MAIL_RELAY_URL', ''),                           // the Apps Script web app link (not a secret)
  dailyCap: Number(env('MAIL_DAILY_CAP', '90')),                 // stay under Gmail's limit (Apps Script: 100/day on gmail.com)
  from: env('FROM_EMAIL', 'Mae Tao <hello@example.com>'),       // used for Resend only
  replyTo: env('REPLY_TO', ''),
  site: env('SITE_URL', '').replace(/\/$/, ''),                  // "https://YOURDOMAIN"
  address: env('POSTAL_ADDRESS', ''),                            // required by anti-spam law
  magnetUrl: env('MAGNET_URL', ''),                              // link to the bonus scene (BookFunnel, PDF, etc.)
  magnetName: env('MAGNET_NAME', "Stephen's first-date chapter"),
  cronSecret: env('CRON_SECRET', ''),
  calendarKey: env('CALENDAR_KEY', ''),
  release: env('BOOK_RELEASE', ''),                              // "2026-11-30"
  sendDays: env('SEND_DAYS', '1,15'),                            // newsletter days of the month
};

const fnUrl = (name: string) => `${cfg.url}/functions/v1/${name}`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const preflight = (req: Request) => req.method === 'OPTIONS' ? new Response('ok', { headers: CORS }) : null;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// tiny PostgREST client using the service role (bypasses RLS: server-side only)
async function db(path: string, init: RequestInit & { prefer?: string } = {}) {
  const r = await fetch(`${cfg.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: cfg.service, Authorization: `Bearer ${cfg.service}`, 'Content-Type': 'application/json',
      Prefer: init.prefer || 'return=representation', ...(init.headers || {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function resend(path: string, payload?: unknown, method = 'POST') {
  if (!cfg.resendKey) throw new Error('RESEND_API_KEY is not set');
  const r = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.resendKey}`, 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`resend ${r.status}: ${JSON.stringify(body)}`);
  return body;
}

// who is calling? returns the admin's email, or null
async function adminEmail(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const r = await fetch(`${cfg.url}/auth/v1/user`, { headers: { apikey: cfg.service, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const email = String(u?.email || '').toLowerCase();
  if (!email) return null;
  const rows = await db(`admins?email=eq.${encodeURIComponent(email)}&select=email`);
  return rows.length ? email : null;
}

const unsubLink = (token: string) => `${cfg.site}/unsubscribe/?t=${token}`;
const oneClickLink = (token: string) => `${fnUrl('unsubscribe')}?t=${token}`;

// ---- Resend contacts (the newsletter list lives in a Resend segment) ----------
// Only CONFIRMED readers are ever added, so pending readers can never get a broadcast.
async function addToResend(sub: { id: string; email: string; first_name?: string | null }) {
  if (!cfg.segmentId) throw new Error('RESEND_SEGMENT_ID is not set');
  try {
    await resend('/contacts', { email: sub.email, first_name: sub.first_name || undefined, unsubscribed: false, segments: [{ id: cfg.segmentId }] });
  } catch (_e) {
    // already a contact (e.g. they came back): switch them back on
    await resend(`/contacts/${encodeURIComponent(sub.email)}`, { unsubscribed: false, first_name: sub.first_name || undefined }, 'PATCH');
  }
  await db(`subscribers?id=eq.${sub.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ resend_state: 'subscribed' }) });
}
async function removeFromResend(sub: { id: string; email: string }) {
  try { await resend(`/contacts/${encodeURIComponent(sub.email)}`, { unsubscribed: true }, 'PATCH'); } catch (e) { console.error('resend unsub', e); return; }
  await db(`subscribers?id=eq.${sub.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ resend_state: 'unsubscribed' }) });
}

// ---- one way to send any email ------------------------------------------------
// gmail: the email waits in mail_queue and Mae's Apps Script relay sends it from her Gmail.
// resend: sent straight away through Resend (only once she has her own domain).
const htmlToText = (html: string) => html
  .replace(/<style[\s\S]*?<\/style>|<head[\s\S]*?<\/head>/gi, '')
  .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, t) => `${t.replace(/<[^>]+>/g, '').trim()} (${href})`)
  .replace(/<(br|\/p|\/h[1-6]|\/tr|\/div)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;|&#8199;|&#65279;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();

function unsubHeaders(token?: string) {
  const parts = [`<mailto:${cfg.gmailUser}?subject=unsubscribe>`];
  if (token) parts.unshift(`<${oneClickLink(token)}>`);
  return token ? { 'List-Unsubscribe': parts.join(', '), 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : { 'List-Unsubscribe': parts.join(', ') };
}

async function pingRelay() {
  if (!cfg.relayUrl) return;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
  try { await fetch(cfg.relayUrl + (cfg.relayUrl.includes('?') ? '&' : '?') + 'ping=1', { signal: ctl.signal }); } catch (_e) { /* the 5-minute timer picks it up anyway */ }
  finally { clearTimeout(t); }
}

type Mail = { to: string; subject: string; html: string; kind: 'confirm' | 'welcome' | 'swap' | 'test' | 'newsletter';
  headers?: Record<string, string>; issue_id?: string; subscriber_id?: string; priority?: number };

async function sendMail(m: Mail, opts: { ping?: boolean } = {}) {
  if (cfg.mailProvider === 'resend') {
    return resend('/emails', { from: cfg.from, to: [m.to], reply_to: cfg.replyTo || undefined, subject: m.subject, html: m.html, headers: m.headers });
  }
  await db('mail_queue', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
    kind: m.kind, priority: m.priority ?? (m.kind === 'newsletter' ? 1 : 0), to_email: m.to, subject: m.subject, html: m.html,
    text_body: htmlToText(m.html), headers: m.headers || {}, issue_id: m.issue_id || null, subscriber_id: m.subscriber_id || null }) });
  if (opts.ping !== false) await pingRelay();
}

// ===== email.js =====
// One email template, used by BOTH the edge functions (real sends) and /admin (live preview).
// Plain JavaScript on purpose, so the browser and Supabase run the exact same code.
// Email clients ignore most modern CSS, so emails use inline styles and tables,
// with soft rounded cards in Mae's palette.

const C = {
  cream: '#fbf5f0', paper: '#fffaf7', soft: '#f6ece8', blush: '#fbe3e2', pink: '#f0c1c7',
  rose: '#d98f97', deeprose: '#c66a77', sage: '#868a76', sageL: '#c7c8b9', sageXL: '#e6e7dc',
  cocoa: '#2f2427', ink: '#3a2b2f', ink2: '#7d6a6e', muted: '#9a8a8d'
};
const HEAD = "'Bricolage Grotesque','Helvetica Neue',Arial,sans-serif";   // same heading font as the website
const BODY = "'Nunito','Helvetica Neue',Arial,sans-serif";
const SERIF = "'Instrument Serif',Georgia,'Times New Roman',serif";

// Mae's heart 𖹭 needs the Noto Sans Medefaidrin font; mail apps that load web fonts show it, others fall back.
const heartSpan = s => s.replace(/𖹭/g, '<span style="font-family:\'Noto Sans Medefaidrin\',sans-serif">𖹭</span>');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => /^(https?:|mailto:)/i.test(String(u || '').trim()) ? esc(String(u).trim()) : '';
const paras = t => heartSpan(esc(t)).split(/\n{2,}/).map(p => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`).join('');

const pill = (href, label, bg = C.rose, fg = '#ffffff') => !safeUrl(href) ? '' :
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px"><tr><td style="border-radius:999px;background:${bg}">
   <a href="${safeUrl(href)}" style="display:inline-block;padding:12px 22px;font-family:${BODY};font-weight:800;font-size:14px;color:${fg};text-decoration:none;border-radius:999px">${esc(label)}</a></td></tr></table>`;

const card = (inner, bg = C.paper, fg = C.ink) =>
  `<tr><td style="padding:0 0 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border-radius:26px">
   <tr><td style="padding:24px 26px;font-family:${BODY};font-size:15.5px;line-height:1.6;color:${fg}">${inner}</td></tr></table></td></tr>`;

const sticker = (text, bg = C.pink, fg = '#5a3a41') =>
  `<span style="display:inline-block;background:${bg};color:${fg};border-radius:999px;padding:5px 14px;font-family:${SERIF};font-style:italic;font-size:16px">${heartSpan(esc(text))}</span>`;

const h = (t, color = C.ink, size = 26) => `<h2 style="margin:12px 0 8px;font-family:${HEAD};font-weight:800;font-size:${size}px;line-height:1.1;letter-spacing:-.03em;color:${color}">${heartSpan(esc(t))}</h2>`;

// ---- blocks Mae types into /admin ----------------------------------------
// every block: { type, ...fields }. Unknown types are skipped.
function renderBlocks(blocks = [], ctx = {}) {
  const site = (ctx.siteUrl || '').replace(/\/$/, '');
  const out = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'letter':
        out.push(card(`${sticker(b.sticker || 'a little letter')}${b.title ? h(b.title) : ''}
          <div style="margin-top:10px">${paras(b.text)}</div>
          ${b.signoff ? `<p style="margin:4px 0 0;font-family:${SERIF};font-style:italic;font-size:20px;color:${C.deeprose}">${esc(b.signoff)}</p>` : ''}`));
        break;
      case 'news':
        out.push(card(`${sticker(b.sticker || 'news', C.sageXL, '#4f5342')}${h(b.title || '')}${paras(b.text)}${pill(b.link, b.button || 'take a look', C.sage)}`, C.blush));
        break;
      case 'book':
        out.push(card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          ${b.cover ? `<td width="120" valign="top" style="padding-right:18px"><img src="${safeUrl(b.cover.startsWith('http') ? b.cover : site + '/' + b.cover)}" width="110" alt="${esc(b.title)} cover" style="display:block;border-radius:6px 14px 14px 6px;width:110px;height:auto"></td>` : ''}
          <td valign="top" style="font-family:${BODY};color:#fbeee9">${sticker(b.sticker || 'out now', C.pink)}
          ${h(b.title || '', '#fff4f1', 24)}<div style="color:#d8c4c7">${paras(b.text)}</div>${pill(b.link, b.button || 'grab your copy', C.rose)}</td></tr></table>`, C.cocoa, '#fbeee9'));
        break;
      case 'swap': {
        const items = (b.items || []).map(s => `<tr><td style="padding:0 0 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper};border-radius:20px"><tr>
          ${s.cover_url ? `<td width="86" valign="top" style="padding:14px 0 14px 14px"><img src="${safeUrl(s.cover_url)}" width="72" alt="" style="display:block;border-radius:4px 10px 10px 4px;width:72px;height:auto"></td>` : ''}
          <td valign="top" style="padding:14px 16px;font-family:${BODY};font-size:14.5px;color:${C.ink}">
          <div style="font-family:${HEAD};font-weight:700;font-size:19px;line-height:1.2">${esc(s.book_title)}</div>
          <div style="color:${C.ink2};font-size:13px;margin:2px 0 6px">by ${esc(s.author_name)}${s.trope ? ' · ' + esc(s.trope) : ''}${s.release_date ? ' · out ' + esc(s.release_date) : ''}</div>
          ${s.blurb ? `<div style="margin-bottom:6px">${esc(s.blurb)}</div>` : ''}
          ${safeUrl(s.where_to_buy) ? `<a href="${safeUrl(s.where_to_buy)}" style="color:${C.deeprose};font-weight:800;text-decoration:none">find it here →</a>` : ''}
          </td></tr></table></td></tr>`).join('');
        if (items) out.push(card(`${sticker(b.sticker || 'book besties', C.sageXL, '#4f5342')}${h(b.title || 'books my friends wrote')}
          ${b.text ? paras(b.text) : ''}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>`, C.sageXL));
        break;
      }
      case 'poll': {
        const opts = (b.options || []).map((o, i) => `<tr><td style="padding:0 0 8px"><a href="${esc(site)}/newsletter/?vote=${i}#poll"
          style="display:block;background:${C.paper};border-radius:999px;padding:12px 18px;font-family:${BODY};font-weight:800;font-size:14.5px;color:${C.ink};text-decoration:none">${esc(o)}</a></td></tr>`).join('');
        out.push(card(`${sticker('tap to vote', C.paper)}${h(b.question || 'Pick the next trope')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${opts}</table>`, C.blush));
        break;
      }
      case 'ama':
        out.push(card(`${sticker('ask me anything', C.pink)}${h(b.title || 'your turn', '#fff4f1')}
          <div style="color:#d8c4c7">${paras(b.text || 'Hit the button and ask me anything: about the books, Avery and Stephen, writing, tennis. I might answer it in the next letter.')}</div>
          ${pill(`${site}/newsletter/?from=${encodeURIComponent(ctx.issueRef || 'email')}#ama`, 'ask me', C.rose)}`, C.cocoa, '#fbeee9'));
        break;
      case 'answer':
        out.push(card(`${sticker('you asked', C.sageXL, '#4f5342')}
          <p style="margin:12px 0 10px;font-family:${SERIF};font-style:italic;font-size:21px;line-height:1.3;color:${C.deeprose}">“${esc(b.question)}”</p>${paras(b.text)}`));
        break;
      case 'bonus':
        out.push(card(`${sticker('secret shelf', C.pink)}${h(b.title || 'a little extra')}${paras(b.text)}${pill(b.link || site + '/#bonus', b.button || 'open it')}`, C.soft));
        break;
      case 'ps':
        out.push(`<tr><td style="padding:2px 12px 18px;font-family:${BODY};font-size:14.5px;color:${C.ink2}"><b style="font-family:${HEAD};color:${C.deeprose}">p.s.</b> ${esc(b.text)}</td></tr>`);
        break;
    }
  }
  return out.join('\n');
}

// ---- the frame: header, body, and the footer every email must have ---------
function frame({ inner, preheader = '', siteUrl = '', unsubUrl = '{{UNSUB_URL}}', address = '', reason = "you joined Mae's newsletter" }) {
  const site = (siteUrl || '').replace(/\/$/, '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700..800&family=Nunito:wght@400;700;800&family=Instrument+Serif:ital@1&family=Noto+Sans+Medefaidrin:wght@500;700&display=swap" rel="stylesheet">
<title>${esc(preheader || 'letters from Mae')}</title></head>
<body style="margin:0;padding:0;background:${C.cream}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}&nbsp;&#8199;&#65279;&nbsp;&#8199;&#65279;&nbsp;&#8199;&#65279;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream}"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td align="center" style="padding:0 0 20px">
  ${site ? `<img src="${esc(site)}/email/logo.png" width="150" alt="mae tao" style="display:block;width:150px;height:auto;margin:0 auto 2px">` : `<div style="font-family:${HEAD};font-weight:800;font-size:30px;color:#d9768b">mae tao</div>`}
  <div style="font-family:${SERIF};font-style:italic;font-size:17px;color:${C.ink2}">letters from the tennis court &amp; the writing desk</div>
</td></tr>
${inner}
<tr><td align="center" style="padding:18px 20px 6px;font-family:${BODY};font-size:12px;line-height:1.7;color:${C.muted}">
  <div style="font-family:${SERIF};font-style:italic;font-size:18px;color:${C.deeprose};margin-bottom:6px">with love, Mae</div>
  You're getting this because ${esc(reason)}. Just hit reply to write back, I read everything.<br>
  <a href="${esc(unsubUrl)}" style="color:${C.ink2};font-weight:700">unsubscribe in one click</a>${site ? ` · <a href="${esc(site)}" style="color:${C.ink2};font-weight:700">visit the website</a>` : ''}<br>
  ${esc(address)}
</td></tr></table></td></tr></table></body></html>`;
}

// ---- system emails ----------------------------------------------------------
function confirmEmail({ siteUrl, confirmUrl, firstName, address, magnetName }) {
  const inner = card(`${sticker('one tiny step')}${h(`hi${firstName ? ' ' + firstName : ''}! is this you?`)}
    <p style="margin:0 0 14px">Tap the button to confirm you'd like letters from me. Then ${esc(magnetName)} is all yours.</p>
    ${pill(confirmUrl, 'yes, sign me up')}
    <p style="margin:14px 0 0;color:${C.muted};font-size:13px">Didn't sign up? Ignore this email and you won't hear from me again.</p>`);
  return frame({ inner, preheader: `Confirm and get ${magnetName}`, siteUrl, unsubUrl: siteUrl, address, reason: 'someone entered this address on my website' });
}

function welcomeEmail({ siteUrl, magnetUrl, magnetName, firstName, unsubUrl, address }) {
  const inner = card(`${sticker("you're in")}${h(`welcome${firstName ? ', ' + firstName : ''}!`)}
      <p style="margin:0 0 14px">I'm so glad you're here. As promised, here's ${esc(magnetName)}, a little scene that only newsletter readers get.</p>
      ${pill(magnetUrl, 'read it now')}`) +
    card(`${sticker('one small favour', C.sageXL, '#4f5342')}
      <p style="margin:12px 0 10px"><b>Hit reply and tell me your favourite trope.</b> I read every answer, and replying tells your inbox my letters are welcome, so they don't end up in spam or Promotions.</p>
      <p style="margin:0">Two letters a month: book news, polls where you pick what I write next, answers to your questions, and books from my author friends. No spam, ever.</p>`, C.blush) +
    card(`${sticker('the secret shelf', C.pink)}${h('your key is waiting', '#fff4f1')}
      <div style="color:#d8c4c7"><p style="margin:0 0 14px">Deleted scenes, art and the playlist live on my website's secret shelf, and confirming just unlocked it.</p></div>
      ${pill(siteUrl + '/#bonus', 'open the shelf', C.rose)}`, C.cocoa, '#fbeee9');
  return frame({ inner, preheader: `Here's ${magnetName}`, siteUrl, unsubUrl, address });
}

// ===== issues.ts =====
// Shared by send-newsletter and mail-outbox: build a letter, refresh swaps, queue it for Gmail.

const build = (issue: any, unsubUrl: string) => frame({
  inner: renderBlocks(issue.blocks || [], { siteUrl: cfg.site, issueRef: `issue-${String(issue.id).slice(0, 8)}` }),
  preheader: issue.preheader, siteUrl: cfg.site, address: cfg.address, unsubUrl,
});
// Resend fills the reader's first name in for each person
const forBroadcast = (s: string) => s.replace(/\{\{\s*first_name\s*\}\}/gi, '{{{contact.first_name|friend}}}');
const plain = (s: string, name = 'friend') => s.replace(/\{\{\s*first_name\s*\}\}/gi, name);

// make the Resend list match the database before every send:
// confirmed readers in, everyone else (pending, unsubscribed, bounced) out
async function syncList() {
  const join = await db(`subscribers?status=eq.confirmed&resend_state=neq.subscribed&select=id,email,first_name&limit=1000`);
  for (const s of join) await addToResend(s);
  const leave = await db(`subscribers?status=neq.confirmed&resend_state=eq.subscribed&select=id,email&limit=1000`);
  for (const s of leave) await removeFromResend(s);
  return (await db(`subscribers?status=eq.confirmed&select=id&limit=100000`)).length;
}

// authors can edit their swap until the letter goes out: always send their latest details
async function freshSwaps(issue: any) {
  const blocks = issue.blocks || [];
  for (const blk of blocks) {
    if (blk.type !== 'swap' || !(blk.swapIds || []).length) continue;
    const rows = await db(`swaps?id=in.(${blk.swapIds.join(',')})&status=neq.declined&select=id,author_name,book_title,trope,release_date,blurb,cover_url,where_to_buy`);
    blk.items = blk.swapIds.map((id: string) => rows.find((r: any) => r.id === id)).filter(Boolean);
  }
  return { ...issue, blocks };
}

// Gmail: queue a personal copy for every confirmed reader (their name, their own unsubscribe link)
async function queueIssue(issue: any) {
  const subs = await db(`subscribers?status=eq.confirmed&select=id,email,first_name,unsubscribe_token&limit=100000`);
  const base = build(issue, '{{UNSUB_URL}}');
  for (const s of subs) {
    const name = (s.first_name || 'friend').replace(/[<>&"']/g, '');
    await sendMail({ kind: 'newsletter', to: s.email, subscriber_id: s.id, issue_id: issue.id,
      subject: plain(issue.subject, name), html: plain(base, name).replaceAll('{{UNSUB_URL}}', unsubLink(s.unsubscribe_token)),
      headers: unsubHeaders(s.unsubscribe_token) }, { ping: false });
  }
  await db(`issues?id=eq.${issue.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ queued_count: subs.length, body_html: base }) });
  await pingRelay();
  const days = Math.max(1, Math.ceil(subs.length / Math.max(1, cfg.dailyCap)));
  return { queued: subs.length, days };
}


// Gmail: once every queued copy of a letter is sent (or skipped/failed), mark it sent and log it
async function finishIssues() {
  const sending = await db(`issues?status=eq.sending&select=id,subject,body_html,queued_count`);
  for (const i of sending) {
    const left = await db(`mail_queue?issue_id=eq.${i.id}&status=in.(queued,sending)&select=id&limit=1`);
    if (left.length) continue;
    const sent = await db(`mail_queue?issue_id=eq.${i.id}&status=eq.sent&select=id&limit=100000`);
    const now = new Date().toISOString();
    const done = await db(`issues?id=eq.${i.id}&status=eq.sending`, { method: 'PATCH', body: JSON.stringify({ status: 'sent', sent_at: now, updated_at: now }) });
    if (!done.length) continue;
    await db('newsletter_sends', { method: 'POST', prefer: 'return=minimal',
      body: JSON.stringify({ issue_id: i.id, subject: i.subject, body_html: i.body_html || '', recipient_count: sent.length, sent_at: now }) });
    await db(`swaps?issue_id=eq.${i.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ status: 'sent' }) });
  }
}

// Gmail: start any scheduled letter whose time has come
async function startDueIssues() {
  const due = await db(`issues?status=eq.scheduled&scheduled_for=lte.${new Date().toISOString()}&select=*`);
  for (const issue of due) {
    const claimed = await db(`issues?id=eq.${issue.id}&status=eq.scheduled`, { method: 'PATCH', body: JSON.stringify({ status: 'sending', updated_at: new Date().toISOString() }) });
    if (claimed.length) await queueIssue(await freshSwaps(issue));
  }
}

// ===== mail-outbox =====
// The outbox for Mae's Gmail relay (a Google Apps Script running in her own Google account).
// The relay proves who it is with a Google sign-in token for mtao.author@gmail.com,
// so no password or key has to be copied between Google and Supabase.
//  POST { action: 'claim', n }              -> next emails to send (within the daily Gmail limit)
//  POST { action: 'report', results: [...] } -> which ones were sent / failed

const CERTS = Deno.env.get('GOOGLE_CERTS_URL') || 'https://www.googleapis.com/oauth2/v3/certs';
const AUD = Deno.env.get('RELAY_AUDIENCE') || '';            // optional: the relay's OAuth client id
const dec = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
let certCache: { at: number; keys: any[] } | null = null;

async function verifyGoogle(token: string) {
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return null;
  const header = JSON.parse(new TextDecoder().decode(dec(h)));
  const claims = JSON.parse(new TextDecoder().decode(dec(p)));
  if (header.alg !== 'RS256') return null;
  if (!certCache || Date.now() - certCache.at > 3600e3) certCache = { at: Date.now(), keys: (await (await fetch(CERTS)).json()).keys || [] };
  const jwk = certCache.keys.find((k: any) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, dec(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const now = Date.now() / 1000;
  if (!(claims.exp > now) || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) return null;
  if (AUD && claims.aud !== AUD) return null;
  if (String(claims.email || '').toLowerCase() !== cfg.gmailUser.toLowerCase() || claims.email_verified !== true) return null;
  return claims;
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const who = await verifyGoogle((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')).catch(() => null);
  if (!who) return json({ error: 'not the relay' }, 401);
  try {
    const b = await req.json().catch(() => ({}));
    if (b.action === 'claim') {
      await startDueIssues();
      const sent24 = Number(await db('rpc/mail_sent_24h', { method: 'POST', body: '{}' })) || 0;
      const room = Math.max(0, Math.min(Number(b.n) || 10, cfg.dailyCap - sent24));
      const mails = room ? await db('rpc/claim_mail', { method: 'POST', body: JSON.stringify({ n: room }) }) : [];
      await finishIssues();
      return json({ ok: true, room_today: Math.max(0, cfg.dailyCap - sent24),
        mails: mails.map((m: any) => ({ id: m.id, to: m.to_email, subject: m.subject, html: m.html, text: m.text_body, headers: m.headers || {} })) });
    }
    if (b.action === 'report') {
      const now = new Date().toISOString();
      for (const r of (b.results || []).slice(0, 100)) {
        if (!/^[0-9a-f-]{36}$/i.test(String(r.id))) continue;
        if (r.ok) await db(`mail_queue?id=eq.${r.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ status: 'sent', sent_at: now, error: null }) });
        else {
          const [m] = await db(`mail_queue?id=eq.${r.id}&select=attempts`);
          const final = !m || m.attempts >= 3 || /invalid|not found|does not exist/i.test(String(r.error || ''));
          await db(`mail_queue?id=eq.${r.id}`, { method: 'PATCH', prefer: 'return=minimal',
            body: JSON.stringify({ status: final ? 'failed' : 'queued', error: String(r.error || 'unknown').slice(0, 300) }) });
        }
      }
      await finishIssues();
      return json({ ok: true });
    }
    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e).slice(0, 200) }, 500);
  }
});
