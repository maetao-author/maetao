/* ♡ Newsletter extras for the main website: pop-ups, poll, release-day nudge.
   Loaded by index.html after nl/config.js and nl/nl.js. Reuses the site's own toast() and petals(). */
(function () {
  const N = window.MAE_NL || {}, P = N.popup || {};
  if (typeof window.toast === 'function') NL.toast = window.toast;
  if (typeof window.petals === 'function') NL.petals = (x, y) => window.petals(x, y);

  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { } } };
  const joined = () => store.get('mt.unlocked') === '1' || store.get('mt.joinedAt');
  const snoozed = () => Number(store.get('mt.popSnooze') || 0) > Date.now();
  const snooze = days => store.set('mt.popSnooze', String(Date.now() + days * 864e5));

  /* ---------- 1 · signup pop-up (after a while, on scroll, or exit intent) ---------- */
  function buildPop() {
    const el = document.createElement('div');
    el.className = 'mt-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'mtPopH');
    el.innerHTML = `<div class="mt-sheet">
      <button class="mt-x" aria-label="close">✕</button>
      <div class="mt-env" aria-hidden="true"><img src="nl/heart.svg" alt="" width="52" height="52"></div>
      <span class="mt-tape">a little gift for you</span>
      <h2 class="mt-h" id="mtPopH">want <em>Stephen's</em> side of the story?</h2>
      <p class="mt-p">Join my letters and get <b>${NL.esc(N.magnet?.name || 'a bonus chapter')}</b> free: ${NL.esc(N.magnet?.tagline || '')}.</p>
      <form class="mt-form" novalidate>
        <input class="mt-in" name="fn" placeholder="first name (optional)" autocomplete="given-name" maxlength="60" aria-label="first name">
        <input class="mt-in" name="em" type="email" placeholder="your email" autocomplete="email" required aria-label="email">
        <input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
        <button class="mt-btn" type="submit">send me the chapter ♡</button>
      </form>
      <button class="mt-later" type="button">maybe later</button>
      <div class="mt-small">two letters a month · unsubscribe in one click</div>
    </div>`;
    document.body.appendChild(el);
    const close = () => { el.classList.remove('open'); snooze(P.snoozeDays || 10); last && last.focus(); };
    let last;
    el.querySelector('.mt-x').onclick = close; el.querySelector('.mt-later').onclick = close;
    el.addEventListener('click', e => { if (e.target === el) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && el.classList.contains('open')) close(); });
    el.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, btn = f.querySelector('button');
      if (f.website.value) return;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(f.em.value.trim())) { NL.toast('that email looks a little off ♡'); return; }
      NL.busy(btn, true);
      try { await window.mtSubscribe(f.em.value.trim(), f.fn.value.trim(), 'popup'); }
      catch (err) { NL.toast(err.message); NL.busy(btn, false); }
    });
    return { open() { last = document.activeElement; el.classList.add('open'); setTimeout(() => el.querySelector('[name=em]').focus(), 350); } };
  }

  // open the pop-up from any button, e.g. <button onclick="mtOpenPopup()">join</button>
  let popInst;
  window.mtOpenPopup = () => (popInst = popInst || buildPop()).open();

  // one subscribe for every form on the site (popup, newsletter tab, secret shelf)
  window.mtSubscribe = async function (email, firstName, src) {
    const r = await NL.subscribe(email, firstName, src);
    store.set('mt.joinedAt', String(Date.now()));
    sessionStorage.setItem('mt.joined', email);
    location.href = 'thanks/' + (r.preview ? '?preview=1' : '');
  };

  if (P.enabled !== false && !joined() && !snoozed() && !/^#(newsletter|bonus)/.test(location.hash)) {
    let shown = false;
    const show = () => { if (shown || joined() || document.querySelector('.ov')) return; shown = true; window.mtOpenPopup(); };
    setTimeout(show, (P.delaySeconds || 25) * 1000);
    addEventListener('scroll', () => {
      const pct = (scrollY + innerHeight) / document.documentElement.scrollHeight * 100;
      if (pct > (P.scrollPercent || 55)) show();
    }, { passive: true });
    if (P.exitIntent !== false && matchMedia('(pointer:fine)').matches)
      document.addEventListener('mouseout', e => { if (!e.relatedTarget && e.clientY < 8) show(); });
  }

  /* ---------- 2 · release-day / poll nudge (bottom corner) ---------- */
  function nudge({ icon, title, text, actions, key }) {
    if (store.get('mt.nudge.' + key)) return;
    const el = document.createElement('div');
    el.className = 'mt-nudge'; el.setAttribute('role', 'status');
    el.innerHTML = `<div class="ic" aria-hidden="true">${icon}</div><div style="min-width:0;flex:1"><b>${title}</b><small>${text}</small><div class="acts">${actions}</div></div><button class="mt-x" aria-label="dismiss">✕</button>`;
    document.body.appendChild(el);
    const bye = () => { el.classList.remove('open'); store.set('mt.nudge.' + key, '1'); setTimeout(() => el.remove(), 800); };
    el.querySelector('.mt-x').onclick = bye; el.querySelectorAll('a').forEach(a => a.addEventListener('click', bye));
    setTimeout(() => el.classList.add('open'), 4000);
  }
  const B = N.book || {};
  if (B.release) {
    const days = Math.ceil((new Date(B.release + 'T00:00:00') - Date.now()) / 864e5);
    const evt = { title: `🎾 ${B.title} is out!`, date: B.release, details: `Release day for ${B.title} by Mae Tao ♡ ${location.origin}`, uid: 'cial-release' };
    if (days > 0 && days <= 30) nudge({ key: 'rel-' + B.release, icon: '🎾', title: `${days} day${days === 1 ? '' : 's'} until ${NL.esc(B.title)}`,
      text: 'Want a reminder on release day?', actions:
      `<a class="mt-btn sm" target="_blank" rel="noopener" href="${NL.gcal(evt)}">Google Calendar</a><a class="mt-btn sm soft" download="call-it-a-let.ics" href="${NL.ics(evt)}">Apple / Outlook</a>` });
    else if (days <= 0 && days > -14) {
      const buy = (B.buy || []).find(b => b.link);
      nudge({ key: 'out-' + B.release, icon: '🎉', title: `${NL.esc(B.title)} is out now!`, text: 'Thank you for being here for it ♡',
        actions: buy ? `<a class="mt-btn sm" href="${NL.esc(buy.link)}">get your copy</a>` : `<a class="mt-btn sm" href="#books">see the book</a>` });
    }
  }

  /* ---------- 3 · poll + links inside the site's newsletter tab ---------- */
  const sec = document.querySelector('#newsletter .wrap');
  if (sec) {
    const box = document.createElement('div');
    box.className = 'mt-row';
    box.innerHTML = `<div class="mt-pollcard"><span class="tape sage">✍ trope poll</span><div id="mtPoll"></div></div>
      <div class="card"><div class="lab">what's inside</div>
        <h3 style="font-family:var(--head);font-weight:800;letter-spacing:-.03em;font-size:24px;margin:8px 0 6px">${NL.esc(N.magnet?.name || 'a bonus chapter')}</h3>
        <p style="color:var(--ink2);margin:0 0 14px">${NL.esc(N.magnet?.tagline || '')}. Plus two letters a month, your questions answered, and books from my author friends.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn rose sm" href="newsletter/">more about the letters</a><a class="btn sage sm" href="newsletter/#ama">ask me anything</a><a class="btn ghost sm" href="swap/">authors: swap ✉</a></div></div>`;
    sec.appendChild(box);
    NL.mountPoll(box.querySelector('#mtPoll'));
  }
})();
