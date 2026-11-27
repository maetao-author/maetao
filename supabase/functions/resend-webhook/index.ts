// Resend tells us when something happens to an address, and the database follows:
//  contact.updated (unsubscribed via the broadcast's unsubscribe link) -> unsubscribed
//  email.bounced (address doesn't exist)                               -> unsubscribed, reason bounced
//  email.complained (marked as spam)                                   -> unsubscribed, reason complained
// Resend → Webhooks → add https://YOUR-PROJECT.supabase.co/functions/v1/resend-webhook,
// tick those three events, and put its signing secret in RESEND_WEBHOOK_SECRET.
import { cfg, db, json, removeFromResend } from '../_shared/util.ts';

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// Svix-style signature: base64(HMAC-SHA256(secret, `${id}.${timestamp}.${body}`))
export async function verify(secret: string, id: string, ts: string, body: string, header: string) {
  if (!secret || !id || !ts || !header) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 5 * 60) return false;           // replay window: 5 minutes
  const key = await crypto.subtle.importKey('raw', unb64(secret.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const want = b64(await crypto.subtle.sign('HMAC', key, enc.encode(`${id}.${ts}.${body}`)));
  return header.split(' ').some((part) => part.split(',')[1] === want);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const body = await req.text();
  const ok = await verify(cfg.webhookSecret, req.headers.get('svix-id') || '', req.headers.get('svix-timestamp') || '', body, req.headers.get('svix-signature') || '');
  if (!ok) return json({ error: 'bad signature' }, 401);
  try {
    const evt = JSON.parse(body), d = evt.data || {};
    const email = String(d.email || (Array.isArray(d.to) ? d.to[0] : d.to) || '').toLowerCase().trim();
    if (!email) return json({ ok: true, ignored: 'no email' });
    const reason = evt.type === 'email.bounced' ? 'bounced' : evt.type === 'email.complained' ? 'complained'
      : evt.type === 'contact.updated' && d.unsubscribed === true ? 'resend' : null;
    if (!reason) return json({ ok: true, ignored: evt.type });
    const rows = await db(`subscribers?email=eq.${encodeURIComponent(email)}&status=neq.unsubscribed`, { method: 'PATCH',
      body: JSON.stringify({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString(), unsub_reason: reason,
        ...(reason === 'resend' ? { resend_state: 'unsubscribed' } : {}) }) });
    // bounces and complaints: also switch the contact off in Resend so no broadcast tries again
    if (rows.length && reason !== 'resend') await removeFromResend(rows[0]);
    return json({ ok: true, updated: rows.length, reason });
  } catch (e) {
    console.error(e);
    return json({ error: 'could not process' }, 500);
  }
});
