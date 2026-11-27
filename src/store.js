// 데이터 저장소: Supabase 설정이 있으면 Supabase, 없으면 브라우저 localStorage(로컬 모드)
import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = URL && KEY ? createClient(URL, KEY) : null;
export const isCloud = !!supabase;

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

function check({ data, error }) {
  if (error) throw error;
  return data;
}

/* ---------------- 인증 ---------------- */
export const auth = {
  async session() {
    if (!isCloud) return { local: true };
    return (await supabase.auth.getSession()).data.session;
  },
  onChange(cb) {
    if (isCloud) supabase.auth.onAuthStateChange((_e, s) => cb(s));
  },
  async sendLink(email) {
    const redirect = location.origin + location.pathname;
    check(await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } }));
  },
  async signOut() {
    if (isCloud) await supabase.auth.signOut();
  },
};

/* ---------------- 할 일 ---------------- */
export const todos = isCloud
  ? {
      async list(day) {
        return check(await supabase.from("todos").select("*").eq("day", day).order("created_at"));
      },
      async leftovers(day) {
        return check(await supabase.from("todos").select("id").lt("day", day).eq("done", false));
      },
      async carryOver(day) {
        check(await supabase.from("todos").update({ day }).lt("day", day).eq("done", false));
      },
      async add(day, text) {
        check(await supabase.from("todos").insert({ day, text }));
      },
      async update(id, patch) {
        check(await supabase.from("todos").update(patch).eq("id", id));
      },
      async remove(id) {
        check(await supabase.from("todos").delete().eq("id", id));
      },
    }
  : {
      _all: () => load("dash.todos.v2", []),
      _save: (v) => save("dash.todos.v2", v),
      async list(day) { return this._all().filter((t) => t.day === day); },
      async leftovers(day) { return this._all().filter((t) => t.day < day && !t.done); },
      async carryOver(day) { this._save(this._all().map((t) => (t.day < day && !t.done ? { ...t, day } : t))); },
      async add(day, text) { this._save([...this._all(), { id: uid(), day, text, done: false, created_at: new Date().toISOString() }]); },
      async update(id, patch) { this._save(this._all().map((t) => (t.id === id ? { ...t, ...patch } : t))); },
      async remove(id) { this._save(this._all().filter((t) => t.id !== id)); },
    };

/* ---------------- 아이디어 ---------------- */
export const ideas = isCloud
  ? {
      async list() {
        return check(await supabase.from("ideas").select("*").order("created_at", { ascending: false }));
      },
      async add(text) { check(await supabase.from("ideas").insert({ text })); },
      async update(id, text) { check(await supabase.from("ideas").update({ text, updated_at: new Date().toISOString() }).eq("id", id)); },
      async remove(id) { check(await supabase.from("ideas").delete().eq("id", id)); },
    }
  : {
      _all: () => load("dash.ideas.v2", []),
      _save: (v) => save("dash.ideas.v2", v),
      async list() { return this._all(); },
      async add(text) { this._save([{ id: uid(), text, created_at: new Date().toISOString() }, ...this._all()]); },
      async update(id, text) { this._save(this._all().map((i) => (i.id === id ? { ...i, text } : i))); },
      async remove(id) { this._save(this._all().filter((i) => i.id !== id)); },
    };

/* ---------------- 직접 추가한 일정 ---------------- */
export const events = isCloud
  ? {
      async list(fromISO, toISO) {
        return check(await supabase.from("events").select("*").gte("starts_at", fromISO).lt("starts_at", toISO).order("starts_at"));
      },
      async add(ev) { check(await supabase.from("events").insert(ev)); },
      async remove(id) { check(await supabase.from("events").delete().eq("id", id)); },
    }
  : {
      _all: () => load("dash.events.v2", []),
      _save: (v) => save("dash.events.v2", v),
      async list(fromISO, toISO) { return this._all().filter((e) => e.starts_at >= fromISO && e.starts_at < toISO); },
      async add(ev) { this._save([...this._all(), { id: uid(), ...ev }]); },
      async remove(id) { this._save(this._all().filter((e) => e.id !== id)); },
    };

/* ---------------- 네이버 캘린더 ---------------- */
// 클라우드 모드: Supabase Edge Function(naver-calendar)이 CalDAV로 실시간 조회
// 로컬 모드 / 함수 미설정: .ics 파일 불러오기 결과를 브라우저에 보관
export const naver = {
  async fetchLive(fromISO, toISO) {
    if (!isCloud) return null;
    const { data, error } = await supabase.functions.invoke("naver-calendar", { body: { from: fromISO, to: toISO } });
    if (error) throw error;
    return data; // { events: [...], syncedAt }
  },
  cached: () => load("dash.naverIcs", { events: [], syncedAt: null }),
  saveCache: (v) => save("dash.naverIcs", v),
};
