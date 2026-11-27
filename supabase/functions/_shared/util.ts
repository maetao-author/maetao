// Shared helpers for the edge functions. Secrets come ONLY from Supabase function secrets
// (supabase secrets set ...), never from the website or GitHub.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.

const env = (k: string, d = '') => (globalThis as any).Deno?.env.get(k) ?? d;

export const cfg = {
  url: env('SUPABASE_URL'),
  service: env('SUPABASE_SERVICE_ROLE_KEY'),
  resendKey: env('RESEND_API_KEY'),
  from: env('FROM_EMAIL', 'Mae Tao <hello@example.com>'),       // "Mae Tao <hello@YOURDOMAIN>"
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

export async function resend(path: '/emails' | '/emails/batch', payload: unknown) {
  if (!cfg.resendKey) throw new Error('RESEND_API_KEY is not set');
  const r = await fetch(`https://api.resend.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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
