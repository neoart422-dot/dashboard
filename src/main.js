import "./style.css";
import { auth, isCloud, todos, ideas, events, naver } from "./store.js";
import { parseICS, occursOn, dayKey, pad } from "./ics.js";

const $ = (id) => document.getElementById(id);
const esc = (s = "") => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const today = () => dayKey(new Date());

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3000);
}
// 비동기 핸들러 공통 에러 처리
const safe = (fn) => async (...a) => { try { await fn(...a); } catch (e) { console.error(e); toast("오류: " + (e.message || e)); } };

/* ---------- 인사 ---------- */
function renderHeader() {
  const now = new Date(), h = now.getHours();
  $("greet").textContent = h < 6 ? "늦은 밤이에요 🌙" : h < 12 ? "좋은 아침이에요 ☀️" : h < 18 ? "좋은 오후예요 🌤️" : "좋은 저녁이에요 🌆";
  $("today").textContent = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${WEEK[now.getDay()]}요일`;
}

/* ---------- 할 일 ---------- */
async function renderTodos() {
  const [list, left] = await Promise.all([todos.list(today()), todos.leftovers(today())]);
  const done = list.filter((t) => t.done).length;
  $("todoCount").textContent = list.length ? `${done} / ${list.length} 완료` : "";
  $("todoBar").style.width = list.length ? `${(done / list.length) * 100}%` : "0";
  $("todoList").innerHTML = list.length
    ? list.map((t) => `
      <li class="todo ${t.done ? "done" : ""}" data-id="${t.id}">
        <input type="checkbox" ${t.done ? "checked" : ""} />
        <span class="t">${esc(t.text)}</span>
        <button class="x" title="삭제">✕</button>
      </li>`).join("")
    : `<li class="empty">오늘 할 일을 추가해 보세요</li>`;
  $("todoCarry").innerHTML = left.length
    ? `지난 날 미완료 ${left.length}개 · <button class="ghost" id="carryBtn">오늘로 가져오기</button>` : "";
  if (left.length) $("carryBtn").onclick = safe(async () => { await todos.carryOver(today()); await renderTodos(); });
}
$("todoForm").onsubmit = safe(async (e) => {
  e.preventDefault();
  const text = $("todoInput").value.trim();
  if (!text) return;
  $("todoInput").value = "";
  await todos.add(today(), text);
  await renderTodos();
});
$("todoList").onclick = safe(async (e) => {
  const li = e.target.closest("li[data-id]");
  if (!li) return;
  if (e.target.type === "checkbox") await todos.update(li.dataset.id, { done: e.target.checked });
  else if (e.target.classList.contains("x")) await todos.remove(li.dataset.id);
  else return;
  await renderTodos();
});

/* ---------- 캘린더 ---------- */
let naverEvents = [];
let naverSyncedAt = null;
let naverSource = "";

function range() {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from); to.setDate(from.getDate() + 7);
  return { from, to };
}
const fmtTime = (ev) => {
  if (ev.all_day) return "종일";
  const d = new Date(ev.starts_at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

async function syncNaver() {
  const { from, to } = range();
  if (isCloud) {
    try {
      const r = await naver.fetchLive(from.toISOString(), to.toISOString());
      naverEvents = r.events; naverSyncedAt = r.syncedAt; naverSource = "live";
      return;
    } catch (e) {
      console.warn("네이버 실시간 동기화 실패, .ics 캐시 사용", e);
    }
  }
  const c = naver.cached();
  naverEvents = c.events; naverSyncedAt = c.syncedAt; naverSource = c.syncedAt ? "ics" : "";
}

async function renderCal() {
  const { from, to } = range();
  const mine = await events.list(from.toISOString(), to.toISOString());
  let html = "";
  for (let i = 0; i < 7; i++) {
    const day = new Date(from); day.setDate(from.getDate() + i);
    const evs = [
      ...naverEvents.filter((e) => occursOn(e, day)),
      ...mine.filter((e) => dayKey(new Date(e.starts_at)) === dayKey(day)).map((e) => ({ ...e, mine: true })),
    ].sort((a, b) => (a.all_day === b.all_day ? fmtTime(a).localeCompare(fmtTime(b)) : a.all_day ? -1 : 1));
    if (!evs.length && i > 0) continue;
    const label = i === 0 ? "오늘" : i === 1 ? "내일" : `${day.getMonth() + 1}/${day.getDate()} (${WEEK[day.getDay()]})`;
    html += `<div class="day-label">${label}</div>`;
    html += evs.length
      ? evs.map((e) => `
        <div class="ev ${e.mine ? "mine" : ""}" ${e.mine ? `data-id="${e.id}"` : ""}>
          <div class="time">${fmtTime(e)}</div>
          <div class="info">${esc(e.title || "(제목 없음)")}${e.location ? `<div class="loc">📍 ${esc(e.location)}</div>` : ""}</div>
          ${e.mine ? `<button class="x" title="삭제">✕</button>` : ""}
        </div>`).join("")
      : `<div class="empty">오늘 일정이 없어요</div>`;
  }
  $("calList").innerHTML = html;
  const when = naverSyncedAt ? new Date(naverSyncedAt).toLocaleString("ko-KR") : "";
  $("calSync").textContent =
    naverSource === "live" ? `네이버 캘린더 실시간 연결됨 · ${when}`
    : naverSource === "ics" ? `.ics 파일에서 불러옴 (${naverEvents.length}개) · ${when}`
    : isCloud ? "네이버 캘린더 연결 전이에요 (README의 ‘네이버 캘린더 연결’ 참고). 임시로 .ics 파일도 불러올 수 있어요."
    : "로컬 모드: 네이버 캘린더 → 환경설정 → 내보내기로 받은 .ics 파일을 불러오세요.";
}
$("syncBtn").onclick = safe(async () => { await syncNaver(); await renderCal(); toast("동기화했어요"); });
$("icsBtn").onclick = () => $("icsFile").click();
$("icsFile").onchange = safe(async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const cutoff = Date.now() - 30 * 86400000;
  const evs = parseICS(await f.text()).filter((ev) => ev.rrule || new Date(ev.starts_at).getTime() >= cutoff);
  naver.saveCache({ events: evs, syncedAt: Date.now() });
  e.target.value = "";
  naverEvents = evs; naverSyncedAt = Date.now(); naverSource = "ics";
  await renderCal();
  toast(`일정 ${evs.length}개를 불러왔어요`);
});
$("evForm").onsubmit = safe(async (e) => {
  e.preventDefault();
  const title = $("evTitle").value.trim();
  if (!title) return;
  const t = $("evTime").value, d = new Date();
  if (t) { const [h, m] = t.split(":"); d.setHours(+h, +m, 0, 0); } else d.setHours(0, 0, 0, 0);
  $("evTitle").value = ""; $("evTime").value = "";
  await events.add({ title, starts_at: d.toISOString(), all_day: !t });
  await renderCal();
});
$("calList").onclick = safe(async (e) => {
  if (!e.target.classList.contains("x")) return;
  await events.remove(e.target.closest("[data-id]").dataset.id);
  await renderCal();
});

/* ---------- 아이디어 ---------- */
let ideaCache = [];
function drawIdeas() {
  const q = $("ideaSearch").value.trim().toLowerCase();
  const shown = ideaCache.filter((i) => !q || i.text.toLowerCase().includes(q));
  $("ideaCount").textContent = ideaCache.length ? `${ideaCache.length}개` : "";
  $("ideaList").innerHTML = shown.length
    ? shown.map((i) => `
      <div class="idea" data-id="${i.id}" title="더블클릭해서 수정">
        <div class="body">${esc(i.text)}</div>
        <div class="meta">${new Date(i.created_at).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
        <button class="x" title="삭제">✕</button>
      </div>`).join("")
    : `<div class="empty" style="grid-column:1/-1">${q ? "검색 결과가 없어요" : "첫 아이디어를 적어보세요"}</div>`;
}
async function renderIdeas() { ideaCache = await ideas.list(); drawIdeas(); }
const addIdea = safe(async () => {
  const text = $("ideaInput").value.trim();
  if (!text) return;
  $("ideaInput").value = "";
  await ideas.add(text);
  await renderIdeas();
});
$("ideaForm").onsubmit = (e) => { e.preventDefault(); addIdea(); };
$("ideaInput").onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addIdea(); } };
$("ideaSearch").oninput = drawIdeas;
$("ideaSearch").onkeydown = (e) => { if (e.key === "Enter") e.preventDefault(); };
$("ideaList").onclick = safe(async (e) => {
  if (!e.target.classList.contains("x")) return;
  if (!confirm("이 아이디어를 삭제할까요?")) return;
  await ideas.remove(e.target.closest("[data-id]").dataset.id);
  await renderIdeas();
});
$("ideaList").ondblclick = (e) => {
  const body = e.target.closest(".idea")?.querySelector(".body");
  if (!body || body.isContentEditable) return;
  const id = body.parentElement.dataset.id;
  body.contentEditable = "true"; body.focus();
  body.onblur = safe(async () => {
    body.contentEditable = "false";
    const text = body.innerText.trim();
    if (text) await ideas.update(id, text);
    await renderIdeas();
  });
};

/* ---------- 로그인 & 시작 ---------- */
$("loginForm").onsubmit = safe(async (e) => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true;
  try {
    await auth.sendLink($("loginEmail").value.trim());
    $("loginMsg").textContent = "메일함을 확인하세요. 링크를 누르면 바로 로그인돼요.";
  } finally { btn.disabled = false; }
});
$("logout").onclick = safe(async () => { await auth.signOut(); location.reload(); });

let started = false;
async function start() {
  if (started) return;
  started = true;
  $("login").hidden = true; $("app").hidden = false;
  $("mode").textContent = isCloud ? "☁️ Supabase" : "💾 로컬 모드";
  $("logout").hidden = !isCloud;
  $("syncBtn").hidden = !isCloud;
  renderHeader();
  await syncNaver();
  await Promise.all([renderTodos(), renderCal(), renderIdeas()]);
  let lastDay = today();
  setInterval(safe(async () => {
    renderHeader();
    if (today() !== lastDay) { lastDay = today(); await Promise.all([renderTodos(), renderCal()]); }
  }), 60000);
}

(async () => {
  const s = await auth.session();
  if (s) return start().catch((e) => toast("오류: " + e.message));
  $("login").hidden = false;
  auth.onChange((session) => { if (session) start().catch((e) => toast("오류: " + e.message)); });
})();
