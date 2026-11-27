// ♡ One email template, used by BOTH the edge functions (real sends) and /admin (live preview).
// Plain JavaScript on purpose, so the browser and Supabase run the exact same code.
// Email clients ignore most modern CSS, so emails use inline styles and tables,
// with soft rounded cards in Mae's palette.

export const C = {
  cream: '#fbf5f0', paper: '#fffaf7', soft: '#f6ece8', blush: '#fbe3e2', pink: '#f0c1c7',
  rose: '#d98f97', deeprose: '#c66a77', sage: '#868a76', sageL: '#c7c8b9', sageXL: '#e6e7dc',
  cocoa: '#2f2427', ink: '#3a2b2f', ink2: '#7d6a6e', muted: '#9a8a8d'
};
const ROUND = "'Fredoka','Nunito','Quicksand','Arial Rounded MT Bold',Arial,sans-serif";
const BODY = "'Nunito','Helvetica Neue',Arial,sans-serif";
const SERIF = "'Instrument Serif',Georgia,'Times New Roman',serif";

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => /^(https?:|mailto:)/i.test(String(u || '').trim()) ? esc(String(u).trim()) : '';
const paras = t => esc(t).split(/\n{2,}/).map(p => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`).join('');

const pill = (href, label, bg = C.rose, fg = '#ffffff') => !safeUrl(href) ? '' :
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px"><tr><td style="border-radius:999px;background:${bg}">
   <a href="${safeUrl(href)}" style="display:inline-block;padding:12px 22px;font-family:${BODY};font-weight:800;font-size:14px;color:${fg};text-decoration:none;border-radius:999px">${esc(label)}</a></td></tr></table>`;

const card = (inner, bg = C.paper, fg = C.ink) =>
  `<tr><td style="padding:0 0 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border-radius:26px">
   <tr><td style="padding:24px 26px;font-family:${BODY};font-size:15.5px;line-height:1.6;color:${fg}">${inner}</td></tr></table></td></tr>`;

const sticker = (text, bg = C.pink, fg = '#5a3a41') =>
  `<span style="display:inline-block;background:${bg};color:${fg};border-radius:999px;padding:5px 14px;font-family:${SERIF};font-style:italic;font-size:16px">${esc(text)}</span>`;

const h = (t, color = C.ink, size = 26) => `<h2 style="margin:12px 0 8px;font-family:${ROUND};font-weight:700;font-size:${size}px;line-height:1.15;letter-spacing:-.01em;color:${color}">${esc(t)}</h2>`;

// ---- blocks Mae types into /admin ----------------------------------------
// every block: { type, ...fields }. Unknown types are skipped.
export function renderBlocks(blocks = [], ctx = {}) {
  const site = (ctx.siteUrl || '').replace(/\/$/, '');
  const out = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'letter':
        out.push(card(`${sticker(b.sticker || '✉ a little letter')}${b.title ? h(b.title) : ''}
          <div style="margin-top:10px">${paras(b.text)}</div>
          ${b.signoff ? `<p style="margin:4px 0 0;font-family:${SERIF};font-style:italic;font-size:20px;color:${C.deeprose}">${esc(b.signoff)}</p>` : ''}`));
        break;
      case 'news':
        out.push(card(`${sticker(b.sticker || '♡ news', C.sageXL, '#4f5342')}${h(b.title || '')}${paras(b.text)}${pill(b.link, b.button || 'take a look ♡', C.sage)}`, C.blush));
        break;
      case 'book':
        out.push(card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          ${b.cover ? `<td width="120" valign="top" style="padding-right:18px"><img src="${safeUrl(b.cover.startsWith('http') ? b.cover : site + '/' + b.cover)}" width="110" alt="${esc(b.title)} cover" style="display:block;border-radius:6px 14px 14px 6px;width:110px;height:auto"></td>` : ''}
          <td valign="top" style="font-family:${BODY};color:#fbeee9">${sticker(b.sticker || 'out now ♡', C.pink)}
          ${h(b.title || '', '#fff4f1', 24)}<div style="color:#d8c4c7">${paras(b.text)}</div>${pill(b.link, b.button || 'grab your copy', C.rose)}</td></tr></table>`, C.cocoa, '#fbeee9'));
        break;
      case 'swap': {
        const items = (b.items || []).map(s => `<tr><td style="padding:0 0 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper};border-radius:20px"><tr>
          ${s.cover_url ? `<td width="86" valign="top" style="padding:14px 0 14px 14px"><img src="${safeUrl(s.cover_url)}" width="72" alt="" style="display:block;border-radius:4px 10px 10px 4px;width:72px;height:auto"></td>` : ''}
          <td valign="top" style="padding:14px 16px;font-family:${BODY};font-size:14.5px;color:${C.ink}">
          <div style="font-family:${ROUND};font-weight:700;font-size:19px;line-height:1.2">${esc(s.book_title)}</div>
          <div style="color:${C.ink2};font-size:13px;margin:2px 0 6px">by ${esc(s.author_name)}${s.trope ? ' · ' + esc(s.trope) : ''}${s.release_date ? ' · out ' + esc(s.release_date) : ''}</div>
          ${s.blurb ? `<div style="margin-bottom:6px">${esc(s.blurb)}</div>` : ''}
          ${safeUrl(s.where_to_buy) ? `<a href="${safeUrl(s.where_to_buy)}" style="color:${C.deeprose};font-weight:800;text-decoration:none">find it here →</a>` : ''}
          </td></tr></table></td></tr>`).join('');
        if (items) out.push(card(`${sticker(b.sticker || '📚 book besties', C.sageXL, '#4f5342')}${h(b.title || 'books my friends wrote')}
          ${b.text ? paras(b.text) : ''}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items}</table>`, C.sageXL));
        break;
      }
      case 'poll': {
        const opts = (b.options || []).map((o, i) => `<tr><td style="padding:0 0 8px"><a href="${esc(site)}/newsletter/?vote=${i}#poll"
          style="display:block;background:${C.paper};border-radius:999px;padding:12px 18px;font-family:${BODY};font-weight:800;font-size:14.5px;color:${C.ink};text-decoration:none">♡ ${esc(o)}</a></td></tr>`).join('');
        out.push(card(`${sticker('tap to vote', C.paper)}${h(b.question || 'Pick the next trope')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">${opts}</table>`, C.blush));
        break;
      }
      case 'ama':
        out.push(card(`${sticker('ask me anything', C.pink)}${h(b.title || 'your turn ♡', '#fff4f1')}
          <div style="color:#d8c4c7">${paras(b.text || 'Hit the button and ask me anything: about the books, Avery and Stephen, writing, tennis. I might answer it in the next letter.')}</div>
          ${pill(`${site}/newsletter/?from=${encodeURIComponent(ctx.issueRef || 'email')}#ama`, 'ask me ♡', C.rose)}`, C.cocoa, '#fbeee9'));
        break;
      case 'answer':
        out.push(card(`${sticker('you asked ✉', C.sageXL, '#4f5342')}
          <p style="margin:12px 0 10px;font-family:${SERIF};font-style:italic;font-size:21px;line-height:1.3;color:${C.deeprose}">“${esc(b.question)}”</p>${paras(b.text)}`));
        break;
      case 'bonus':
        out.push(card(`${sticker('🔒 secret shelf', C.pink)}${h(b.title || 'a little extra')}${paras(b.text)}${pill(b.link || site + '/#bonus', b.button || 'open it ♡')}`, C.soft));
        break;
      case 'ps':
        out.push(`<tr><td style="padding:2px 12px 18px;font-family:${BODY};font-size:14.5px;color:${C.ink2}"><b style="font-family:${ROUND};color:${C.deeprose}">p.s.</b> ${esc(b.text)}</td></tr>`);
        break;
    }
  }
  return out.join('\n');
}

// ---- the frame: header, body, and the footer every email must have ---------
export function frame({ inner, preheader = '', siteUrl = '', unsubUrl = '{{UNSUB_URL}}', address = '', reason = "you joined Mae's newsletter" }) {
  const site = (siteUrl || '').replace(/\/$/, '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@600;700&family=Nunito:wght@400;700;800&family=Instrument+Serif:ital@1&display=swap" rel="stylesheet">
<title>${esc(preheader || 'letters from Mae')}</title></head>
<body style="margin:0;padding:0;background:${C.cream}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}&nbsp;&#8199;&#65279;&nbsp;&#8199;&#65279;&nbsp;&#8199;&#65279;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream}"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td align="center" style="padding:0 0 20px">
  ${site ? `<img src="${esc(site)}/email/logo.png" width="110" alt="" style="display:block;width:110px;height:auto;margin:0 auto 6px">` : ''}
  <div style="font-family:${ROUND};font-weight:700;font-size:30px;color:#e48a9c;letter-spacing:-.01em">mae tao</div>
  <div style="font-family:${SERIF};font-style:italic;font-size:17px;color:${C.ink2}">letters from the tennis court &amp; the writing desk</div>
</td></tr>
${inner}
<tr><td align="center" style="padding:18px 20px 6px;font-family:${BODY};font-size:12px;line-height:1.7;color:${C.muted}">
  <div style="font-family:${SERIF};font-style:italic;font-size:18px;color:${C.deeprose};margin-bottom:6px">with love, Mae ♡</div>
  You're getting this because ${esc(reason)}. Just hit reply to write back, I read everything.<br>
  <a href="${esc(unsubUrl)}" style="color:${C.ink2};font-weight:700">unsubscribe in one click</a>${site ? ` · <a href="${esc(site)}" style="color:${C.ink2};font-weight:700">visit the website</a>` : ''}<br>
  ${esc(address)}
</td></tr></table></td></tr></table></body></html>`;
}

// ---- system emails ----------------------------------------------------------
export function confirmEmail({ siteUrl, confirmUrl, firstName, address, magnetName }) {
  const inner = card(`${sticker('one tiny step ♡')}${h(`hi${firstName ? ' ' + firstName : ''}! is this you?`)}
    <p style="margin:0 0 14px">Tap the button to confirm you'd like letters from me. Then ${esc(magnetName)} is all yours.</p>
    ${pill(confirmUrl, 'yes, sign me up ♡')}
    <p style="margin:14px 0 0;color:${C.muted};font-size:13px">Didn't sign up? Ignore this email and you won't hear from me again.</p>`);
  return frame({ inner, preheader: `Confirm and get ${magnetName}`, siteUrl, unsubUrl: siteUrl, address, reason: 'someone entered this address on my website' });
}

export function welcomeEmail({ siteUrl, magnetUrl, magnetName, firstName, unsubUrl, address }) {
  const inner = card(`${sticker("you're in ♡")}${h(`welcome${firstName ? ', ' + firstName : ''}!`)}
      <p style="margin:0 0 14px">I'm so glad you're here. As promised, here's ${esc(magnetName)}, a little scene that only newsletter readers get.</p>
      ${pill(magnetUrl, 'read it now ♡')}`) +
    card(`${sticker('what to expect', C.sageXL, '#4f5342')}
      <p style="margin:12px 0 0">Two letters a month: book news, polls where you pick what I write next, answers to your questions, and books from my author friends. No spam, ever.</p>`, C.blush) +
    card(`${sticker('the secret shelf', C.pink)}${h('your key is waiting', '#fff4f1')}
      <div style="color:#d8c4c7"><p style="margin:0 0 14px">Deleted scenes, art and the playlist live on my website's secret shelf, and confirming just unlocked it.</p></div>
      ${pill(siteUrl + '/#bonus', 'open the shelf', C.rose)}`, C.cocoa, '#fbeee9');
  return frame({ inner, preheader: `Here's ${magnetName} ♡`, siteUrl, unsubUrl, address });
}
