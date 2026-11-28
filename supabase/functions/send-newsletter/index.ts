// Sends an issue.
//  MAIL_PROVIDER=gmail (default): one personal email per confirmed reader goes into the mail queue,
//    and Mae's Apps Script relay sends them from her Gmail within the daily limit.
//  MAIL_PROVIDER=resend: one Resend Broadcast to the newsletter segment (needs her own domain).
// Only Mae (logged in on /admin) or the scheduler can call this.
//  POST { issue_id, mode: 'test' }  -> one transactional copy to Mae only
//  POST { issue_id, mode: 'now' }   -> sync the list, then one broadcast to the newsletter segment
//  POST { mode: 'scheduled' } + header x-cron-secret -> sends every issue whose time has come
import { cfg, db, json, preflight, resend, adminEmail, sendMail, unsubHeaders, UUID_RE } from '../_shared/util.ts';
import { build, forBroadcast, plain, syncList, freshSwaps, queueIssue } from '../_shared/issues.ts';

async function sendIssue(issue: any) {
  const claimed = await db(`issues?id=eq.${issue.id}&status=in.(draft,scheduled)`, { method: 'PATCH',
    body: JSON.stringify({ status: 'sending', updated_at: new Date().toISOString() }) });
  if (!claimed.length) return { skipped: true };
  if (cfg.mailProvider !== 'resend') {
    try { issue = await freshSwaps(issue); return await queueIssue(issue); }   // stays 'sending' until the queue is empty
    catch (e) { await db(`issues?id=eq.${issue.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ status: issue.status }) }); throw e; }
  }
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
      await sendMail({ kind: 'test', to: me, subject: '[test] ' + plain(issue.subject, 'Mae'), html, headers: unsubHeaders() });
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
