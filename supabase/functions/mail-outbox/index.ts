// The outbox for Mae's Gmail relay (a Google Apps Script running in her own Google account).
// The relay proves who it is with a Google sign-in token for mtao.author@gmail.com,
// so no password or key has to be copied between Google and Supabase.
//  POST { action: 'claim', n }              -> next emails to send (within the daily Gmail limit)
//  POST { action: 'report', results: [...] } -> which ones were sent / failed
import { cfg, db, json, preflight } from '../_shared/util.ts';
import { startDueIssues, finishIssues } from '../_shared/issues.ts';

const CERTS = Deno.env.get('GOOGLE_CERTS_URL') || 'https://www.googleapis.com/oauth2/v3/certs';
const AUD = Deno.env.get('RELAY_AUDIENCE') || '';            // optional: the relay's OAuth client id
const dec = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
let certCache: { at: number; keys: any[] } | null = null;

export async function verifyGoogle(token: string) {
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
