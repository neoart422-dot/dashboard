// 네이버 캘린더 CalDAV → 대시보드 일정 JSON
// 필요한 시크릿 (supabase secrets set ...):
//   NAVER_ID            네이버 아이디 (예: myid)
//   NAVER_APP_PASSWORD  네이버 '애플리케이션 비밀번호' (일반 비밀번호 아님)
//   OWNER_EMAIL         (선택) 이 이메일로 로그인한 사용자만 호출 허용
import { createClient } from "npm:@supabase/supabase-js@2";

const CALDAV = "https://caldav.calendar.naver.com";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // 1) 로그인한 소유자인지 확인
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);
  const owner = Deno.env.get("OWNER_EMAIL");
  if (owner && user.email?.toLowerCase() !== owner.toLowerCase()) return json({ error: "forbidden" }, 403);

  const id = Deno.env.get("NAVER_ID");
  const pw = Deno.env.get("NAVER_APP_PASSWORD");
  if (!id || !pw) return json({ error: "NAVER_ID / NAVER_APP_PASSWORD 시크릿이 설정되지 않았어요" }, 500);

  const { from, to } = await req.json().catch(() => ({}));
  const start = from ? new Date(from) : new Date();
  const end = to ? new Date(to) : new Date(start.getTime() + 7 * 86400000);

  try {
    const dav = makeDav(id, pw);
    const calendars = await discoverCalendars(dav);
    const results = await Promise.all(calendars.map((href) => queryEvents(dav, href, start, end)));
    return json({ events: results.flat(), calendars: calendars.length, syncedAt: Date.now() });
  } catch (e) {
    console.error(e);
    return json({ error: String(e?.message ?? e) }, 502);
  }
});

/* ---------------- CalDAV ---------------- */
type Dav = (method: string, path: string, body: string, depth?: string) => Promise<string>;

function makeDav(id: string, pw: string): Dav {
  const authz = "Basic " + btoa(unescape(encodeURIComponent(`${id}:${pw}`)));
  return async (method, path, body, depth = "0") => {
    const url = path.startsWith("http") ? path : CALDAV + path;
    const res = await fetch(url, {
      method,
      headers: { Authorization: authz, Depth: depth, "Content-Type": "application/xml; charset=utf-8" },
      body,
    });
    if (res.status === 401) throw new Error("네이버 인증 실패: 아이디/애플리케이션 비밀번호를 확인하세요");
    if (!res.ok && res.status !== 207) throw new Error(`CalDAV ${method} ${path} → ${res.status}`);
    return await res.text();
  };
}

const tag = (name: string) => new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "i");
const tagAll = (name: string) => new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "gi");
const firstHref = (xml: string) => xml.match(tag("href"))?.[1]?.trim();

async function discoverCalendars(dav: Dav): Promise<string[]> {
  const principalXml = await dav("PROPFIND", "/", `<?xml version="1.0"?>
    <d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`);
  const principal = firstHref(principalXml.match(tag("current-user-principal"))?.[1] ?? "");
  if (!principal) throw new Error("CalDAV principal을 찾지 못했어요");

  const homeXml = await dav("PROPFIND", principal, `<?xml version="1.0"?>
    <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`);
  const home = firstHref(homeXml.match(tag("calendar-home-set"))?.[1] ?? "");
  if (!home) throw new Error("calendar-home-set을 찾지 못했어요");

  const listXml = await dav("PROPFIND", home, `<?xml version="1.0"?>
    <d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>`, "1");
  const out: string[] = [];
  for (const m of listXml.matchAll(tagAll("response"))) {
    const block = m[1];
    if (/<(?:[\w-]+:)?calendar\b/i.test(block.match(tag("resourcetype"))?.[1] ?? "")) {
      const href = firstHref(block);
      if (href) out.push(href);
    }
  }
  return out;
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

async function queryEvents(dav: Dav, href: string, start: Date, end: Date) {
  const xml = await dav("REPORT", href, `<?xml version="1.0"?>
    <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
      <d:prop><c:calendar-data/></d:prop>
      <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">
        <c:time-range start="${utc(start)}" end="${utc(end)}"/>
      </c:comp-filter></c:comp-filter></c:filter>
    </c:calendar-query>`, "1");
  const events = [];
  for (const m of xml.matchAll(tagAll("calendar-data"))) events.push(...parseICS(decodeXml(m[1])));
  return events;
}

function decodeXml(s: string) {
  return s.replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#13;|&#xD;/gi, "\r").replace(/&#10;|&#xA;/gi, "\n").replace(/&amp;/g, "&");
}

/* ---------------- iCalendar ---------------- */
// 네이버 캘린더는 한국 시간 기준이므로 TZID가 붙은/시간대 없는 시각은 KST(+09:00)로 처리
function toISO(val: string, params: string): { iso: string; allDay: boolean } | null {
  const m = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h || /VALUE=DATE(?!-)/.test(params)) return { iso: `${y}-${mo}-${d}T00:00:00+09:00`, allDay: true };
  return { iso: `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? "Z" : "+09:00"}`, allDay: false };
}

function parseICS(text: string) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const out: Record<string, unknown>[] = [];
  let cur: Record<string, unknown> | null = null;
  const unesc = (v: string) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") { if (cur?.starts_at && !cur.recurrenceId) out.push(cur); cur = null; }
    else if (cur) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const [name, ...p] = line.slice(0, i).split(";");
      const params = p.join(";"), val = line.slice(i + 1);
      if (name === "SUMMARY") cur.title = unesc(val);
      else if (name === "LOCATION") cur.location = unesc(val);
      else if (name === "RRULE") cur.rrule = val;
      else if (name === "RECURRENCE-ID") cur.recurrenceId = val;
      else if (name === "DTSTART") {
        const r = toISO(val, params);
        if (r) { cur.starts_at = r.iso; cur.all_day = r.allDay; }
      }
    }
  }
  return out.map(({ recurrenceId: _, ...e }) => e);
}
