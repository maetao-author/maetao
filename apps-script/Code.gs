/**
 * 𖹭 Mae's newsletter mail relay
 * Runs inside mtao.author@gmail.com and sends the newsletter's emails from that Gmail,
 * a few at a time, within Gmail's daily limit. It asks the website's database (the "outbox")
 * what to send, proving who it is with Google's own sign-in token, so there is no password to copy.
 *
 * One-time setup: Run ▸ setup  (then click Allow). After that it runs by itself every 5 minutes,
 * and the website can nudge it to send a confirmation email right away.
 */
const OUTBOX = 'https://sfpllnkugewuzmxqdwzr.supabase.co/functions/v1/mail-outbox';
const FROM_NAME = 'Mae Tao';
const PER_RUN = 20;        // emails per run (every 5 minutes)
const GAP_MS = 1500;       // a little pause between emails, so Gmail sees a calm, human pace

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('run').timeBased().everyMinutes(5).create();
  run();
  Logger.log('All set 𖹭 The relay now checks for emails every 5 minutes.');
}

// the website pings this link when someone signs up, so their confirmation email goes out right away
function doGet() {
  run();
  return ContentService.createTextOutput('ok');
}

function run() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return;           // another run is already sending
  try {
    const claim = call_({ action: 'claim', n: PER_RUN });
    const results = [];
    (claim.mails || []).forEach(function (m, i) {
      try {
        Gmail.Users.Messages.send({ raw: Utilities.base64EncodeWebSafe(buildMime_(m, Session.getEffectiveUser().getEmail()), Utilities.Charset.UTF_8) }, 'me');
        results.push({ id: m.id, ok: true });
      } catch (err) {
        results.push({ id: m.id, ok: false, error: String(err && err.message || err) });
      }
      if (i < claim.mails.length - 1) Utilities.sleep(GAP_MS);
    });
    if (results.length) call_({ action: 'report', results: results });
  } finally {
    lock.releaseLock();
  }
}

function call_(body) {
  const res = UrlFetchApp.fetch(OUTBOX, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getIdentityToken() },
    payload: JSON.stringify(body)
  });
  if (res.getResponseCode() >= 300) throw new Error('outbox ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

/* ---------- building a proper email (plain text + HTML, unsubscribe headers) ---------- */
function b64_(s) { return Utilities.base64Encode(s, Utilities.Charset.UTF_8).replace(/(.{76})/g, '$1\r\n'); }
function word_(s) { return '=?UTF-8?B?' + Utilities.base64Encode(s, Utilities.Charset.UTF_8) + '?='; }
function clean_(s) { return String(s || '').replace(/[\r\n]+/g, ' ').trim(); }

function buildMime_(m, fromEmail) {
  const boundary = 'mae_' + Utilities.getUuid().replace(/-/g, '');
  const lines = [
    'From: ' + word_(FROM_NAME) + ' <' + fromEmail + '>',
    'To: <' + clean_(m.to) + '>',
    'Reply-To: <' + fromEmail + '>',
    'Subject: ' + word_(clean_(m.subject)),
    'MIME-Version: 1.0'
  ];
  // only the unsubscribe headers are passed through (they help Gmail show its own "Unsubscribe" button)
  const h = m.headers || {};
  ['List-Unsubscribe', 'List-Unsubscribe-Post'].forEach(function (k) { if (h[k]) lines.push(k + ': ' + clean_(h[k])); });
  lines.push('Content-Type: multipart/alternative; boundary="' + boundary + '"', '');
  lines.push('--' + boundary, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64_(m.text || ''));
  lines.push('--' + boundary, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64_(m.html || ''));
  lines.push('--' + boundary + '--', '');
  return lines.join('\r\n');
}
