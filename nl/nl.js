/* 𖹭 tiny helpers shared by every newsletter page (no framework, no keys beyond the public anon key) */
(function () {
  const N = window.MAE_NL || {};
  // where the site's root is, worked out from this script's own address (works one folder deep too)
  const BASE = ((document.currentScript && document.currentScript.src) || '').replace(/nl\/nl\.js.*$/, '');
  // put the small UI icon sprite into the page once, so <use href="#i-home"> works everywhere
  fetch(BASE + 'nl/icons/ui.svg').then(r => r.ok ? r.text() : '').then(t => {
    if (!t || document.getElementById('mt-sprite')) return;
    const d = document.createElement('div'); d.id = 'mt-sprite'; d.setAttribute('aria-hidden', 'true'); d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'; d.innerHTML = t; document.body.prepend(d);
  }).catch(() => {});
  const live = () => !!(N.supabaseUrl && N.anonKey);
  const base = () => (N.supabaseUrl || '').replace(/\/$/, '');
  const hdr = () => ({ apikey: N.anonKey, Authorization: 'Bearer ' + N.anonKey, 'Content-Type': 'application/json' });

  async function fn(name, body) {
    const r = await fetch(`${base()}/functions/v1/${name}`, { method: 'POST', headers: hdr(), body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || 'Something went wrong. Please try again.');
    return d;
  }
  async function rest(path, init = {}) {
    const r = await fetch(`${base()}/rest/v1/${path}`, { ...init, headers: { ...hdr(), Prefer: 'return=minimal', ...(init.headers || {}) } });
    if (!r.ok) { const t = await r.text(); const e = new Error(t); e.status = r.status; throw e; }
    const t = await r.text(); return t ? JSON.parse(t) : null;
  }

  // where did this reader come from? (?ref=tiktok, utm_source, or the page)
  function source(fallback) {
    const q = new URLSearchParams(location.search);
    const s = q.get('ref') || q.get('utm_source') || sessionStorage.getItem('mt.ref') || fallback || 'website';
    sessionStorage.setItem('mt.ref', s);
    return s.slice(0, 60);
  }

  const NL = {
    live, BASE,
    icon: (n, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`,
    pic: (n, alt = '') => `<img src="${BASE}nl/icons/${n}" alt="${alt}">`,
    subscribe: (email, first_name, src) => live() ? fn('subscribe', { email, first_name, source: source(src) }) : Promise.resolve({ ok: true, preview: true }),
    confirm: token => fn('confirm', { token }),
    unsubscribe: token => fn('unsubscribe', { token }),
    async activePoll() {
      if (!live()) return { id: 'preview', question: 'Pick the next trope 𖹭', options: N.tropes || [] };
      const rows = await rest('polls?is_active=eq.true&select=id,question,options&order=created_at.desc&limit=1', { headers: { Prefer: '' } });
      return rows && rows[0];
    },
    async results(pollId) {
      if (!live()) return JSON.parse(localStorage.getItem('mt.pollPreview') || '{}');
      const rows = await rest('rpc/poll_results', { method: 'POST', body: JSON.stringify({ p: pollId }), headers: { Prefer: '' } });
      return Object.fromEntries(rows.map(r => [r.option_index, Number(r.votes)]));
    },
    async vote(pollId, i) {
      let key = localStorage.getItem('mt.voter');
      if (!key) { key = crypto.randomUUID(); localStorage.setItem('mt.voter', key); }
      if (!live()) { const p = JSON.parse(localStorage.getItem('mt.pollPreview') || '{}'); p[i] = (p[i] || 0) + 1; localStorage.setItem('mt.pollPreview', JSON.stringify(p)); return; }
      try { await rest('poll_votes', { method: 'POST', body: JSON.stringify({ poll_id: pollId, option_index: i, voter_key: key }) }); }
      catch (e) { if (e.status !== 409) throw e; }      // already voted from this browser: that's fine
    },
    ask: (question, name, issue_ref) => live() ? rest('ama_questions', { method: 'POST', body: JSON.stringify({ question, name: name || null, issue_ref: issue_ref || null }) }) : Promise.resolve(),
    // self-serve swaps: authors create, load, edit and remove their own entry
    swap: (row, code) => live() ? fn('swap', { action: 'create', row, code: code || undefined }) : Promise.resolve({ ok: true, approved: !!code, preview: true }),
    swapGet: token => live() ? fn('swap', { action: 'get', token }) : Promise.resolve({ ok: true, preview: true, locked: false, swap: { month: new Date().toISOString().slice(0, 7), author_name: 'Jo Rivera', email: 'jo@example.com', book_title: 'Love, Set, Match', trope: 'fake dating', heat: 'steamy', blurb: 'A fake engagement at Wimbledon. What could go wrong?', where_to_buy: 'https://example.com', status: 'approved', invited: true } }),
    swapUpdate: (token, row) => live() ? fn('swap', { action: 'update', token, row }) : Promise.resolve({ ok: true }),
    swapDelete: token => live() ? fn('swap', { action: 'delete', token }) : Promise.resolve({ ok: true }),
    async readerCount() {
      if (!live()) return null;
      try { return Number(await rest('rpc/reader_count', { method: 'POST', body: '{}', headers: { Prefer: '' } })); } catch { return null; }
    },

    /* ---- calendar: works with Google, Apple, Outlook ---- */
    gcal({ title, date, details = '', allDay = true }) {
      const d = date.replaceAll('-', '');
      const next = new Date(date + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
      const dates = allDay ? `${d}/${next.toISOString().slice(0, 10).replaceAll('-', '')}` : date;
      return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${dates}&details=${encodeURIComponent(details)}`;
    },
    ics({ title, date, details = '', alarms = ['-P1D', 'PT9H'], uid }) {
      const d = date.replaceAll('-', '');
      const next = new Date(date + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
      const esc = s => String(s).replace(/[,;\\]/g, m => '\\' + m).replace(/\n/g, '\\n');
      const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
      const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mae Tao//EN', 'BEGIN:VEVENT', `UID:${uid || d + '-' + title.length}@maetao`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replaceAll('-', '')}`, `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(details)}`,
        ...alarms.flatMap(a => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, `TRIGGER:${a}`, 'END:VALARM']),
        'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      return URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
    },

    /* ---- little UI bits ---- */
    toast(msg) {
      let box = document.querySelector('.toasts');
      if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
      const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; box.appendChild(t);
      setTimeout(() => t.remove(), 3800);
    },
    petals(x = innerWidth / 2, y = innerHeight / 2, n = 14) {
      const set = ['𖹭', '𖹭', '•', '𖹭'];
      for (let i = 0; i < n; i++) {
        const p = document.createElement('span'); p.className = 'petal'; p.textContent = set[i % set.length];
        p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.color = ['#d98f97', '#f0c1c7', '#a9b8a8', '#c66a77'][i % 4];
        p.style.setProperty('--dx', (Math.random() * 260 - 130) + 'px'); p.style.setProperty('--dy', (-60 - Math.random() * 200) + 'px');
        p.style.setProperty('--rot', (Math.random() * 360) + 'deg');
        document.body.appendChild(p); setTimeout(() => p.remove(), 1700);
      }
    },
    busy(btn, on, label) {
      if (on) { btn.dataset.l = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
      else { btn.disabled = false; btn.innerHTML = label || btn.dataset.l; }
    },
    esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    unlockShelf() { try { localStorage.setItem('mt.unlocked', '1'); } catch { } },
    nextSendDay(from = new Date()) {
      const days = (N.sendDays || [1, 15]).slice().sort((a, b) => a - b);
      for (let m = 0; m < 3; m++) for (const d of days) {
        const dt = new Date(from.getFullYear(), from.getMonth() + m, d, N.sendHour || 9);
        if (dt > from) return dt;
      }
    },

    /* a poll widget anywhere: NL.mountPoll(element) */
    async mountPoll(el) {
      el.innerHTML = '<p class="muted">loading the poll…</p>';
      try {
        const poll = await NL.activePoll();
        if (!poll) { el.innerHTML = '<p class="muted">No poll right now 𖹭 check back next letter.</p>'; return; }
        const mineKey = 'mt.voted.' + poll.id;
        const draw = async (reveal) => {
          const res = reveal ? await NL.results(poll.id) : {};
          const total = Object.values(res).reduce((a, b) => a + b, 0);
          const mine = localStorage.getItem(mineKey);
          el.innerHTML = `<h3 class="h3">${NL.esc(poll.question)}</h3><div class="poll">${poll.options.map((o, i) => {
            const pct = total ? Math.round((res[i] || 0) / total * 100) : 0;
            return `<button class="popt ${mine == i ? 'mine' : ''}" data-i="${i}" ${reveal ? 'disabled' : ''} aria-label="${NL.esc(o)}${reveal ? ', ' + pct + ' percent' : ''}">
              <i class="fill" style="width:${reveal ? pct : 0}%"></i><span><b>${mine == i ? '<span class="heart">𖹭</span> ' : ''}${NL.esc(o)}</b>${reveal ? `<em>${pct}%</em>` : ''}</span></button>`;
          }).join('')}</div>${reveal ? `<p class="lab" style="margin-top:10px">${total} vote${total === 1 ? '' : 's'} so far · results update live</p>` : ''}`;
          if (reveal) { requestAnimationFrame(() => el.querySelectorAll('.fill').forEach(f => { const w = f.style.width; f.style.width = 0; requestAnimationFrame(() => f.style.width = w); })); }
          el.querySelectorAll('.popt:not([disabled])').forEach(b => b.onclick = async e => {
            const i = b.dataset.i; b.disabled = true;
            try { await NL.vote(poll.id, Number(i)); localStorage.setItem(mineKey, i); NL.petals(e.clientX, e.clientY, 10); NL.toast('vote saved 𖹭'); draw(true); }
            catch { b.disabled = false; NL.toast('couldn’t save that vote, try again?'); }
          });
        };
        const pre = new URLSearchParams(location.search).get('vote');
        if (pre !== null && !localStorage.getItem(mineKey) && poll.options[pre] !== undefined) {
          await NL.vote(poll.id, Number(pre)); localStorage.setItem(mineKey, pre); NL.toast('your vote from the email is in 𖹭');
        }
        await draw(!!localStorage.getItem(mineKey));
        if (localStorage.getItem(mineKey)) setInterval(() => document.visibilityState === 'visible' && draw(true), 20000);
      } catch { el.innerHTML = '<p class="muted">The poll is napping. Try again soon 𖹭</p>'; }
    }
  };
  window.NL = NL;
})();
