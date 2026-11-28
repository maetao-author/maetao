// Shared by send-newsletter and mail-outbox: build a letter, refresh swaps, queue it for Gmail.
import { cfg, db, sendMail, pingRelay, unsubLink, unsubHeaders, addToResend, removeFromResend } from './util.ts';
import { renderBlocks, frame } from './email.js';

export const build = (issue: any, unsubUrl: string) => frame({
  inner: renderBlocks(issue.blocks || [], { siteUrl: cfg.site, issueRef: `issue-${String(issue.id).slice(0, 8)}` }),
  preheader: issue.preheader, siteUrl: cfg.site, address: cfg.address, unsubUrl,
});
// Resend fills the reader's first name in for each person
export const forBroadcast = (s: string) => s.replace(/\{\{\s*first_name\s*\}\}/gi, '{{{contact.first_name|friend}}}');
export const plain = (s: string, name = 'friend') => s.replace(/\{\{\s*first_name\s*\}\}/gi, name);

// make the Resend list match the database before every send:
// confirmed readers in, everyone else (pending, unsubscribed, bounced) out
export async function syncList() {
  const join = await db(`subscribers?status=eq.confirmed&resend_state=neq.subscribed&select=id,email,first_name&limit=1000`);
  for (const s of join) await addToResend(s);
  const leave = await db(`subscribers?status=neq.confirmed&resend_state=eq.subscribed&select=id,email&limit=1000`);
  for (const s of leave) await removeFromResend(s);
  return (await db(`subscribers?status=eq.confirmed&select=id&limit=100000`)).length;
}

// authors can edit their swap until the letter goes out: always send their latest details
export async function freshSwaps(issue: any) {
  const blocks = issue.blocks || [];
  for (const blk of blocks) {
    if (blk.type !== 'swap' || !(blk.swapIds || []).length) continue;
    const rows = await db(`swaps?id=in.(${blk.swapIds.join(',')})&status=neq.declined&select=id,author_name,book_title,trope,release_date,blurb,cover_url,where_to_buy`);
    blk.items = blk.swapIds.map((id: string) => rows.find((r: any) => r.id === id)).filter(Boolean);
  }
  return { ...issue, blocks };
}

// Gmail: queue a personal copy for every confirmed reader (their name, their own unsubscribe link)
export async function queueIssue(issue: any) {
  const subs = await db(`subscribers?status=eq.confirmed&select=id,email,first_name,unsubscribe_token&limit=100000`);
  const base = build(issue, '{{UNSUB_URL}}');
  for (const s of subs) {
    const name = (s.first_name || 'friend').replace(/[<>&"']/g, '');
    await sendMail({ kind: 'newsletter', to: s.email, subscriber_id: s.id, issue_id: issue.id,
      subject: plain(issue.subject, name), html: plain(base, name).replaceAll('{{UNSUB_URL}}', unsubLink(s.unsubscribe_token)),
      headers: unsubHeaders(s.unsubscribe_token) }, { ping: false });
  }
  await db(`issues?id=eq.${issue.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ queued_count: subs.length, body_html: base }) });
  await pingRelay();
  const days = Math.max(1, Math.ceil(subs.length / Math.max(1, cfg.dailyCap)));
  return { queued: subs.length, days };
}


// Gmail: once every queued copy of a letter is sent (or skipped/failed), mark it sent and log it
export async function finishIssues() {
  const sending = await db(`issues?status=eq.sending&select=id,subject,body_html,queued_count`);
  for (const i of sending) {
    const left = await db(`mail_queue?issue_id=eq.${i.id}&status=in.(queued,sending)&select=id&limit=1`);
    if (left.length) continue;
    const sent = await db(`mail_queue?issue_id=eq.${i.id}&status=eq.sent&select=id&limit=100000`);
    const now = new Date().toISOString();
    const done = await db(`issues?id=eq.${i.id}&status=eq.sending`, { method: 'PATCH', body: JSON.stringify({ status: 'sent', sent_at: now, updated_at: now }) });
    if (!done.length) continue;
    await db('newsletter_sends', { method: 'POST', prefer: 'return=minimal',
      body: JSON.stringify({ issue_id: i.id, subject: i.subject, body_html: i.body_html || '', recipient_count: sent.length, sent_at: now }) });
    await db(`swaps?issue_id=eq.${i.id}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ status: 'sent' }) });
  }
}

// Gmail: start any scheduled letter whose time has come
export async function startDueIssues() {
  const due = await db(`issues?status=eq.scheduled&scheduled_for=lte.${new Date().toISOString()}&select=*`);
  for (const issue of due) {
    const claimed = await db(`issues?id=eq.${issue.id}&status=eq.scheduled`, { method: 'PATCH', body: JSON.stringify({ status: 'sending', updated_at: new Date().toISOString() }) });
    if (claimed.length) await queueIssue(await freshSwaps(issue));
  }
}
