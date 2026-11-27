// ♡ Mae's desk. Logged-in dashboard for the newsletter.
// Talks to Supabase with YOUR login (row level security only lets admins read).
// The Resend key never comes near this page: sending goes through the send-newsletter function.
import { renderBlocks, frame } from '../supabase/functions/_shared/email.js';

const N = window.MAE_NL, $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = NL.esc, DEMO = !NL.live();
const SITE = (N.siteUrl || location.origin + location.pathname.replace(/admin\/.*$/, '')).replace(/\/$/, '');
const day = 864e5, iso = d => new Date(d).toISOString().slice(0, 10);
const local = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
const fmt = (d, o = { month: 'short', day: 'numeric' }) => new Date(d).toLocaleDateString(undefined, o);
const ls = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => localStorage.setItem(k, JSON.stringify(v)) };

/* ================= data ================= */
let sb = null, session = null;
const D = { subscribers: [], issues: [], swaps: [], polls: [], ama_questions: [], reminders: [], newsletter_sends: [] };

function demoData() {
  const now = Date.now(), src = ['tiktok', 'instagram', 'popup', 'newsletter-page', 'threads', 'home'], names = ['Bea', 'Lia', 'Cass', 'Joy', 'Nina', 'Pia', 'Ria', 'Tess', '', ''];
  const subs = Array.from({ length: 64 }, (_, i) => ({ id: 's' + i, email: `reader${i}@example.com`, first_name: names[i % 10], source: src[i % 6],
    status: i % 9 === 0 ? 'pending' : i % 17 === 0 ? 'unsubscribed' : 'confirmed', created_at: new Date(now - (i * 0.9) * day).toISOString() }));
  return {
    subscribers: subs,
    issues: [{ id: 'i1', subject: 'release week is here ♡', preheader: '', status: 'sent', blocks: [], sent_at: new Date(now - 9 * day).toISOString(), created_at: new Date(now - 12 * day).toISOString() }],
    swaps: [
      { id: 'w1', month: iso(now).slice(0, 7), author_name: 'Jo Rivera', email: 'jo@example.com', book_title: 'Love, Set, Match', trope: 'fake dating', heat: 'steamy', release_date: iso(now + 6 * day), where_to_buy: 'https://example.com', blurb: 'A fake engagement at Wimbledon. What could go wrong?', status: 'approved', list_size: 1200, created_at: new Date(now - 3 * day).toISOString() },
      { id: 'w2', month: iso(now + 31 * day).slice(0, 7), author_name: 'Sam Lee', email: 'sam@example.com', book_title: 'Off Side', trope: 'forbidden coach-player', heat: 'spicy', where_to_buy: 'https://example.com', status: 'new', list_size: 640, created_at: new Date(now - day).toISOString() }],
    polls: [{ id: 'p1', question: 'Pick the next trope ♡', options: N.tropes, is_active: true, created_at: new Date().toISOString() }],
    ama_questions: [{ id: 'q1', question: 'Will we get a book about Stephen’s sister?', name: 'Bea', answered: false, created_at: new Date(now - 2 * day).toISOString() }],
    reminders: [{ id: 'r1', title: 'cover reveal for book two', due_at: new Date(now + 4 * day).toISOString(), kind: 'promo', done: false }],
    newsletter_sends: [{ id: 'n1', subject: 'release week is here ♡', recipient_count: 51, sent_at: new Date(now - 9 * day).toISOString() }]
  };
}

const api = {
  async load() {
    if (DEMO) { Object.assign(D, ls.get('mt.demo', null) || demoData()); return; }
    const q = (t, sel = '*', order = 'created_at') => sb.from(t).select(sel).order(order, { ascending: false }).limit(5000);
    const res = await Promise.all([
      q('subscribers', 'id,email,first_name,status,source,created_at,confirmed_at'), q('issues'), q('swaps'), q('polls'),
      q('ama_questions'), q('reminders', '*', 'due_at'), q('newsletter_sends', 'id,issue_id,subject,recipient_count,sent_at,is_test', 'sent_at')]);
    ['subscribers', 'issues', 'swaps', 'polls', 'ama_questions', 'reminders', 'newsletter_sends'].forEach((k, i) => {
      if (res[i].error) throw res[i].error; D[k] = res[i].data;
    });
  },
  save() { if (DEMO) ls.set('mt.demo', D); },
  async ins(t, row) {
    if (DEMO) { const r = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row }; D[t].unshift(r); api.save(); return r; }
    const { data, error } = await sb.from(t).insert(row).select().single(); if (error) throw error; D[t].unshift(data); return data;
  },
  async upd(t, id, patch) {
    if (DEMO) { const r = D[t].find(x => x.id === id); Object.assign(r, patch); api.save(); return r; }
    const { data, error } = await sb.from(t).update(patch).eq('id', id).select().single(); if (error) throw error;
    const i = D[t].findIndex(x => x.id === id); if (i > -1) D[t][i] = data; return data;
  },
  async del(t, id) {
    if (!DEMO) { const { error } = await sb.from(t).delete().eq('id', id); if (error) throw error; }
    D[t] = D[t].filter(x => x.id !== id); api.save();
  },
  async results(pollId) {
    if (DEMO) return { 0: 14, 1: 22, 2: 9, 3: 17 };
    const { data } = await sb.rpc('poll_results', { p: pollId });
    return Object.fromEntries((data || []).map(r => [r.option_index, Number(r.votes)]));
  },
  async send(issueId, mode) {
    if (DEMO) { await new Promise(r => setTimeout(r, 900)); return mode === 'test' ? { test_to: 'you' } : { sent: D.subscribers.filter(s => s.status === 'confirmed').length }; }
    const r = await fetch(`${N.supabaseUrl.replace(/\/$/, '')}/functions/v1/send-newsletter`, { method: 'POST',
      headers: { apikey: N.anonKey, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue_id: issueId, mode }) });
    const d = await r.json().catch(() => ({})); if (!r.ok || d.error) throw new Error(d.error || 'send failed'); return d;
  }
};
const oops = e => { console.error(e); NL.toast(e.message || 'something went wrong'); };

/* ================= auth ================= */
async function boot() {
  if (DEMO) { $('#demo').hidden = false; return start(); }
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  sb = createClient(N.supabaseUrl, N.anonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
  const { data } = await sb.auth.getSession();
  session = data.session;
  sb.auth.onAuthStateChange((_e, s) => { session = s; });
  if (session) start(); else showLogin();
}
function showLogin() {
  $('#login').hidden = false;
  let mode = 'pw';
  $$('.tabsw button').forEach(b => b.onclick = () => { mode = b.dataset.m; $$('.tabsw button').forEach(x => x.classList.toggle('on', x === b)); $('#pwRow').hidden = mode !== 'pw'; });
  $('#loginForm').onsubmit = async e => {
    e.preventDefault(); const btn = $('#lgo'); NL.busy(btn, true);
    try {
      const email = $('#lem').value.trim();
      if (mode === 'pw') {
        const { data, error } = await sb.auth.signInWithPassword({ email, password: $('#lpw').value });
        if (error) throw error; session = data.session; $('#login').hidden = true; start();
      } else {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split('#')[0], shouldCreateUser: false } });
        if (error) throw error; NL.toast('check your inbox for the magic link ♡');
      }
    } catch (err) { NL.toast(err.message || 'that didn’t work'); }
    NL.busy(btn, false);
  };
}
$('#logout').onclick = async () => { if (sb) await sb.auth.signOut(); location.reload(); };

async function start() {
  try { await api.load(); } catch (e) { oops(e); if (String(e.message).match(/JWT|permission/i)) return showLogin(); }
  $('#app').hidden = false;
  setupNav(); setupComposer(); setupCalendar(); setupSetup();
  renderAll();
  remindersPopup();
  setInterval(() => { renderHome(); remindersPopup(true); }, 5 * 60 * 1000);
}
function renderAll() { renderHome(); renderSubs(); renderSwaps(); renderPolls(); renderAma(); renderCal(); renderIssuePicker(); }

/* ================= nav ================= */
function go(v) {
  $$('.view').forEach(x => x.classList.toggle('show', x.dataset.view === v));
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  history.replaceState(null, '', '#' + v); scrollTo({ top: 0, behavior: 'smooth' });
}
function setupNav() {
  $$('#nav button').forEach(b => b.onclick = () => go(b.dataset.v));
  document.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go); });
  const h = location.hash.slice(1); if ($(`[data-view="${h}"]`)) go(h);
}

/* ================= reminders engine ================= */
function nextSend() { return NL.nextSendDay(new Date()); }
function reminders() {
  const out = [], now = Date.now(), nx = nextSend();
  const near = (d, a, b) => Math.abs(new Date(d) - new Date(a)) < (b || 1.5 * day);
  const planned = D.issues.find(i => i.status === 'scheduled' && near(i.scheduled_for, nx));
  const daysTo = Math.ceil((nx - now) / day);
  if (!planned && daysTo <= 5) out.push({ k: 'warn', ic: '✎', t: `letter due ${daysTo <= 1 ? 'tomorrow' : 'in ' + daysTo + ' days'}`, s: `${fmt(nx, { weekday: 'long', month: 'short', day: 'numeric' })} · nothing scheduled yet`, go: 'write', b: 'write it' });
  else if (planned) out.push({ k: 'good', ic: '⏰', t: 'next letter is scheduled ♡', s: `“${planned.subject}” · ${fmt(planned.scheduled_for, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`, go: 'write', b: 'peek' });
  D.issues.filter(i => i.status === 'scheduled' && new Date(i.scheduled_for) <= now).forEach(i =>
    out.push({ k: 'warn', ic: '✉', t: `“${i.subject}” is due now`, s: 'If automatic sending isn’t on yet, open it and press send.', go: 'write', b: 'open', issue: i.id }));
  D.issues.filter(i => i.status === 'scheduled' && new Date(i.scheduled_for) - now < day && new Date(i.scheduled_for) > now).forEach(i =>
    out.push({ k: 'warn', ic: '🧪', t: 'goes out within 24 hours', s: `Send yourself a test of “${i.subject}” first`, go: 'write', b: 'test', issue: i.id }));
  const ns = D.swaps.filter(s => s.status === 'new').length;
  if (ns) out.push({ k: 'warn', ic: '📚', t: `${ns} new swap request${ns > 1 ? 's' : ''}`, s: 'authors are waiting to hear back', go: 'swaps', b: 'review' });
  const thisMonth = iso(now).slice(0, 7);
  const unplaced = D.swaps.filter(s => s.status === 'approved' && s.month <= thisMonth && !s.issue_id).length;
  if (unplaced) out.push({ k: 'warn', ic: '♡', t: `${unplaced} approved swap${unplaced > 1 ? 's' : ''} not in a letter yet`, s: 'add them to your next letter', go: 'write', b: 'add' });
  D.swaps.filter(s => s.release_date && ['approved', 'scheduled', 'sent'].includes(s.status)).forEach(s => {
    const d = (new Date(s.release_date + 'T00:00:00') - now) / day;
    if (d > -1 && d < 7) out.push({ k: '', ic: '🎉', t: `${s.author_name}'s ${s.book_title} ${d < 0 ? 'is out today' : 'comes out ' + fmt(s.release_date + 'T12:00')}`, s: 'share it on your stories ♡' });
    if (s.status === 'sent' && !s.reciprocal_sent) out.push({ k: '', ic: '↺', t: `did ${s.author_name} feature you back?`, s: 'tick it off in swaps', go: 'swaps', b: 'check' });
  });
  const qa = D.ama_questions.filter(q => !q.answered).length;
  if (qa) out.push({ k: '', ic: '✉', t: `${qa} reader question${qa > 1 ? 's' : ''}`, s: 'answer one in your next letter', go: 'ama', b: 'read' });
  D.reminders.filter(r => !r.done && new Date(r.due_at) - now < 2 * day).forEach(r =>
    out.push({ k: new Date(r.due_at) < now ? 'warn' : '', ic: '♡', t: r.title, s: fmt(r.due_at, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), rem: r.id }));
  if (N.book?.release) {
    const d = Math.ceil((new Date(N.book.release + 'T00:00:00') - now) / day);
    if (d >= 0 && d <= 14) out.push({ k: 'good', ic: '🎾', t: d ? `${d} days until ${N.book.title}` : `${N.book.title} is out today!!`, s: d ? 'plan a release-day letter ♡' : 'send the release-day letter ♡', go: 'write', b: 'write' });
  }
  const stale = D.subscribers.filter(s => s.status === 'pending' && now - new Date(s.created_at) > 3 * day).length;
  if (stale > 2) out.push({ k: '', ic: '📭', t: `${stale} people never confirmed`, s: 'normal! but if it grows, check your spam score in setup', go: 'setup', b: 'setup' });
  if (!out.length) out.push({ k: 'good', ic: '✨', t: 'all caught up', s: 'go write something lovely' });
  return out;
}
function remHtml(list) {
  return list.map((r, i) => `<div class="rem ${r.k}"><div class="ic">${r.ic}</div><div style="min-width:0;flex:1"><b>${esc(r.t)}</b><small>${esc(r.s || '')}</small></div>
    ${r.go ? `<button class="btn xs ${r.k === 'warn' ? 'rose' : 'paper'}" data-rgo="${i}">${esc(r.b)}</button>` : ''}${r.rem ? `<button class="btn xs paper" data-rdone="${r.rem}">done ✓</button>` : ''}</div>`).join('');
}
function wireRems(box, list) {
  box.querySelectorAll('[data-rgo]').forEach(b => b.onclick = () => {
    const r = list[b.dataset.rgo]; $('#pop').classList.remove('open');
    if (r.issue) openIssue(r.issue);
    if (r.b === 'add') addApprovedSwaps();
    go(r.go);
    if (r.b === 'test') setTimeout(() => $('#testSend').click(), 400);
  });
  box.querySelectorAll('[data-rdone]').forEach(b => b.onclick = async () => { await api.upd('reminders', b.dataset.rdone, { done: true }).catch(oops); renderHome(); renderCal(); remList(); });
}
function remindersPopup(quiet) {
  const list = reminders(), urgent = list.filter(r => r.k === 'warn');
  const sig = urgent.map(r => r.t).join('|');
  if (quiet && sessionStorage.getItem('mt.popSig') === sig) return;
  if (!urgent.length && sessionStorage.getItem('mt.popSeen')) return;
  sessionStorage.setItem('mt.popSeen', '1'); sessionStorage.setItem('mt.popSig', sig);
  $('#popIc').textContent = urgent.length ? '🔔' : '✨';
  $('#popH').textContent = `${greeting()}, Mae ♡ ${urgent.length ? "here's what's up" : "you're all caught up"}`;
  const show = urgent.length ? urgent : list.slice(0, 3);
  $('#popList').innerHTML = remHtml(show); wireRems($('#popList'), show);
  $('#pop').classList.add('open');
  if (urgent.length && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible')
    new Notification('mae’s desk ♡', { body: urgent.map(r => r.t).join(' · ') });
}
$('#popX').onclick = $('#popOk').onclick = () => $('#pop').classList.remove('open');
$('#pop').addEventListener('click', e => { if (e.target.id === 'pop') $('#pop').classList.remove('open'); });
$('#notifBtn').onclick = async () => {
  if (!('Notification' in window)) return NL.toast('this browser can’t do notifications');
  const p = await Notification.requestPermission();
  NL.toast(p === 'granted' ? 'reminders on ♡ I’ll ping you when something’s due' : 'no worries, the pop-ups still work');
  if (p === 'granted') new Notification('mae’s desk ♡', { body: 'Reminders are on. I’ll nudge you before every letter.' });
};
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'good morning' : h < 18 ? 'good afternoon' : 'good evening'; };

/* ================= overview ================= */
function renderHome() {
  const S = D.subscribers, conf = S.filter(s => s.status === 'confirmed'), now = Date.now();
  $('#today').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  $('#greet').innerHTML = `${greeting()}, <em>Mae</em>`;
  $('#sConf').textContent = conf.length;
  const wk = S.filter(s => s.status !== 'unsubscribed' && now - new Date(s.created_at) < 7 * day).length;
  $('#sWeek').textContent = wk ? `+${wk} this week ♡` : '';
  $('#sPend').textContent = S.filter(s => s.status === 'pending').length;
  $('#sSent').textContent = D.newsletter_sends.filter(s => !s.is_test).length;
  const nx = nextSend(), dd = Math.max(0, Math.ceil((nx - now) / day));
  $('#sNext').textContent = dd + (dd === 1 ? ' day' : ' days'); $('#sNextD').textContent = fmt(nx, { weekday: 'short', month: 'short', day: 'numeric' });
  // bars: last 8 weeks
  const weeks = Array.from({ length: 8 }, (_, i) => { const end = now - (7 - i) * 7 * day; return { end, n: S.filter(s => { const t = new Date(s.created_at); return t <= end && t > end - 7 * day; }).length }; });
  const max = Math.max(1, ...weeks.map(w => w.n));
  $('#bars').innerHTML = weeks.map(w => `<div style="--h:${Math.round(w.n / max * 100)}%"><b>${w.n || ''}</b><span>${fmt(w.end)}</span></div>`).join('');
  // sources
  const src = {}; S.filter(s => s.status === 'confirmed').forEach(s => src[s.source || 'website'] = (src[s.source || 'website'] || 0) + 1);
  const tot = Math.max(1, conf.length), top = Object.entries(src).sort((a, b) => b[1] - a[1]).slice(0, 6);
  $('#meter').innerHTML = top.length ? top.map(([k, v]) => `<div><span>${esc(k)}</span><i style="--w:${Math.round(v / tot * 100)}%"></i><small>${Math.round(v / tot * 100)}%</small></div>`).join('')
    : '<p class="muted">Add <code class="code">?ref=tiktok</code> to links you share and you’ll see it here.</p>';
  const list = reminders(); $('#rems').innerHTML = remHtml(list); wireRems($('#rems'), list);
  const badge = (id, n) => { $(id).hidden = !n; $(id).textContent = n; };
  badge('#bHome', list.filter(r => r.k === 'warn').length); badge('#bSwaps', D.swaps.filter(s => s.status === 'new').length); badge('#bAma', D.ama_questions.filter(q => !q.answered).length);
}

/* ================= composer ================= */
const BLOCKS = {
  letter: { icon: '✉', name: 'letter', f: [['sticker', 'sticker', '✉ a little letter'], ['title', 'heading', 'hi {{FIRST_NAME}} ♡'], ['text', 'your letter', '', 'ta'], ['signoff', 'sign-off', 'with love, Mae']] },
  book: { icon: '🎾', name: 'my book', f: [['sticker', 'sticker', 'out now ♡'], ['title', 'title', N.book.title], ['text', 'text', '', 'ta'], ['cover', 'cover image', N.book.cover], ['button', 'button', 'grab your copy'], ['link', 'button link', (N.book.buy || []).find(b => b.link)?.link || '']] },
  news: { icon: '♡', name: 'news', f: [['sticker', 'sticker', '♡ news'], ['title', 'heading', ''], ['text', 'text', '', 'ta'], ['button', 'button', 'take a look ♡'], ['link', 'button link', '']] },
  poll: { icon: '✍', name: 'poll', f: [['question', 'question', ''], ['options', 'options (one per line)', '', 'ta']] },
  swap: { icon: '📚', name: 'swap books', f: [['title', 'heading', 'books my friends wrote'], ['text', 'intro', 'A few books from author friends I think you’ll love ♡', 'ta']] },
  ama: { icon: '?', name: 'ask me', f: [['title', 'heading', 'your turn ♡'], ['text', 'text', '', 'ta']] },
  answer: { icon: '💬', name: 'answer', f: [['question', 'reader question', ''], ['text', 'your answer', '', 'ta']] },
  bonus: { icon: '🔒', name: 'secret shelf', f: [['title', 'heading', 'a little extra'], ['text', 'text', '', 'ta'], ['button', 'button', 'open it ♡'], ['link', 'link', SITE + '/#bonus']] },
  ps: { icon: 'p.s.', name: 'p.s.', f: [['text', 'p.s.', '', 'ta']] }
};
let cur = null, prevT;
const blank = () => ({ id: null, subject: '', preheader: '', status: 'draft', scheduled_for: null, blocks: [] });
function fromTemplate() {
  const poll = D.polls.find(p => p.is_active), month = iso(nextSend()).slice(0, 7);
  const blocks = [
    { type: 'letter', sticker: '✉ a little letter', title: 'hi {{FIRST_NAME}} ♡', text: 'Write to them like a friend: what you’re working on, what made you smile this week.', signoff: 'with love, Mae' },
    { type: 'book', sticker: new Date(N.book.release) > new Date() ? 'coming ' + fmt(N.book.release + 'T12:00') : 'out now ♡', title: N.book.title, text: 'One line about the book, or a tiny teaser quote.', cover: N.book.cover, button: 'grab your copy', link: (N.book.buy || []).find(b => b.link)?.link || SITE }];
  if (poll) blocks.push({ type: 'poll', question: poll.question, options: poll.options });
  const sw = swapItems(month); if (sw.length) blocks.push({ type: 'swap', title: 'books my friends wrote', text: 'A few books from author friends I think you’ll love ♡', items: sw, swapIds: sw.map(s => s.id) });
  blocks.push({ type: 'ama', title: 'your turn ♡', text: '' }, { type: 'ps', text: '' });
  return { ...blank(), blocks, scheduled_for: nextSend().toISOString() };
}
function swapItems(month) {
  return D.swaps.filter(s => ['approved', 'scheduled'].includes(s.status) && (!month || s.month <= month) && !s.issue_id)
    .map(s => ({ id: s.id, author_name: s.author_name, book_title: s.book_title, trope: s.trope, release_date: s.release_date, blurb: s.blurb, cover_url: s.cover_url, where_to_buy: s.where_to_buy }));
}
function setupComposer() {
  $('#adders').insertAdjacentHTML('beforeend', Object.entries(BLOCKS).map(([k, b]) => `<button class="chip" data-add="${k}">${b.icon} ${b.name}</button>`).join(''));
  $('#adders').onclick = e => { const k = e.target.closest('[data-add]')?.dataset.add; if (!k) return; addBlock(k); };
  $('#newIssue').onclick = () => { if (dirty() && !confirm('Start a new letter? Your current draft stays saved on this device until you save it.')) return; load(fromTemplate()); NL.toast('fresh letter from your template ✿'); };
  $('#openIssue').onchange = e => { if (e.target.value) openIssue(e.target.value); e.target.value = ''; };
  $('#subj').oninput = $('#pre').oninput = () => { cur.subject = $('#subj').value; cur.preheader = $('#pre').value; changed(); };
  $('#when').onchange = () => { cur.scheduled_for = $('#when').value ? new Date($('#when').value).toISOString() : null; changed(); };
  $$('.prevbar .chip').forEach(c => c.onclick = () => { $$('.prevbar .chip').forEach(x => x.classList.toggle('on', x === c)); $('#pw').classList.toggle('phone', c.dataset.d === 'phone'); });
  $('#saveDraft').onclick = () => persist('draft').then(() => NL.toast('draft saved ♡')).catch(oops);
  $('#schedule').onclick = async () => {
    if (!cur.scheduled_for) return NL.toast('pick a date and time first');
    if (new Date(cur.scheduled_for) < Date.now()) return NL.toast('that time is in the past ♡');
    try { await persist('scheduled'); NL.toast(`scheduled for ${fmt(cur.scheduled_for, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ⏰`); } catch (e) { oops(e); }
  };
  $('#testSend').onclick = async () => {
    const b = $('#testSend'); NL.busy(b, true);
    try { await persist(cur.status === 'scheduled' ? 'scheduled' : 'draft'); const r = await api.send(cur.id, 'test'); NL.toast(`test sent to ${r.test_to} ♡`); } catch (e) { oops(e); }
    NL.busy(b, false);
  };
  $('#sendNow').onclick = async () => {
    const n = D.subscribers.filter(s => s.status === 'confirmed').length;
    if (!cur.subject.trim()) return NL.toast('give it a subject line first ♡');
    if (!confirm(`Send “${cur.subject}” to ${n} confirmed reader${n === 1 ? '' : 's'} now?\n\nPending and unsubscribed readers never get it.`)) return;
    const b = $('#sendNow'); NL.busy(b, true);
    try {
      await persist('draft'); const r = await api.send(cur.id, 'now');
      Object.assign(cur, { status: 'sent', sent_at: new Date().toISOString() });
      if (DEMO) { await api.upd('issues', cur.id, { status: 'sent', sent_at: cur.sent_at }); D.newsletter_sends.unshift({ id: crypto.randomUUID(), subject: cur.subject, recipient_count: r.sent, sent_at: cur.sent_at }); }
      else await api.load();
      NL.petals(innerWidth / 2, innerHeight / 2, 30); NL.toast(`sent to ${r.sent} readers ✉ ♡`);
      localStorage.removeItem('mt.draft'); renderAll(); load(D.issues.find(i => i.id === cur.id) || cur);
    } catch (e) { oops(e); }
    NL.busy(b, false);
  };
  load(ls.get('mt.draft', null) || fromTemplate());
}
const dirty = () => cur && (cur.subject || cur.blocks.some(b => b.text));
function load(issue) {
  cur = JSON.parse(JSON.stringify({ ...blank(), ...issue }));
  $('#subj').value = cur.subject; $('#pre').value = cur.preheader;
  $('#when').value = cur.scheduled_for ? local(cur.scheduled_for) : local(nextSend());
  if (!cur.scheduled_for) cur.scheduled_for = new Date($('#when').value).toISOString();
  const locked = cur.status === 'sent';
  ['#saveDraft', '#testSend', '#schedule', '#sendNow'].forEach(s => $(s).disabled = locked && s !== '#testSend');
  $('#wState').textContent = cur.id ? `${cur.status}${cur.status === 'sent' ? ' ' + fmt(cur.sent_at) + ' · read only' : ''}` : 'new letter · not saved yet';
  drawBlocks(); preview();
}
function openIssue(id) { const i = D.issues.find(x => x.id === id); if (i) { load(i); go('write'); } }
function addBlock(k, data) {
  const def = BLOCKS[k], b = { type: k, ...Object.fromEntries(def.f.map(([n, , d]) => [n, d])), ...(data || {}) };
  if (k === 'poll' && !data) { const p = D.polls.find(p => p.is_active); if (p) { b.question = p.question; b.options = p.options; } }
  if (k === 'swap' && !data) { b.items = swapItems(iso(cur.scheduled_for || Date.now()).slice(0, 7)); b.swapIds = b.items.map(s => s.id); if (!b.items.length) NL.toast('no approved swaps yet: approve some in swaps ♡'); }
  cur.blocks.push(b); drawBlocks(); changed();
  setTimeout(() => $('#blocks').lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
}
function addApprovedSwaps() {
  const items = swapItems(); if (!items.length) return;
  const ex = cur.blocks.find(b => b.type === 'swap');
  if (ex) { const have = new Set(ex.items.map(i => i.id)); items.forEach(i => { if (!have.has(i.id)) ex.items.push(i); }); ex.swapIds = ex.items.map(i => i.id); }
  else addBlock('swap', { title: 'books my friends wrote', text: 'A few books from author friends I think you’ll love ♡', items, swapIds: items.map(i => i.id) });
  drawBlocks(); changed();
}
function drawBlocks() {
  $('#blocks').innerHTML = cur.blocks.map((b, i) => {
    const def = BLOCKS[b.type]; if (!def) return '';
    const fields = def.f.map(([n, label, , kind]) => {
      let v = b[n] ?? ''; if (n === 'options' && Array.isArray(v)) v = v.join('\n');
      return `<div class="f"><label>${label}</label>${kind === 'ta' ? `<textarea data-i="${i}" data-n="${n}" rows="${n === 'text' ? 5 : 4}">${esc(v)}</textarea>` : `<input data-i="${i}" data-n="${n}" value="${esc(v)}">`}</div>`;
    }).join('');
    const extra = b.type === 'swap' ? `<div class="softlist" style="margin-bottom:12px">${(b.items || []).map((s, j) => `<div class="row" style="justify-content:space-between"><span><b>${esc(s.book_title)}</b> <small class="muted">by ${esc(s.author_name)}</small></span><button class="mini" data-rmswap="${i}:${j}" title="remove">✕</button></div>`).join('') || '<small class="muted">no swaps in this block yet</small>'}</div><button class="btn xs paper" data-pullswap="${i}" style="margin-bottom:12px">↻ pull approved swaps</button>` : '';
    return `<div class="blk" data-t="${b.type}"><div class="top"><span class="tag ${b.type === 'swap' ? 'sage' : 'rose'}">${def.icon} ${def.name}</span><span class="sp"></span>
      <button class="mini" data-mv="${i}:-1" title="move up" aria-label="move up">↑</button><button class="mini" data-mv="${i}:1" title="move down" aria-label="move down">↓</button><button class="mini" data-rm="${i}" title="remove" aria-label="remove">✕</button></div>${fields}${extra}</div>`;
  }).join('') || '<p class="muted center" style="padding:20px">Add sections below, or start from your template ✿</p>';
  $$('#blocks [data-n]').forEach(el => el.oninput = () => {
    const b = cur.blocks[el.dataset.i]; b[el.dataset.n] = el.dataset.n === 'options' ? el.value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8) : el.value; changed();
  });
  $$('#blocks [data-rm]').forEach(el => el.onclick = () => { cur.blocks.splice(+el.dataset.rm, 1); drawBlocks(); changed(); });
  $$('#blocks [data-mv]').forEach(el => el.onclick = () => { const [i, d] = el.dataset.mv.split(':').map(Number), j = i + d; if (j < 0 || j >= cur.blocks.length) return; [cur.blocks[i], cur.blocks[j]] = [cur.blocks[j], cur.blocks[i]]; drawBlocks(); changed(); });
  $$('#blocks [data-rmswap]').forEach(el => el.onclick = () => { const [i, j] = el.dataset.rmswap.split(':').map(Number); cur.blocks[i].items.splice(j, 1); cur.blocks[i].swapIds = cur.blocks[i].items.map(s => s.id); drawBlocks(); changed(); });
  $$('#blocks [data-pullswap]').forEach(el => el.onclick = () => addApprovedSwaps());
}
function changed() {
  if (cur.status !== 'sent') { ls.set('mt.draft', cur); $('#saveSt').textContent = 'saved on this device · ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  clearTimeout(prevT); prevT = setTimeout(preview, 140);
}
function preview() {
  const html = frame({ inner: renderBlocks(cur.blocks, { siteUrl: SITE, issueRef: 'preview' }), preheader: cur.preheader, siteUrl: SITE,
    unsubUrl: '#', address: '[your postal address is added here automatically]' }).replaceAll('{{FIRST_NAME}}', 'Avery').replaceAll('{{first_name}}', 'Avery');
  $('#prev').srcdoc = html.replace('<head>', '<head><base target="_blank">');
}
async function persist(status) {
  if (cur.status === 'sent') throw new Error('This letter already went out.');
  const row = { subject: cur.subject.trim(), preheader: cur.preheader.trim(), blocks: cur.blocks, status, scheduled_for: status === 'scheduled' ? cur.scheduled_for : cur.scheduled_for,
    body_html: frame({ inner: renderBlocks(cur.blocks, { siteUrl: SITE }), preheader: cur.preheader, siteUrl: SITE }), updated_at: new Date().toISOString() };
  const saved = cur.id ? await api.upd('issues', cur.id, row) : await api.ins('issues', row);
  cur.id = saved.id; cur.status = status;
  // link swaps used in this letter
  const ids = cur.blocks.filter(b => b.type === 'swap').flatMap(b => b.swapIds || []);
  for (const id of ids) { const s = D.swaps.find(x => x.id === id); if (s && s.issue_id !== cur.id) await api.upd('swaps', id, { issue_id: cur.id, status: 'scheduled' }); }
  ls.set('mt.draft', cur); $('#wState').textContent = status; $('#saveSt').textContent = 'saved ♡ ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  renderIssuePicker(); renderHome(); renderCal(); renderSwaps();
}
function renderIssuePicker() {
  $('#openIssue').innerHTML = `<option value="">open a letter…</option>` + D.issues.map(i =>
    `<option value="${i.id}">${i.status === 'sent' ? '✓' : i.status === 'scheduled' ? '⏰' : '✎'} ${esc(i.subject || 'untitled')} · ${fmt(i.sent_at || i.scheduled_for || i.created_at)}</option>`).join('');
}

/* ================= calendar ================= */
let calM = new Date(); calM.setDate(1);
function setupCalendar() {
  $('#calPrev').onclick = () => { calM.setMonth(calM.getMonth() - 1); renderCal(); };
  $('#calNext').onclick = () => { calM.setMonth(calM.getMonth() + 1); renderCal(); };
  $('#calToday').onclick = () => { calM = new Date(); calM.setDate(1); renderCal(); };
  $('#calKey').value = ls.get('mt.calKey', ''); $('#calKey').oninput = () => { ls.set('mt.calKey', $('#calKey').value.trim()); calLinks(); }; calLinks();
  $('#remW').value = local(Date.now() + day);
  $('#remForm').onsubmit = async e => { e.preventDefault();
    try { await api.ins('reminders', { title: $('#remT').value.trim(), due_at: new Date($('#remW').value).toISOString(), kind: $('#remK').value, done: false });
      e.target.reset(); $('#remW').value = local(Date.now() + day); NL.toast('reminder added ♡'); renderCal(); renderHome(); remList(); } catch (er) { oops(er); } };
  remList();
}
function calLinks() {
  const k = ls.get('mt.calKey', ''), base = (N.supabaseUrl || '').replace(/\/$/, '');
  if (!k || !base) { $('#calLinks').innerHTML = '<small class="muted">Add your Supabase link in nl/config.js and your key above to get the subscribe buttons.</small>'; return; }
  const url = `${base}/functions/v1/calendar-feed?key=${encodeURIComponent(k)}`, webcal = url.replace(/^https:/, 'webcal:');
  $('#calLinks').innerHTML = `<a class="btn sm rose" target="_blank" rel="noopener" href="https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}">+ Google Calendar</a>
    <a class="btn sm paper" href="${esc(webcal)}">+ Apple Calendar</a><button class="btn sm ghost" id="cpFeed">copy link</button>`;
  $('#cpFeed').onclick = () => navigator.clipboard.writeText(url).then(() => NL.toast('copied ♡'));
}
function remList() {
  $('#remList').innerHTML = D.reminders.filter(r => !r.done).sort((a, b) => a.due_at.localeCompare(b.due_at)).slice(0, 8).map(r =>
    `<div class="r"><div class="av">♡</div><div class="main"><b>${esc(r.title)}</b><small>${fmt(r.due_at, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${r.kind}</small></div>
     <a class="btn xs paper" target="_blank" rel="noopener" href="${NL.gcal({ title: r.title, date: iso(r.due_at) })}">+ gcal</a><button class="btn xs sage" data-done="${r.id}">done</button></div>`).join('') || '<small class="muted">no reminders yet</small>';
  $$('#remList [data-done]').forEach(b => b.onclick = async () => { await api.upd('reminders', b.dataset.done, { done: true }).catch(oops); remList(); renderCal(); renderHome(); });
}
function calEvents() {
  const ev = [];
  D.issues.forEach(i => { const d = i.sent_at || i.scheduled_for; if (d) ev.push({ d: iso(d), cls: i.status === 'sent' ? 'sent' : i.status === 'scheduled' ? 'scheduled' : 'draft', t: i.subject || 'untitled', issue: i.id }); });
  D.swaps.filter(s => ['approved', 'scheduled', 'sent'].includes(s.status)).forEach(s => {
    const iss = D.issues.find(i => i.id === s.issue_id);
    ev.push({ d: iss ? iso(iss.sent_at || iss.scheduled_for || Date.now()) : s.month + '-01', cls: 'swap', t: '📚 ' + s.book_title });
    if (s.release_date) ev.push({ d: s.release_date, cls: 'swap', t: '🎉 ' + s.author_name });
  });
  D.reminders.filter(r => !r.done).forEach(r => ev.push({ d: iso(r.due_at), cls: 'rem', t: '♡ ' + r.title }));
  if (N.book?.release) ev.push({ d: N.book.release, cls: 'rel', t: '🎾 ' + N.book.title });
  return ev;
}
function renderCal() {
  const y = calM.getFullYear(), m = calM.getMonth();
  $('#calTitle').innerHTML = `${calM.toLocaleDateString(undefined, { month: 'long' })} <em>${y}</em>`;
  const first = new Date(y, m, 1), start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
  const ev = calEvents(), today = iso(Date.now()), send = N.sendDays || [1, 15];
  let h = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(d => `<div class="dn">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (i >= 35 && d.getMonth() !== m) break;
    const es = ev.filter(e => e.d === key);
    h += `<div class="c ${d.getMonth() !== m ? 'out' : ''} ${key === today ? 'today' : ''} ${send.includes(d.getDate()) ? 'send' : ''}">
      <span class="num">${d.getDate()}${send.includes(d.getDate()) ? ' <small style="font-size:11px">✉</small>' : ''}</span>
      ${es.map(e => `<a class="ev ${e.cls}" ${e.issue ? `data-iss="${e.issue}" href="#write"` : ''} title="${esc(e.t)}">${esc(e.t)}</a>`).join('')}</div>`;
  }
  $('#cal').innerHTML = h;
  $$('#cal [data-iss]').forEach(a => a.onclick = e => { e.preventDefault(); openIssue(a.dataset.iss); });
}

/* ================= readers ================= */
let sFilter = 'confirmed';
function renderSubs() {
  const S = D.subscribers, c = st => S.filter(s => st === 'all' || s.status === st).length;
  $('#sf').innerHTML = ['confirmed', 'pending', 'unsubscribed', 'all'].map(k => `<button class="chip ${sFilter === k ? 'on' : ''}" data-f="${k}">${k} · ${c(k)}</button>`).join('');
  $$('#sf .chip').forEach(b => b.onclick = () => { sFilter = b.dataset.f; renderSubs(); });
  const q = ($('#sq').value || '').toLowerCase();
  const list = S.filter(s => (sFilter === 'all' || s.status === sFilter) && (!q || (s.email + ' ' + (s.first_name || '')).toLowerCase().includes(q))).slice(0, 300);
  $('#subList').innerHTML = list.map(s => `<div class="r"><div class="av">${esc((s.first_name || s.email)[0].toUpperCase())}</div>
    <div class="main"><b>${esc(s.first_name ? s.first_name + ' · ' : '')}${esc(s.email)}</b><small>joined ${fmt(s.created_at, { month: 'short', day: 'numeric', year: 'numeric' })} · via ${esc(s.source || 'website')}</small></div>
    <span class="tag ${s.status === 'confirmed' ? 'sage' : s.status === 'pending' ? 'rose' : ''}">${s.status}</span>
    <button class="btn xs ghost" data-del="${s.id}" title="delete forever (e.g. a data request)">delete</button></div>`).join('') || '<p class="muted">nobody here yet ♡</p>';
  $$('#subList [data-del]').forEach(b => b.onclick = async () => { if (!confirm('Delete this reader forever? (Use this for “please delete my data” requests.)')) return; await api.del('subscribers', b.dataset.del).catch(oops); renderSubs(); renderHome(); });
}
$('#sq').oninput = () => renderSubs();
$('#csv').onclick = () => {
  const rows = [['email', 'first_name', 'status', 'source', 'joined']].concat(D.subscribers.map(s => [s.email, s.first_name || '', s.status, s.source || '', s.created_at]));
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `readers-${iso(Date.now())}.csv`; a.click();
};

/* ================= swaps ================= */
let wFilter = 'new';
function renderSwaps() {
  const W = D.swaps, c = st => W.filter(s => st === 'all' || s.status === st).length;
  $('#swf').innerHTML = ['new', 'approved', 'scheduled', 'sent', 'declined', 'all'].map(k => `<button class="chip ${wFilter === k ? 'on' : ''}" data-f="${k}">${k} · ${c(k)}</button>`).join('');
  $$('#swf .chip').forEach(b => b.onclick = () => { wFilter = b.dataset.f; renderSwaps(); });
  const list = W.filter(s => wFilter === 'all' || s.status === wFilter);
  const link = (u, l) => /^https?:\/\//.test(u || '') ? `<a href="${esc(u)}" target="_blank" rel="noopener">${l} ↗</a>` : '';
  $('#swapList').innerHTML = list.map(s => {
    const mail = `mailto:${encodeURIComponent(s.email)}?subject=${encodeURIComponent('Newsletter swap ♡ ' + s.book_title)}&body=${encodeURIComponent(`Hi ${s.author_name}!\n\nThank you for the swap request. I'd love to feature ${s.book_title} in my ${s.month} letter. Could you share Call It a Let with your readers the same month?\n\nBook link: ${SITE}\n\nwith love,\nMae`)}`;
    return `<div class="sc"><span class="tag st ${s.status === 'new' ? 'rose' : s.status === 'declined' ? '' : 'sage'}">${s.status}</span>
      <div class="hd"><div class="cv" style="${/^https:\/\//.test(s.cover_url || '') ? `background-image:url('${esc(s.cover_url).replace(/'/g, '')}')` : ''}"></div>
        <div style="min-width:0;padding-right:60px"><h4>${esc(s.book_title)}</h4><small class="muted">by ${esc(s.author_name)}</small>
        <div class="meta" style="margin-top:6px"><span class="tag">🗓 ${esc(s.month)}</span>${s.trope ? `<span class="tag rose">${esc(s.trope)}</span>` : ''}${s.heat ? `<span class="tag">${esc(s.heat)}</span>` : ''}${s.list_size ? `<span class="tag sage">${Number(s.list_size).toLocaleString()} readers</span>` : ''}</div></div></div>
      ${s.blurb ? `<p style="margin:0;font-size:14px">${esc(s.blurb)}</p>` : ''}${s.notes ? `<p class="muted" style="margin:0;font-size:13px">✎ ${esc(s.notes)}</p>` : ''}
      <div class="links">${link(s.where_to_buy, 'buy')}${link(s.newsletter_link, 'their swap link')}${link(s.news_link, 'news')}${s.release_date ? `<span class="tag">out ${fmt(s.release_date + 'T12:00')}</span>` : ''}</div>
      <div class="row" style="gap:6px">
        ${s.status === 'new' ? `<button class="btn xs rose" data-sw="${s.id}:approved">approve ♡</button><button class="btn xs ghost" data-sw="${s.id}:declined">decline</button>` : ''}
        ${['approved', 'scheduled'].includes(s.status) ? `<button class="btn xs dark" data-addsw="${s.id}">+ to my letter</button>` : ''}
        ${s.status === 'sent' ? `<label class="check" style="font-size:12.5px"><input type="checkbox" data-recip="${s.id}" ${s.reciprocal_sent ? 'checked' : ''}> they featured me back</label>` : ''}
        <a class="btn xs paper" href="${mail}">email ✉</a></div></div>`;
  }).join('') || '<p class="muted">nothing here ♡ share yoursite.com/swap with author friends</p>';
  $$('[data-sw]').forEach(b => b.onclick = async () => { const [id, st] = b.dataset.sw.split(':'); await api.upd('swaps', id, { status: st }).catch(oops); NL.toast(st === 'approved' ? 'approved ♡ it’ll show up in your next letter' : 'declined'); renderSwaps(); renderHome(); renderCal(); });
  $$('[data-addsw]').forEach(b => b.onclick = () => {
    const s = D.swaps.find(x => x.id === b.dataset.addsw), item = swapItems().find(x => x.id === s.id) || { id: s.id, author_name: s.author_name, book_title: s.book_title, trope: s.trope, release_date: s.release_date, blurb: s.blurb, cover_url: s.cover_url, where_to_buy: s.where_to_buy };
    const ex = cur.blocks.find(x => x.type === 'swap');
    if (ex) { if (!ex.items.some(i => i.id === s.id)) ex.items.push(item); ex.swapIds = ex.items.map(i => i.id); drawBlocks(); changed(); } else addBlock('swap', { title: 'books my friends wrote', text: 'A few books from author friends I think you’ll love ♡', items: [item], swapIds: [s.id] });
    go('write'); NL.toast('added to your letter ♡');
  });
  $$('[data-recip]').forEach(c => c.onchange = () => api.upd('swaps', c.dataset.recip, { reciprocal_sent: c.checked }).then(renderHome).catch(oops));
}

/* ================= polls ================= */
async function renderPolls() {
  $('#po').value ||= (N.tropes || []).join('\n');
  const html = await Promise.all(D.polls.map(async p => {
    const r = await api.results(p.id), tot = Object.values(r).reduce((a, b) => a + b, 0);
    return `<div class="card ${p.is_active ? '' : ''}"><div class="row" style="justify-content:space-between"><span class="tag ${p.is_active ? 'rose' : ''}">${p.is_active ? '● live' : 'closed'}</span><small class="muted">${tot} votes</small></div>
      <h3 class="h3" style="margin:10px 0 4px">${esc(p.question)}</h3>
      <div class="poll">${p.options.map((o, i) => { const pct = tot ? Math.round((r[i] || 0) / tot * 100) : 0; return `<div class="popt" style="cursor:default"><i class="fill" style="width:${pct}%"></i><span><b>${esc(o)}</b><em>${pct}% · ${r[i] || 0}</em></span></div>`; }).join('')}</div>
      <div class="row" style="margin-top:12px">${p.is_active ? `<button class="btn xs ghost" data-pc="${p.id}">close poll</button>` : `<button class="btn xs sage" data-pa="${p.id}">make live</button>`}<button class="btn xs paper" data-pu="${p.id}">+ to my letter</button></div></div>`;
  }));
  $('#pollList').innerHTML = html.join('') || '<p class="muted">no polls yet</p>';
  $$('[data-pa]').forEach(b => b.onclick = () => activate(b.dataset.pa));
  $$('[data-pc]').forEach(b => b.onclick = async () => { await api.upd('polls', b.dataset.pc, { is_active: false }).catch(oops); renderPolls(); });
  $$('[data-pu]').forEach(b => b.onclick = () => { const p = D.polls.find(x => x.id === b.dataset.pu); addBlock('poll', { question: p.question, options: p.options }); go('write'); });
}
async function activate(id) {
  try { for (const p of D.polls.filter(p => p.is_active && p.id !== id)) await api.upd('polls', p.id, { is_active: false }); await api.upd('polls', id, { is_active: true }); NL.toast('poll is live on your site ♡'); } catch (e) { oops(e); }
  renderPolls();
}
$('#pollForm').onsubmit = async e => {
  e.preventDefault();
  const options = $('#po').value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8);
  if (options.length < 2) return NL.toast('add at least two options');
  try { const p = await api.ins('polls', { question: $('#pq').value.trim(), options, is_active: false }); await activate(p.id); } catch (er) { oops(er); }
};

/* ================= questions ================= */
function renderAma() {
  const list = D.ama_questions.slice().sort((a, b) => a.answered - b.answered || b.created_at.localeCompare(a.created_at));
  $('#amaList').innerHTML = list.map(q => `<div class="r" style="${q.answered ? 'opacity:.6' : ''}"><div class="av">?</div>
    <div class="main"><b style="word-break:normal;font-family:var(--serif);font-style:italic;font-weight:400;font-size:19px">“${esc(q.question)}”</b><small>${esc(q.name || 'anonymous')} · ${fmt(q.created_at)}${q.issue_ref ? ' · from ' + esc(q.issue_ref) : ''}</small></div>
    ${q.answered ? '<span class="tag sage">answered</span>' : `<button class="btn xs rose" data-ans="${q.id}">answer in my letter</button><button class="btn xs paper" data-done="${q.id}">mark answered</button>`}
    <button class="btn xs ghost" data-qdel="${q.id}">✕</button></div>`).join('') || '<p class="muted">no questions yet ♡ they’ll show up here</p>';
  $$('#amaList [data-ans]').forEach(b => b.onclick = async () => { const q = D.ama_questions.find(x => x.id === b.dataset.ans); addBlock('answer', { question: q.question, text: '' }); await api.upd('ama_questions', q.id, { answered: true }).catch(oops); renderAma(); renderHome(); go('write'); });
  $$('#amaList [data-done]').forEach(b => b.onclick = async () => { await api.upd('ama_questions', b.dataset.done, { answered: true }).catch(oops); renderAma(); renderHome(); });
  $$('#amaList [data-qdel]').forEach(b => b.onclick = async () => { await api.del('ama_questions', b.dataset.qdel).catch(oops); renderAma(); renderHome(); });
}

/* ================= setup checklist ================= */
function setupSetup() {
  const D1 = [
    'Buy / use your domain and point it at GitHub Pages (Settings → Pages → Custom domain)',
    'Resend → Domains → Add domain (use a subdomain like <code>send.YOURDOMAIN</code> or <code>mail.YOURDOMAIN</code>)',
    'Copy the MX + SPF + DKIM records Resend shows into your domain’s DNS, exactly as given',
    'Add a DMARC record: <code>_dmarc</code> TXT <code>v=DMARC1; p=none; rua=mailto:you@YOURDOMAIN;</code>',
    'Click “Verify” in Resend and wait for every record to go green (15 min to 72 h)',
    'Set FROM_EMAIL to <code>Mae Tao &lt;hello@YOURDOMAIN&gt;</code> and REPLY_TO to an inbox you read',
    'Set POSTAL_ADDRESS (a PO box or virtual mailbox is fine). It goes in every footer',
    'Send a test to Gmail + Outlook + iCloud, then check “Show original”: SPF, DKIM, DMARC all PASS',
    'After a month of clean sends, change DMARC to <code>p=quarantine</code>',
    'Optional: Supabase → Auth → SMTP → use Resend so your login emails come from your domain too'];
  const A = [
    'Sign up on /newsletter → confirmation email arrives',
    'Click confirm → bonus chapter + welcome email arrive, secret shelf unlocks',
    'A pending (unconfirmed) test email does NOT get a newsletter',
    'Unsubscribe link → one click → status shows unsubscribed → no more sends',
    'Gmail’s own “Unsubscribe” button (top of email) also works',
    'Vote in the poll → results update, can’t vote twice from the same browser',
    'Ask-me-anything question shows up under questions',
    'Swap request on /swap shows up under swaps',
    'View source on the live site: no secret keys (Supabase service-role key or Resend key) anywhere',
    'Open every page on your phone: no sideways scrolling'];
  const draw = (id, items, key) => {
    const done = ls.get(key, {});
    $(id).innerHTML = items.map((t, i) => `<label><input type="checkbox" class="sr" data-k="${i}" ${done[i] ? 'checked' : ''}><span class="tag ${done[i] ? 'sage' : 'rose'}" style="flex:0 0 auto">${done[i] ? '✓' : i + 1}</span><span>${t}</span></label>`).join('');
    $(id).onchange = e => { done[e.target.dataset.k] = e.target.checked; ls.set(key, done); draw(id, items, key); };
  };
  draw('#todoD', D1, 'mt.todoD'); draw('#todoA', A, 'mt.todoA');
  $('#dns').innerHTML = [['MX', 'send', 'feedback-smtp.&lt;region&gt;.amazonses.com · priority 10'], ['TXT', 'send', 'v=spf1 include:amazonses.com ~all'], ['TXT', 'resend._domainkey', 'p=MIGf… (long key Resend gives you)'], ['TXT', '_dmarc', 'v=DMARC1; p=none; rua=mailto:you@YOURDOMAIN;']]
    .map(([t, n, v]) => `<div><span class="tag rose">${t}</span><code>${n}</code><span class="code">${v}</span></div>`).join('');
}

boot().catch(oops);
