// subscribe: single-file build of supabase/functions/subscribe (generated; edit the source files instead)
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

// ===== subscribe =====
// POST { email, first_name?, source?, website? (honeypot) }
// Saves the reader as "pending" and sends the double opt-in email.

const RESEND_COOLDOWN_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    if (b.website) return json({ ok: true });                       // bots fill the hidden field
    const email = String(b.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: 'That email doesn’t look quite right.' }, 400);
    const first_name = String(b.first_name || '').trim().slice(0, 60) || null;
    const source = String(b.source || 'website').replace(/[^\w .:/-]/g, '').slice(0, 60);

    const [existing] = await db(`subscribers?email=eq.${encodeURIComponent(email)}&select=*`);
    let sub = existing;
    if (!sub) {
      [sub] = await db('subscribers', { method: 'POST', body: JSON.stringify({ email, first_name, source, status: 'pending' }) });
    } else if (sub.status === 'confirmed') {
      return json({ ok: true });                                     // never reveal who is on the list
    } else if (sub.status === 'unsubscribed') {
      [sub] = await db(`subscribers?id=eq.${sub.id}`, { method: 'PATCH', body: JSON.stringify({
        status: 'pending', consent_at: new Date().toISOString(), confirm_token: crypto.randomUUID(),
        unsubscribe_token: crypto.randomUUID(), unsubscribed_at: null, source, first_name: first_name || sub.first_name }) });
    } else if (sub.confirm_sent_at && Date.now() - Date.parse(sub.confirm_sent_at) < RESEND_COOLDOWN_MS) {
      return json({ ok: true });                                     // already sent one a moment ago
    }

    await sendMail({
      kind: 'confirm', to: email, subscriber_id: sub.id,
      subject: 'one tap to confirm',
      html: confirmEmail({ siteUrl: cfg.site, confirmUrl: `${cfg.site}/confirmed/?t=${sub.confirm_token}`,
        firstName: sub.first_name, address: cfg.address, magnetName: cfg.magnetName }),
    });
    await db(`subscribers?id=eq.${sub.id}`, { method: 'PATCH', prefer: 'return=minimal',
      body: JSON.stringify({ confirm_sent_at: new Date().toISOString() }) });
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: 'Something went wrong. Please try again in a minute.' }, 500);
  }
});
