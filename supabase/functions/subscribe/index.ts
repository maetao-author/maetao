// POST { email, first_name?, source?, website? (honeypot) }
// Saves the reader as "pending" and sends the double opt-in email.
import { cfg, db, json, preflight, resend, EMAIL_RE } from '../_shared/util.ts';
import { confirmEmail } from '../_shared/email.js';

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

    await resend('/emails', {
      from: cfg.from, to: [email], reply_to: cfg.replyTo || undefined,
      subject: 'one tap to confirm ♡',
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
