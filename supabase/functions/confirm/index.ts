// POST { token } from the /confirmed page.
// Marks the reader confirmed, sends the welcome email with the reader magnet (once), returns the magnet link.
import { cfg, db, json, preflight, resend, UUID_RE, unsubLink, oneClickLink, addToResend } from '../_shared/util.ts';
import { welcomeEmail } from '../_shared/email.js';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const { token } = await req.json().catch(() => ({}));
    if (!UUID_RE.test(String(token || ''))) return json({ error: 'This link looks broken.' }, 400);
    const [sub] = await db(`subscribers?confirm_token=eq.${token}&select=*`);
    if (!sub) return json({ error: 'This link has expired. Sign up again and I’ll send a fresh one.' }, 404);
    if (sub.status === 'unsubscribed') return json({ error: 'This address unsubscribed. Sign up again to come back' }, 410);

    if (sub.status === 'pending') {
      await db(`subscribers?id=eq.${sub.id}&status=eq.pending`, { method: 'PATCH', prefer: 'return=minimal',
        body: JSON.stringify({ status: 'confirmed', confirmed_at: new Date().toISOString(), unsub_reason: null }) });
    }
    if (sub.resend_state !== 'subscribed') await addToResend(sub).catch((e) => console.error('resend contact', e));
    if (!sub.magnet_delivered) {
      // claim the delivery first so a double click can't send two welcome emails
      const claimed = await db(`subscribers?id=eq.${sub.id}&magnet_delivered=is.false`, { method: 'PATCH',
        body: JSON.stringify({ magnet_delivered: true }) });
      if (claimed.length) {
        try {
          await resend('/emails', {
            from: cfg.from, to: [sub.email], reply_to: cfg.replyTo || undefined,
            subject: `you're in! here's ${cfg.magnetName}`,
            html: welcomeEmail({ siteUrl: cfg.site, magnetUrl: cfg.magnetUrl, magnetName: cfg.magnetName,
              firstName: sub.first_name, unsubUrl: unsubLink(sub.unsubscribe_token), address: cfg.address }),
            headers: { 'List-Unsubscribe': `<${oneClickLink(sub.unsubscribe_token)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
          });
        } catch (e) {
          await db(`subscribers?id=eq.${sub.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ magnet_delivered: false }) });
          throw e;
        }
      }
    }
    return json({ ok: true, first_name: sub.first_name, magnet_url: cfg.magnetUrl, magnet_name: cfg.magnetName });
  } catch (e) {
    console.error(e);
    return json({ error: 'Something went wrong. Please refresh in a minute.' }, 500);
  }
});
