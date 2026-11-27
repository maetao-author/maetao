// A private, always-up-to-date calendar of your newsletter life.
// Subscribe to it ONCE in Google Calendar / Apple Calendar:
//   https://YOUR-PROJECT.supabase.co/functions/v1/calendar-feed?key=YOUR_CALENDAR_KEY
// It includes: newsletter send days (+ "draft due" reminders), scheduled & sent issues,
// author swaps, swap partners' release days, your book release, and reminders you add in /admin.
import { cfg, db } from '../_shared/util.ts';

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
const day = (s: string) => s.replaceAll('-', '').slice(0, 8);
const nextDay = (s: string) => { const d = new Date(s.slice(0, 10) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replaceAll('-', ''); };
const txt = (s: string) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const fold = (l: string) => l.length <= 74 ? l : l.match(/.{1,74}/g)!.join('\r\n ');

type Ev = { uid: string; title: string; date?: string; at?: string; desc?: string; alarms?: string[]; url?: string };
function vevent(e: Ev) {
  const lines = ['BEGIN:VEVENT', `UID:${e.uid}@mae-newsletter`, `DTSTAMP:${stamp(new Date())}`];
  if (e.at) { const d = new Date(e.at); lines.push(`DTSTART:${stamp(d)}`, `DTEND:${stamp(new Date(d.getTime() + 30 * 60000))}`); }
  else { lines.push(`DTSTART;VALUE=DATE:${day(e.date!)}`, `DTEND;VALUE=DATE:${nextDay(e.date!)}`); }
  lines.push(`SUMMARY:${txt(e.title)}`);
  if (e.desc) lines.push(`DESCRIPTION:${txt(e.desc)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  for (const a of e.alarms || []) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${txt(e.title)}`, `TRIGGER:${a}`, 'END:VALARM');
  lines.push('END:VEVENT');
  return lines.map(fold).join('\r\n');
}

Deno.serve(async (req) => {
  const key = new URL(req.url).searchParams.get('key') || '';
  if (!cfg.calendarKey || key !== cfg.calendarKey) return new Response('not found', { status: 404 });

  const [issues, swaps, reminders] = await Promise.all([
    db('issues?select=id,subject,status,scheduled_for,sent_at&order=created_at.desc&limit=200'),
    db('swaps?status=in.(approved,scheduled,sent)&select=id,month,author_name,book_title,release_date,status,reciprocal_sent&limit=300'),
    db('reminders?done=is.false&select=*&limit=300'),
  ]);
  const admin = `${cfg.site}/admin/`;
  const ev: Ev[] = [];

  // newsletter rhythm: the next 12 send days, with a "draft due" nudge 3 days before
  const days = cfg.sendDays.split(',').map(Number).filter(Boolean);
  const now = new Date();
  for (let m = 0; m < 6; m++) for (const d of days) {
    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m, d));
    if (dt < new Date(now.getTime() - 86400000)) continue;
    const iso = dt.toISOString().slice(0, 10);
    const due = new Date(dt.getTime() - 3 * 86400000).toISOString().slice(0, 10);
    ev.push({ uid: `send-${iso}`, title: 'newsletter day', date: iso, desc: 'Letter goes out today', url: admin, alarms: ['-PT15H'] });
    ev.push({ uid: `draft-${iso}`, title: 'newsletter draft due', date: due, desc: `Draft for ${iso}. Open the composer.`, url: admin, alarms: ['PT9H'] });
  }
  for (const i of issues) {
    const when = i.sent_at || i.scheduled_for; if (!when) continue;
    ev.push({ uid: `issue-${i.id}`, at: when, url: admin,
      title: `${i.status === 'sent' ? 'sent' : 'scheduled'}: ${i.subject || 'untitled letter'}`,
      alarms: i.status === 'sent' ? [] : ['-P1D', '-PT2H'] });
  }
  for (const s of swaps) {
    ev.push({ uid: `swap-${s.id}`, date: `${s.month}-01`, url: admin, title: `swap: ${s.book_title} by ${s.author_name}`,
      desc: s.reciprocal_sent ? 'They featured you back' : 'Remember to check they feature you back.', alarms: ['-P2D'] });
    if (s.release_date) ev.push({ uid: `swaprel-${s.id}`, date: s.release_date, title: `${s.author_name}'s ${s.book_title} is out · share it!`, alarms: ['PT9H'] });
  }
  for (const r of reminders) ev.push({ uid: `rem-${r.id}`, at: r.due_at, title: r.title, alarms: ['-P1D', '-PT1H'], url: admin });
  if (cfg.release) ev.push({ uid: `release-${cfg.release}`, date: cfg.release, title: 'Call It a Let release day!', alarms: ['-P7D', '-P1D', 'PT8H'] });

  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mae Tao//Newsletter//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Mae newsletter', 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    ...ev.map(vevent), 'END:VCALENDAR'].join('\r\n');
  return new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' } });
});
