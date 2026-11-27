// Self-serve newsletter swaps for author friends and co-authors.
//  POST { action: 'create', row, code? } -> saves the swap, emails the author a private edit link.
//        With a valid friend pass (code) it is approved straight away and lands in Mae's next letter.
//  POST { action: 'get', token }         -> the author's own entry (for the edit page)
//  POST { action: 'update', token, row } -> author edits their entry (until the letter goes out)
//  POST { action: 'delete', token }      -> author removes their entry (until the letter goes out)
import { cfg, db, json, preflight, resend, EMAIL_RE, UUID_RE } from '../_shared/util.ts';
import { esc } from '../_shared/email.js';

const FIELDS: Record<string, number> = { author_name: 80, email: 254, book_title: 120, where_to_buy: 400, trope: 120, genre: 60, heat: 30,
  newsletter_link: 400, news_link: 400, cover_url: 400, blurb: 300, notes: 600 };
const PUBLIC = 'id,month,author_name,email,book_title,where_to_buy,trope,genre,heat,release_date,newsletter_link,news_link,cover_url,list_size,blurb,notes,status,invited,updated_at';

function clean(row: any) {
  const out: any = {};
  for (const [k, max] of Object.entries(FIELDS)) {
    const v = String(row?.[k] ?? '').trim();
    out[k] = v ? v.slice(0, max) : null;
  }
  for (const k of ['where_to_buy', 'newsletter_link', 'news_link', 'cover_url'])
    if (out[k] && !/^https?:\/\//i.test(out[k])) throw new Error('Links need to start with https://');
  if (!out.author_name || !out.book_title) throw new Error('Your name and book title are needed.');
  out.email = String(out.email || '').toLowerCase();
  if (!EMAIL_RE.test(out.email)) throw new Error('That email looks a little off.');
  out.month = String(row?.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(out.month)) throw new Error('Pick the month you’d like to swap.');
  out.release_date = /^\d{4}-\d{2}-\d{2}$/.test(String(row?.release_date || '')) ? row.release_date : null;
  const n = parseInt(row?.list_size, 10); out.list_size = Number.isFinite(n) && n >= 0 ? Math.min(n, 10000000) : null;
  return out;
}

async function mailEditLink(s: any, approved: boolean) {
  const link = `${cfg.site}/swap/?edit=${s.edit_token}`;
  const html = `<div style="font-family:Nunito,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#fbf5f0;color:#3a2b2f">
    <div style="background:#fffaf7;border-radius:24px;padding:24px">
    <h2 style="font-family:'Bricolage Grotesque',Arial,sans-serif;margin:0 0 10px">thank you, ${esc(s.author_name)}!</h2>
    <p>${approved ? `Your swap for <b>${esc(s.book_title)}</b> is in: it goes into my ${esc(s.month)} letter automatically.`
      : `I got your swap request for <b>${esc(s.book_title)}</b> (${esc(s.month)}). I'll look at it this week.`}</p>
    <p>Need to change a link, the cover or your hook? Use your private edit link (keep it to yourself):</p>
    <p><a href="${link}" style="display:inline-block;background:#d98f97;color:#fff;border-radius:999px;padding:12px 20px;font-weight:800;text-decoration:none">edit my swap</a></p>
    <p style="color:#9a8a8d;font-size:13px">Please feature <b>Call It a Let</b> in your letter the same month: ${esc(cfg.site)}</p>
    </div><p style="color:#9a8a8d;font-size:12px;text-align:center">${esc(cfg.address)}</p></div>`;
  await resend('/emails', { from: cfg.from, to: [s.email], reply_to: cfg.replyTo || undefined,
    subject: approved ? `your swap is in: ${s.book_title}` : `got your swap request: ${s.book_title}`, html });
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    if (b.website) return json({ ok: true });                                     // honeypot

    if (b.action === 'create') {
      const row = clean(b.row);
      let invite: any = null;
      if (b.code) {
        [invite] = await db(`swap_invites?code=eq.${encodeURIComponent(String(b.code).slice(0, 40))}&active=is.true&select=*`);
        if (!invite || (invite.max_uses && invite.uses >= invite.max_uses)) return json({ error: 'That friend pass isn’t active. Ask Mae for a new one, or send it without the pass.' }, 400);
      }
      const [s] = await db('swaps', { method: 'POST', body: JSON.stringify({ ...row, status: invite ? 'approved' : 'new', invited: !!invite, invite_code: invite?.code || null }) });
      if (invite) await db(`swap_invites?code=eq.${encodeURIComponent(invite.code)}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ uses: invite.uses + 1 }) });
      await mailEditLink(s, !!invite).catch((e) => console.error('edit link email', e));
      return json({ ok: true, approved: !!invite });
    }

    if (!UUID_RE.test(String(b.token || ''))) return json({ error: 'That edit link looks broken.' }, 400);
    const [s] = await db(`swaps?edit_token=eq.${b.token}&select=${PUBLIC}`);
    if (!s) return json({ error: 'I couldn’t find that swap. It may have been removed.' }, 404);
    const locked = s.status === 'sent' || s.status === 'declined';

    if (b.action === 'get') return json({ ok: true, swap: s, locked });
    if (locked) return json({ error: s.status === 'sent' ? 'This swap already went out in a letter, so it can’t be changed.' : 'This swap was declined.' }, 409);

    if (b.action === 'update') {
      const row = clean({ ...b.row, email: s.email });                             // the email stays the one that got the link
      const [u] = await db(`swaps?edit_token=eq.${b.token}`, { method: 'PATCH', body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }) });
      return json({ ok: true, status: u.status });
    }
    if (b.action === 'delete') {
      await db(`swaps?edit_token=eq.${b.token}`, { method: 'DELETE', prefer: 'return=minimal' });
      return json({ ok: true });
    }
    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (/^(Links need|Your name|That email|Pick the month)/.test(msg)) return json({ error: msg }, 400);
    console.error(e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
