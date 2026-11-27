// 아주 가벼운 iCalendar(.ics) 파서 + 반복 일정 판정
export const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function parseICSDate(val, params = "") {
  const m = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h || /VALUE=DATE(?!-)/.test(params)) return { date: new Date(+y, mo - 1, +d), allDay: true };
  const date = z ? new Date(Date.UTC(+y, mo - 1, +d, +h, +mi, +s)) : new Date(+y, mo - 1, +d, +h, +mi, +s);
  return { date, allDay: false };
}

export function parseICS(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out = [];
  let cur = null;
  const unesc = (v) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") { if (cur?.starts_at) out.push(cur); cur = null; }
    else if (cur) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const [name, ...p] = line.slice(0, i).split(";");
      const params = p.join(";"), val = line.slice(i + 1);
      if (name === "SUMMARY") cur.title = unesc(val);
      else if (name === "LOCATION") cur.location = unesc(val);
      else if (name === "DTSTART") {
        const r = parseICSDate(val, params);
        if (r) { cur.starts_at = r.date.toISOString(); cur.all_day = r.allDay; }
      } else if (name === "RRULE") cur.rrule = val;
    }
  }
  return out;
}

// 반복 일정(기본 DAILY/WEEKLY/MONTHLY/YEARLY)이 해당 날짜에 있는지
export function occursOn(ev, day) {
  const s = new Date(ev.starts_at);
  const sd = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  if (!ev.rrule) return dayKey(sd) === dayKey(day);
  if (day < sd) return false;
  const r = Object.fromEntries(ev.rrule.split(";").map((kv) => kv.split("=")));
  if (r.UNTIL) { const u = parseICSDate(r.UNTIL); if (u && day > u.date) return false; }
  const iv = +(r.INTERVAL || 1);
  const diff = Math.round((day - sd) / 86400000);
  switch (r.FREQ) {
    case "DAILY": return diff % iv === 0;
    case "WEEKLY": {
      const map = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
      const days = r.BYDAY ? r.BYDAY.split(",").map((d) => map[d.slice(-2)]) : [sd.getDay()];
      return days.includes(day.getDay()) && Math.floor((diff + sd.getDay()) / 7) % iv === 0;
    }
    case "MONTHLY": {
      const months = (day.getFullYear() - sd.getFullYear()) * 12 + day.getMonth() - sd.getMonth();
      return day.getDate() === sd.getDate() && months % iv === 0;
    }
    case "YEARLY": return day.getDate() === sd.getDate() && day.getMonth() === sd.getMonth();
    default: return false;
  }
}
