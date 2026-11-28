// Shared helpers for the edge functions. Secrets come ONLY from Supabase function secrets
// (supabase secrets set ...), never from the website or GitHub.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.

const env = (k: string, d = '') => (globalThis as any).Deno?.env.get(k) ?? d;

export const cfg = {
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

export const fnUrl = (name: string) => `${cfg.url}/functions/v1/${name}`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
export const preflight = (req: Request) => req.method === 'OPTIONS' ? new Response('ok', { headers: CORS }) : null;

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// tiny PostgREST client using the service role (bypasses RLS: server-side only)
export async function db(path: string, init: RequestInit & { prefer?: string } = {}) {
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

export async function resend(path: string, payload?: unknown, method = 'POST') {
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
export async function adminEmail(req: Request): Promise<string | null> {
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

export const unsubLink = (token: string) => `${cfg.site}/unsubscribe/?t=${token}`;
export const oneClickLink = (token: string) => `${fnUrl('unsubscribe')}?t=${token}`;

// ---- Resend contacts (the newsletter list lives in a Resend segment) ----------
// Only CONFIRMED readers are ever added, so pending readers can never get a broadcast.
export async function addToResend(sub: { id: string; email: string; first_name?: string | null }) {
  if (!cfg.segmentId) throw new Error('RESEND_SEGMENT_ID is not set');
  try {
    await resend('/contacts', { email: sub.email, first_name: sub.first_name || undefined, unsubscribed: false, segments: [{ id: cfg.segmentId }] });
  } catch (_e) {
    // already a contact (e.g. they came back): switch them back on
    await resend(`/contacts/${encodeURIComponent(sub.email)}`, { unsubscribed: false, first_name: sub.first_name || undefined }, 'PATCH');
  }
  await db(`subscribers?id=eq.${sub.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ resend_state: 'subscribed' }) });
}
export async function removeFromResend(sub: { id: string; email: string }) {
  try { await resend(`/contacts/${encodeURIComponent(sub.email)}`, { unsubscribed: true }, 'PATCH'); } catch (e) { console.error('resend unsub', e); return; }
  await db(`subscribers?id=eq.${sub.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ resend_state: 'unsubscribed' }) });
}

// ---- one way to send any email ------------------------------------------------
// gmail: the email waits in mail_queue and Mae's Apps Script relay sends it from her Gmail.
// resend: sent straight away through Resend (only once she has her own domain).
export const htmlToText = (html: string) => html
  .replace(/<style[\s\S]*?<\/style>|<head[\s\S]*?<\/head>/gi, '')
  .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, t) => `${t.replace(/<[^>]+>/g, '').trim()} (${href})`)
  .replace(/<(br|\/p|\/h[1-6]|\/tr|\/div)[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;|&#8199;|&#65279;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();

export function unsubHeaders(token?: string) {
  const parts = [`<mailto:${cfg.gmailUser}?subject=unsubscribe>`];
  if (token) parts.unshift(`<${oneClickLink(token)}>`);
  return token ? { 'List-Unsubscribe': parts.join(', '), 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : { 'List-Unsubscribe': parts.join(', ') };
}

export async function pingRelay() {
  if (!cfg.relayUrl) return;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
  try { await fetch(cfg.relayUrl + (cfg.relayUrl.includes('?') ? '&' : '?') + 'ping=1', { signal: ctl.signal }); } catch (_e) { /* the 5-minute timer picks it up anyway */ }
  finally { clearTimeout(t); }
}

type Mail = { to: string; subject: string; html: string; kind: 'confirm' | 'welcome' | 'swap' | 'test' | 'newsletter';
  headers?: Record<string, string>; issue_id?: string; subscriber_id?: string; priority?: number };

export async function sendMail(m: Mail, opts: { ping?: boolean } = {}) {
  if (cfg.mailProvider === 'resend') {
    return resend('/emails', { from: cfg.from, to: [m.to], reply_to: cfg.replyTo || undefined, subject: m.subject, html: m.html, headers: m.headers });
  }
  await db('mail_queue', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({
    kind: m.kind, priority: m.priority ?? (m.kind === 'newsletter' ? 1 : 0), to_email: m.to, subject: m.subject, html: m.html,
    text_body: htmlToText(m.html), headers: m.headers || {}, issue_id: m.issue_id || null, subscriber_id: m.subscriber_id || null }) });
  if (opts.ping !== false) await pingRelay();
}
