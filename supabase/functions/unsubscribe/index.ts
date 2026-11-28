// One-click unsubscribe.
//  - POST { token } from the /unsubscribe page
//  - POST ?t=TOKEN from Gmail/Apple's built-in "Unsubscribe" button (RFC 8058 List-Unsubscribe-Post)
//  - GET  ?t=TOKEN redirects to the friendly /unsubscribe page, which then POSTs
import { cfg, db, json, preflight, UUID_RE, removeFromResend } from '../_shared/util.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  const url = new URL(req.url);
  if (req.method === 'GET') {
    return Response.redirect(`${cfg.site}/unsubscribe/?t=${encodeURIComponent(url.searchParams.get('t') || '')}`, 302);
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    let token = url.searchParams.get('t') || '';
    if (!token && (req.headers.get('content-type') || '').includes('json')) token = (await req.json().catch(() => ({}))).token || '';
    if (!UUID_RE.test(token)) return json({ error: 'This link looks broken.' }, 400);
    const rows = await db(`subscribers?unsubscribe_token=eq.${token}`, { method: 'PATCH',
      body: JSON.stringify({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString(), unsub_reason: 'link' }) });
    if (!rows.length) return json({ error: 'I couldn’t find that subscription.' }, 404);
    if (cfg.mailProvider === 'resend') await removeFromResend(rows[0]);
    // anything still waiting in the Gmail queue for them is cancelled
    await db(`mail_queue?subscriber_id=eq.${rows[0].id}&status=eq.queued&kind=eq.newsletter`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ status: 'skipped', error: 'unsubscribed' }) }).catch(() => {});
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
