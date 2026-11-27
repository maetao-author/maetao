// Sends an issue as a Resend BROADCAST (marketing email: free for up to 1,000 contacts,
// and it doesn't use up the 100/day transactional quota that confirm/welcome emails need).
// Only Mae (logged in on /admin) or the scheduler can call this.
//  POST { issue_id, mode: 'test' }  -> one transactional copy to Mae only
//  POST { issue_id, mode: 'now' }   -> sync the list, then one broadcast to the newsletter segment
//  POST { mode: 'scheduled' } + header x-cron-secret -> sends every issue whose time has come
import { cfg, db, json, preflight, resend, adminEmail, addToResend, removeFromResend, UUID_RE } from '../_shared/util.ts';
import { renderBlocks, frame } from '../_shared/email.js';

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

async function sendIssue(issue: any) {
  const claimed = await db(`issues?id=eq.${issue.id}&status=in.(draft,scheduled)`, { method: 'PATCH',
    body: JSON.stringify({ status: 'sending', updated_at: new Date().toISOString() }) });
  if (!claimed.length) return { skipped: true };
  try {
    if (!cfg.segmentId) throw new Error('RESEND_SEGMENT_ID is not set');
    issue = await freshSwaps(issue);
    const recipients = await syncList();
    const html = forBroadcast(build(issue, '{{{RESEND_UNSUBSCRIBE_URL}}}'));
    const b = await resend('/broadcasts', {
      segment_id: cfg.segmentId, from: cfg.from, reply_to: cfg.replyTo || undefined,
      subject: plain(issue.subject), html, name: `letter: ${issue.subject}`.slice(0, 100), send: true,
    });
    const now = new Date().toISOString();
    await db('newsletter_sends', { method: 'POST', prefer: 'return=minimal',
      body: JSON.stringify({ issue_id: issue.id, subject: issue.subject, body_html: html, recipient_count: recipients, sent_at: now }) });
    await db(`issues?id=eq.${issue.id}`, { method: 'PATCH', prefer: 'return=minimal',
      body: JSON.stringify({ status: 'sent', sent_at: now, body_html: html, broadcast_id: b.id || null, updated_at: now }) });
    await db(`swaps?issue_id=eq.${issue.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ status: 'sent' }) });
    return { sent: recipients, broadcast_id: b.id };
  } catch (e) {
    await db(`issues?id=eq.${issue.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ status: issue.status }) });
    throw e;
  }
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const b = await req.json().catch(() => ({}));

    if (b.mode === 'scheduled') {
      if (!cfg.cronSecret || req.headers.get('x-cron-secret') !== cfg.cronSecret) return json({ error: 'nope' }, 401);
      const due = await db(`issues?status=eq.scheduled&scheduled_for=lte.${new Date().toISOString()}&select=*`);
      const results = [];
      for (const issue of due) results.push({ id: issue.id, ...(await sendIssue(issue)) });
      return json({ ok: true, results });
    }

    const me = await adminEmail(req);
    if (!me) return json({ error: 'Only Mae can send newsletters.' }, 401);
    if (!UUID_RE.test(String(b.issue_id || ''))) return json({ error: 'Missing issue.' }, 400);
    const [issue] = await db(`issues?id=eq.${b.issue_id}&select=*`);
    if (!issue) return json({ error: 'Issue not found.' }, 404);
    if (!issue.subject?.trim()) return json({ error: 'Give it a subject line first' }, 400);

    if (b.mode === 'test') {
      const html = plain(build(await freshSwaps(issue), `${cfg.site}/unsubscribe/`), 'Mae');
      await resend('/emails', { from: cfg.from, to: [me], subject: '[test] ' + plain(issue.subject, 'Mae'), html });
      await db('newsletter_sends', { method: 'POST', prefer: 'return=minimal',
        body: JSON.stringify({ issue_id: issue.id, subject: issue.subject, body_html: html, recipient_count: 1, is_test: true }) });
      return json({ ok: true, test_to: me });
    }
    if (b.mode === 'now') {
      if (issue.status === 'sent') return json({ error: 'This one already went out.' }, 409);
      return json({ ok: true, ...(await sendIssue(issue)) });
    }
    return json({ error: 'Unknown mode.' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message || e).slice(0, 300) }, 500);
  }
});
