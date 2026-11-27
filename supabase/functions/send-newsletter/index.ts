// Sends an issue. Only Mae (logged in on /admin) or the scheduler can call this.
//  POST { issue_id, mode: 'test' }  -> sends one copy to Mae only
//  POST { issue_id, mode: 'now' }   -> sends to CONFIRMED subscribers only, then logs it
//  POST { mode: 'scheduled' } with header x-cron-secret -> sends every issue whose scheduled time has passed
import { cfg, db, json, preflight, resend, adminEmail, unsubLink, oneClickLink, UUID_RE } from '../_shared/util.ts';
import { renderBlocks, frame } from '../_shared/email.js';

const BATCH = 100;   // Resend batch limit

function build(issue: any) {
  const inner = renderBlocks(issue.blocks || [], { siteUrl: cfg.site, issueRef: `issue-${String(issue.id).slice(0, 8)}` });
  return frame({ inner, preheader: issue.preheader, siteUrl: cfg.site, address: cfg.address });
}
const personalise = (html: string, s: any) => html
  .replaceAll('{{UNSUB_URL}}', unsubLink(s.unsubscribe_token))
  .replaceAll('{{FIRST_NAME}}', (s.first_name || 'friend').replace(/[<>&"']/g, ''))
  .replaceAll('{{first_name}}', (s.first_name || 'friend').replace(/[<>&"']/g, ''));

async function confirmedSubscribers() {
  const all: any[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await db(`subscribers?status=eq.confirmed&select=email,first_name,unsubscribe_token&order=created_at`, {
      headers: { Range: `${from}-${from + 999}` } });
    all.push(...page);
    if (page.length < 1000) return all;
  }
}

async function sendIssue(issue: any) {
  // claim it: only one sender may move an issue to "sending"
  const claimed = await db(`issues?id=eq.${issue.id}&status=in.(draft,scheduled)`, { method: 'PATCH',
    body: JSON.stringify({ status: 'sending', updated_at: new Date().toISOString() }) });
  if (!claimed.length) return { skipped: true };
  const html = build(issue);
  try {
    const subs = await confirmedSubscribers();
    let sent = 0;
    for (let i = 0; i < subs.length; i += BATCH) {
      const chunk = subs.slice(i, i + BATCH).map((s) => ({
        from: cfg.from, to: [s.email], reply_to: cfg.replyTo || undefined,
        subject: personalise(issue.subject, s), html: personalise(html, s),
        headers: { 'List-Unsubscribe': `<${oneClickLink(s.unsubscribe_token)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      }));
      await resend('/emails/batch', chunk);
      sent += chunk.length;
    }
    const now = new Date().toISOString();
    await db('newsletter_sends', { method: 'POST', prefer: 'return=minimal',
      body: JSON.stringify({ issue_id: issue.id, subject: issue.subject, body_html: html, recipient_count: sent, sent_at: now }) });
    await db(`issues?id=eq.${issue.id}`, { method: 'PATCH', prefer: 'return=minimal',
      body: JSON.stringify({ status: 'sent', sent_at: now, body_html: html, updated_at: now }) });
    await db(`swaps?issue_id=eq.${issue.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ status: 'sent' }) });
    return { sent };
  } catch (e) {
    // put it back so Mae can retry (some readers may already have it; Resend logs show who)
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
      const html = build(issue);
      const fake = { first_name: 'Mae', unsubscribe_token: '00000000-0000-0000-0000-000000000000' };
      await resend('/emails', { from: cfg.from, to: [me], subject: '[test] ' + personalise(issue.subject, fake), html: personalise(html, fake) });
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
