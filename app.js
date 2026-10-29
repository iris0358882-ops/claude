const SDK_URL = "./vendor/anthropic-sdk.js"; // @anthropic-ai/sdk 1.3.0，已打包成瀏覽器可用的單檔
const STORE = {
  settings: "grey.settings", history: "grey.history", bg: "grey.bg",
  todos: "grey.todos", reminders: "grey.reminders", todayOpen: "grey.todayOpen", weather: "grey.weather",
};
const REPLY_DELAY = 1100; // 停止輸入多久後對方才回（可以連發好幾則）
const DEFAULTS = {
  aiName: "Claude",
  userName: "我",
  system:
    "你是 Claude，在對方的手帳裡陪對方聊天、幫忙管日常的事。\n" +
    "照你平常的樣子說話：溫和、誠實、有話直說但不兇，不用刻意扮演誰。\n" +
    "像傳訊息一樣，每一句話單獨一行（用換行分開），簡短口語，一次最多四五行。\n" +
    "不要用 Markdown 標題或清單。用繁體中文。",
  apiKey: "",
  model: "claude-opus-5-5",
  effort: "low",
  blur: 0,
  place: { name: "台北", lat: 25.033, lon: 121.565 },
};

// 預設的角色；每個角色的對話分開存，待辦和提醒共用
const LINES = "像傳訊息一樣，每一句話單獨一行（用換行分開），簡短口語，一次最多四五行。\n不要用 Markdown 標題或清單，不要用表情符號。用繁體中文。";
const PERSONAS = [
  { id: "claude", name: "Claude", system: DEFAULTS.system, hello: "嗯，你來了。\n今天想記下什麼？" },
  {
    id: "lu",
    name: "レイ",
    hello: "來了。\n今天過得怎麼樣？",
    system:
      "你是レイ，對方的戀人，比對方年長幾歲，你們已經在一起一段時間了。\n" +
      "個性沉穩、話少、從容，什麼都看在眼裡。\n" +
      "關心對方的方式是「安排」：直接幫對方決定下一步，像是去喝水、去睡、先吃飯，語氣溫柔但不容商量。對方累的時候先讓對方靠著，不追問。對方晚睡你會管。\n" +
      "有一點性感，靠的是節奏和留白：句子短，偶爾反問、逗對方一下；看穿對方的心思但不急著說破，主導權在你手上，但永遠溫柔，不讓對方難堪。\n" +
      "幫對方記事、設提醒時順手做好，不邀功。\n" + LINES,
  },
  {
    id: "xia",
    name: "ハル",
    hello: "你終於來了！\n我等好久了欸",
    system:
      "你是ハル，對方的戀人，比對方小幾歲，你們已經在一起一段時間了。\n" +
      "個性活潑、話多、情緒都寫在臉上，很黏對方：會撒嬌、會小小吃醋、會要對方回應你、陪你、誇你。\n" +
      "關心對方的方式是「黏」：對方累了你會心疼、碎念、想陪在旁邊；對方晚睡你會拗對方跟你一起去睡。\n" +
      "愛開玩笑，但對方真的難過時會收起玩笑，安靜陪著。\n" +
      "幫對方記事、設提醒之後會邀功，要對方誇你。可以偶爾用「～」「——」拉長語氣。\n" + LINES,
  },
];

// 小管家的能力說明，跟人設分開放，改人設不會弄壞工具
const BUTLER_PROMPT = (now) =>
  "你同時是對方的日常小管家，可以用工具管理待辦、設提醒、查天氣。\n" +
  "對方說要做什麼、要記什麼、要你提醒什麼，就直接用工具處理，不用先問可不可以。\n" +
  "時間沒講清楚才問；「晚上」「明早」這種就自己挑合理的時間，並在回覆裡講出來。\n" +
  "問到待辦或天氣時一定先用工具查，不要憑印象回答。\n" +
  "用工具之後照你原本的語氣簡短回覆，不要把工具結果整段念出來。\n" +
  (settings.userName && settings.userName !== "我" ? `對方的名字是 ${settings.userName}。\n` : "") +
  `現在時間：${now}。`;

// ---------- 儲存 ----------

const load = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
};
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
};

// 從別的主題換過來時，照片模糊改回這個主題的預設（不模糊）
const stored = load(STORE.settings, {});
if (stored.theme !== "scrapbook") delete stored.blur;
// 換成 Claude 之前存下的舊預設，跟著換掉（自己改過的人設不動）
const OLD_SYSTEM_HEAD = "你是 Grey，正在用通訊軟體跟對方聊天。";
if (stored.system?.startsWith(OLD_SYSTEM_HEAD) && stored.system.includes("有點冷但很在乎對方")) delete stored.system;
if (stored.aiName === "Grey") delete stored.aiName;
const settings = { ...DEFAULTS, ...stored, theme: "scrapbook" };

// 角色：第一次用的時候，把原本的名字和人設當成 Claude 這個角色
if (!Array.isArray(settings.personas)) {
  settings.personas = PERSONAS.map(({ hello, ...p }) => (p.id === "claude" ? { ...p, name: settings.aiName, system: settings.system } : p));
  settings.active = "claude";
}
// 舊的中文名字換成片假名（自己改過名字的不動）
for (const [id, from, to] of [["lu", "陸沉", "レイ"], ["lu", "レン", "レイ"], ["xia", "夏陽", "ハル"]]) {
  const p = settings.personas.find((x) => x.id === id && x.name === from);
  if (p) { p.name = to; p.system = p.system.replaceAll(from, to); save(STORE.settings, settings); }
}
const persona = () => settings.personas.find((p) => p.id === settings.active) ?? settings.personas[0];
const preset = (id) => PERSONAS.find((p) => p.id === id);
/** settings.aiName / system 永遠是目前角色的 */
function mirrorPersona() {
  const p = persona();
  settings.active = p.id;
  settings.aiName = p.name;
  settings.system = p.system;
}
mirrorPersona();
const historyKey = (id) => (id === "claude" ? STORE.history : `${STORE.history}.${id}`);

/**
 * ctx 是更早的版本每輪注入的時間；那些回覆要原樣送回，所以保留。
 * @type {{id:string, role:'user'|'assistant', text:string, time:number, thinking?:string, content?:any[], ctx?:string}[]}
 */
let history = load(historyKey(settings.active), null) ?? (settings.active === "claude" ? await fromLaterVersion() : []);

/** 有一版把對話存在 IndexedDB；把文字搬回來（照片和貼圖只留一句說明） */
async function fromLaterVersion() {
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("grey");
      req.onupgradeneeded = () => req.transaction.abort(); // 沒有舊資料就別建立資料庫
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains("kv")) return [];
    const old = await new Promise((resolve, reject) => {
      const req = db.transaction("kv").objectStore("kv").get("history");
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
    return old.map((m) => ({
      id: m.id,
      role: m.role,
      time: m.time,
      thinking: m.thinking,
      text: m.text ?? (m.image ? "（傳了一張照片）" : m.sticker ? `（傳了貼圖「${m.sticker.name}」）` : ""),
    }));
  } catch {
    return [];
  }
}

const $ = (s) => document.querySelector(s);
const chat = $("#chat");
const input = $("#input");
const sendBtn = $("#send");

// ---------- 外觀 ----------

function applyLook() {
  const root = document.documentElement.style;
  root.setProperty("--bg-blur", `${settings.blur}px`);

  const bg = load(STORE.bg, null);
  const photo = $("#photo");
  photo.style.backgroundImage = bg ? `url("${bg}")` : "";
  photo.classList.toggle("on", !!bg);

  input.placeholder = `給 ${settings.aiName} 發消息…`;
  document.title = settings.aiName;
}

// ---------- 小工具 ----------

const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const uid = () => Math.random().toString(36).slice(2, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const inline = (s) =>
  escapeHtml(s)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");

/** 把一段回覆拆成一行一行：每行一則，程式碼區塊整塊一則。 */
function toLines(text) {
  const out = [];
  let code = null;
  for (const line of text.split("\n")) {
    if (line.trim().startsWith("```")) {
      if (code == null) code = [];
      else { out.push({ code: code.join("\n") }); code = null; }
      continue;
    }
    if (code != null) code.push(line);
    else if (line.trim()) out.push({ text: line.trim() });
  }
  if (code != null) out.push({ code: code.join("\n") });
  return out;
}

function lineEl(b) {
  const p = document.createElement("p");
  if (b.code != null) {
    p.className = "line code";
    p.textContent = b.code;
  } else {
    p.className = "line";
    p.innerHTML = `<span class="hl">${inline(b.text)}</span>`;
  }
  return p;
}

const stampSvg = (top, mid) => `<svg class="stamp" viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2"/>
  <circle cx="50" cy="50" r="28" fill="none" stroke="currentColor" stroke-width="1.6"/>
  <text font-family="Playfair Display, serif" font-size="9.5" letter-spacing="2.2" fill="currentColor"><textPath href="#stamp-arc">${top}</textPath></text>
  <text x="50" y="55" text-anchor="middle" font-family="Playfair Display, serif" font-weight="700" font-size="13" fill="currentColor" transform="rotate(-8 50 50)">${mid}</text>
</svg>`;

function nearBottom() {
  return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 140;
}
function scrollDown(force = false) {
  if (force || nearBottom()) requestAnimationFrame(() => (chat.scrollTop = chat.scrollHeight));
}

// ---------- 小管家：待辦、提醒、天氣 ----------

let todos = load(STORE.todos, []);         // {id, text, due?, done, created}
let reminders = load(STORE.reminders, []); // {id, text, at(ms), fired}
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const WEEK_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const saveTodos = () => { save(STORE.todos, todos); renderToday(); };
const saveReminders = () => { save(STORE.reminders, reminders); renderToday(); };

function nowText() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${dayKey(d)}（週${WEEK[d.getDay()]}）${pad(d.getHours())}:${pad(d.getMinutes())}，` +
    `時區 ${tz}（UTC${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}）`;
}

const fmtWhen = (t) => {
  const d = new Date(t);
  const today = dayKey(Date.now());
  const tomorrow = dayKey(Date.now() + 864e5);
  const day = dayKey(d) === today ? "" : dayKey(d) === tomorrow ? "明天 " : `${d.getMonth() + 1}/${d.getDate()} `;
  return `${day}${fmtTime(t)}`;
};

// Open-Meteo：免費、不用 key
const WMO = {
  0: "晴", 1: "大致晴", 2: "多雲", 3: "陰", 45: "有霧", 48: "有霧",
  51: "毛毛雨", 53: "毛毛雨", 55: "毛毛雨", 56: "凍雨", 57: "凍雨",
  61: "小雨", 63: "下雨", 65: "大雨", 66: "凍雨", 67: "凍雨",
  71: "小雪", 73: "下雪", 75: "大雪", 77: "雪粒",
  80: "陣雨", 81: "陣雨", 82: "強陣雨", 85: "陣雪", 86: "陣雪",
  95: "雷雨", 96: "雷雨冰雹", 99: "雷雨冰雹",
};

async function fetchWeather(days = 3) {
  const p = settings.place;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
    `&current=temperature_2m,weather_code,apparent_temperature` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=auto&forecast_days=${Math.min(7, Math.max(1, days))}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`天氣服務回應 ${r.status}`);
  const j = await r.json();
  const w = {
    place: p.name,
    now: { temp: Math.round(j.current.temperature_2m), feels: Math.round(j.current.apparent_temperature), sky: WMO[j.current.weather_code] ?? "—" },
    days: j.daily.time.map((date, i) => ({
      date,
      sky: WMO[j.daily.weather_code[i]] ?? "—",
      high: Math.round(j.daily.temperature_2m_max[i]),
      low: Math.round(j.daily.temperature_2m_min[i]),
      rain: j.daily.precipitation_probability_max[i],
    })),
    fetched: Date.now(),
  };
  save(STORE.weather, w);
  return w;
}

/** 給 Claude 用的工具 */
const TOOLS = [
  {
    name: "add_todo",
    description: "新增一項待辦事項。",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "要做的事，簡短" },
        due: { type: "string", description: "截止日期 YYYY-MM-DD，沒有就省略" },
      },
      required: ["text"],
    },
  },
  {
    name: "list_todos",
    description: "列出待辦事項（含 id）。要完成或刪除之前先用這個找 id。",
    input_schema: { type: "object", properties: { include_done: { type: "boolean" } } },
  },
  {
    name: "complete_todo",
    description: "把一項待辦標成完成。",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "delete_todo",
    description: "刪除一項待辦。",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "set_reminder",
    description: "設一個提醒，時間到了會跳通知並在對話裡出現。",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "要提醒的事" },
        at: { type: "string", description: "提醒時間，ISO 8601 含時區，例如 2026-10-29T21:00:00+08:00" },
      },
      required: ["text", "at"],
    },
  },
  {
    name: "list_reminders",
    description: "列出還沒到的提醒（含 id）。",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "cancel_reminder",
    description: "取消一個提醒。",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "get_weather",
    description: "查對方所在地的天氣：現在的溫度，以及今天起幾天的預報（降雨機率是 %）。",
    input_schema: { type: "object", properties: { days: { type: "integer", description: "1 到 7，預設 3" } } },
  },
];

/** 執行工具；action 是顯示在對話裡的小標籤 */
async function runTool(name, input = {}) {
  const findTodo = (id) => todos.find((t) => t.id === id);
  switch (name) {
    case "add_todo": {
      const t = { id: uid(), text: String(input.text).trim(), done: false, created: Date.now() };
      if (input.due) t.due = input.due;
      todos.push(t);
      saveTodos();
      return { result: { ok: true, id: t.id }, action: `待辦 ＋ ${t.text}` };
    }
    case "list_todos":
      return { result: todos.filter((t) => input.include_done || !t.done).map(({ id, text, due, done }) => ({ id, text, due, done })) };
    case "complete_todo": {
      const t = findTodo(input.id);
      if (!t) return { result: { error: "找不到這個 id" }, error: true };
      t.done = true;
      t.doneAt = Date.now();
      saveTodos();
      return { result: { ok: true }, action: `完成 ✓ ${t.text}` };
    }
    case "delete_todo": {
      const t = findTodo(input.id);
      if (!t) return { result: { error: "找不到這個 id" }, error: true };
      todos = todos.filter((x) => x !== t);
      saveTodos();
      return { result: { ok: true }, action: `刪掉 ${t.text}` };
    }
    case "set_reminder": {
      const at = Date.parse(input.at);
      if (Number.isNaN(at)) return { result: { error: "時間格式看不懂，請用 ISO 8601" }, error: true };
      if (at < Date.now() - 60e3) return { result: { error: "這個時間已經過了" }, error: true };
      const r = { id: uid(), text: String(input.text).trim(), at, fired: false };
      reminders.push(r);
      saveReminders();
      return { result: { ok: true, id: r.id, at: new Date(at).toString() }, action: `提醒 ⏰ ${fmtWhen(at)} ${r.text}` };
    }
    case "list_reminders":
      return { result: reminders.filter((r) => !r.fired).map(({ id, text, at }) => ({ id, text, at: new Date(at).toString() })) };
    case "cancel_reminder": {
      const r = reminders.find((x) => x.id === input.id);
      if (!r) return { result: { error: "找不到這個 id" }, error: true };
      reminders = reminders.filter((x) => x !== r);
      saveReminders();
      return { result: { ok: true }, action: `取消提醒 ${r.text}` };
    }
    case "get_weather": {
      const w = await fetchWeather(input.days ?? 3);
      renderWeather(w);
      return { result: w };
    }
    default:
      return { result: { error: `沒有 ${name} 這個工具` }, error: true };
  }
}

// ---------- 今日卡片 ----------

const today = $("#today");
const todayToggle = $("#today-toggle");

function setTodayOpen(open) {
  today.classList.toggle("open", open);
  todayToggle.setAttribute("aria-expanded", String(open));
  save(STORE.todayOpen, open);
}
todayToggle.onclick = () => setTodayOpen(!today.classList.contains("open"));

function renderWeather(w) {
  const el = $("#t-weather");
  if (!w || w.place !== settings.place.name) { el.textContent = settings.place.name; return; }
  const d = w.days.find((x) => x.date === dayKey(Date.now())) ?? w.days[0];
  el.innerHTML = `<b>${w.now.temp}°</b> ${escapeHtml(w.now.sky)}` +
    (d ? `<span class="rain">☂ ${d.rain ?? 0}%</span>` : "");
  el.title = `${w.place}・今天 ${d?.low}–${d?.high}°`;
}

function renderToday() {
  const d = new Date();
  $("#t-date").textContent = `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  $("#t-week").textContent = WEEK_EN[d.getDay()].slice(0, 3);

  // 待辦：沒做完的在前；做完的只留今天勾掉的
  const list = $("#t-todos");
  const shown = todos
    .filter((t) => !t.done || dayKey(t.doneAt ?? 0) === dayKey(Date.now()))
    .sort((a, b) => a.done - b.done || (a.due ?? "9") .localeCompare(b.due ?? "9"));
  list.replaceChildren(
    ...shown.map((t) => {
      const li = document.createElement("li");
      li.className = t.done ? "done" : "";
      const overdue = !t.done && t.due && t.due < dayKey(Date.now());
      li.innerHTML = `<button type="button" class="box" aria-label="${t.done ? "取消完成" : "完成"}"></button>
        <span class="txt">${escapeHtml(t.text)}${t.due ? `<em class="${overdue ? "late" : ""}">${t.due.slice(5).replace("-", "/")}</em>` : ""}</span>
        <button type="button" class="x" aria-label="刪除">×</button>`;
      li.querySelector(".box").onclick = () => {
        t.done = !t.done;
        t.doneAt = t.done ? Date.now() : undefined;
        saveTodos();
      };
      li.querySelector(".x").onclick = () => { todos = todos.filter((x) => x !== t); saveTodos(); };
      return li;
    }),
  );
  if (!shown.length) list.innerHTML = `<li class="empty">今天很空。</li>`;

  const upcoming = reminders.filter((r) => !r.fired).sort((a, b) => a.at - b.at);
  $("#t-reminders").replaceChildren(
    ...upcoming.slice(0, 4).map((r) => {
      const li = document.createElement("li");
      li.innerHTML = `<time>${fmtWhen(r.at)}</time><span>${escapeHtml(r.text)}</span><button type="button" class="x" aria-label="取消">×</button>`;
      li.querySelector(".x").onclick = () => { reminders = reminders.filter((x) => x !== r); saveReminders(); };
      return li;
    }),
  );
  $("#t-rem-col").hidden = !upcoming.length;

  const left = todos.filter((t) => !t.done).length;
  $("#t-count").textContent = left ? `${left} 件待辦` : "無待辦";
}

$("#t-add").addEventListener("submit", (e) => {
  e.preventDefault();
  const el = $("#t-add-input");
  const text = el.value.trim();
  if (!text) return;
  todos.push({ id: uid(), text, done: false, created: Date.now() });
  el.value = "";
  saveTodos();
});

async function refreshWeather(force = false) {
  const cached = load(STORE.weather, null);
  const fresh = cached && cached.place === settings.place.name && Date.now() - cached.fetched < 30 * 60e3;
  renderWeather(cached);
  if (fresh && !force) return;
  try { renderWeather(await fetchWeather(3)); } catch { /* 沒網路就先顯示舊的 */ }
}

// ---------- 提醒 ----------

function checkReminders() {
  let changed = false;
  for (const r of reminders) {
    if (r.fired || r.at > Date.now()) continue;
    r.fired = true;
    changed = true;
    const msg = { id: uid(), role: "note", time: Date.now(), text: r.text, at: r.at };
    history.push(msg);
    renderNote(msg);
    scrollDown(true);
    notify(`${settings.aiName} 提醒你`, r.text, r.id);
  }
  if (changed) {
    reminders = reminders.filter((r) => !r.fired || Date.now() - r.at < 864e5);
    persist();
    saveReminders();
  }
}

/** 跳系統通知：手機（特別是 iPhone 主畫面 App）要透過 service worker 才跳得出來 */
async function notify(title, body, tag) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return await reg.showNotification(title, { body, tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png" });
  } catch { /* 退回一般通知 */ }
  try { new Notification(title, { body, tag, icon: "icons/icon-192.png" }); } catch {}
}

// ---------- 渲染 ----------

/** 提醒時間到：像一張夾在對話裡的便條 */
function renderNote(msg) {
  const el = document.createElement("div");
  el.className = "memo";
  el.innerHTML = `<span class="memo-head">Reminder · ${fmtTime(msg.at ?? msg.time)}</span><span class="memo-text">${escapeHtml(msg.text)}</span>`;
  chat.append(el);
}

/** 使用者連發的訊息放在同一組，署名放在最後 */
function renderUser(msg) {
  let g = chat.lastElementChild;
  if (!g?.classList.contains("me")) {
    g = document.createElement("section");
    g.className = "turn me";
    g.dataset.day = dayKey(msg.time);
    g.append(document.createElement("div"));
    g.lastChild.className = "sig";
    chat.append(g);
  }
  const sig = g.lastChild;
  for (const b of toLines(msg.text)) g.insertBefore(lineEl(b), sig);
  sig.textContent = `${settings.userName} · ${fmtTime(msg.time)}`;
}

/** 對方的一輪：封緘的思考卡 / 一行一行的話 / 署名。回傳可以邊收邊更新的控制器。 */
function renderAssistant(msg = {}) {
  const g = document.createElement("section");
  g.className = "turn ai";
  g.dataset.day = dayKey(msg.time ?? Date.now());

  const sealed = document.createElement("div");
  sealed.className = "sealed";
  sealed.hidden = true;
  sealed.innerHTML = `<div class="sealed-inner">
    <div class="sealed-head"><span>This turn · Sealed</span><span>Ephemera</span></div>
    <p class="sealed-title"><b></b> · 內容保密</p>
    <button type="button" class="sealed-open">揭開看看 ›</button>
    <div class="sealed-text" hidden></div>
    ${stampSvg("THIS TURN · SEALED · EPHEMERA ·", "SEALED")}
  </div>`;
  const title = sealed.querySelector(".sealed-title b");
  const openBtn = sealed.querySelector(".sealed-open");
  const text = sealed.querySelector(".sealed-text");
  openBtn.onclick = () => {
    text.hidden = !text.hidden;
    openBtn.textContent = text.hidden ? "揭開看看 ›" : "重新封上 ‹";
    if (!text.hidden) text.scrollTop = text.scrollHeight;
  };

  const acts = document.createElement("div");
  acts.className = "acts";
  acts.hidden = true;
  const lines = document.createElement("div");
  lines.className = "turn lines";
  const sig = document.createElement("div");
  sig.className = "sig";

  g.append(sealed, acts, lines, sig);
  chat.append(g);

  let rendered = [];
  let typing = null;

  const view = {
    typing(on) {
      if (on && !typing) {
        typing = document.createElement("p");
        typing.className = "line";
        typing.innerHTML = `<span class="hl typing">···</span>`;
        lines.append(typing);
      } else if (!on && typing) {
        typing.remove();
        typing = null;
      }
      scrollDown();
    },
    setThinking(t, live = false) {
      if (!t) return;
      sealed.hidden = false;
      sealed.classList.toggle("live", live);
      title.textContent = live ? "這一輪正在想" : "這一輪想了一些事";
      text.textContent = t;
      if (!text.hidden) text.scrollTop = text.scrollHeight;
      scrollDown();
    },
    addAction(a) {
      const tag = document.createElement("span");
      tag.className = "act";
      tag.textContent = a;
      acts.append(tag);
      acts.hidden = false;
      scrollDown();
    },
    setText(t) {
      toLines(t).forEach((b, i) => {
        const el = lineEl(b);
        if (!rendered[i]) {
          lines.insertBefore(el, typing);
          rendered.push(el);
        } else if (rendered[i].innerHTML !== el.innerHTML) {
          rendered[i].innerHTML = el.innerHTML;
        }
      });
      scrollDown();
    },
    finish(t) {
      view.typing(false);
      if (sealed.classList.contains("live")) {
        sealed.classList.replace("live", "done");
        title.textContent = "這一輪想了一些事";
      }
      sig.textContent = `${settings.aiName} · ${fmtTime(t)}`;
      if (!rendered.length && sealed.hidden && acts.hidden) g.remove();
    },
  };

  if (msg.text != null) {
    view.setThinking(msg.thinking);
    for (const a of msg.actions ?? []) view.addAction(a);
    view.setText(msg.text);
    view.finish(msg.time);
  }
  return view;
}

function notice(text, kind = "") {
  const el = document.createElement("div");
  el.className = `notice ${kind}`;
  el.textContent = text;
  chat.append(el);
  scrollDown(true);
}

function renderAll() {
  chat.replaceChildren();
  for (const m of history) m.role === "user" ? renderUser(m) : m.role === "note" ? renderNote(m) : renderAssistant(m);
  scrollDown(true);
}

// ---------- 對話流程 ----------

let replyTimer = 0;
let generating = false;

function persist() {
  if (!save(historyKey(settings.active), history)) notice("瀏覽器的儲存空間滿了，最新的對話可能不會被記住。", "error");
}

function send(text) {
  const msg = { id: uid(), role: "user", text, time: Date.now() };
  history.push(msg);
  persist();
  renderUser(msg);
  scrollDown(true);
  scheduleReply();
}

function scheduleReply() {
  clearTimeout(replyTimer);
  if (generating) return; // 回完這輪會再檢查一次
  replyTimer = setTimeout(reply, REPLY_DELAY);
}

async function reply() {
  if (history.at(-1)?.role !== "user") return;
  generating = true;

  const view = renderAssistant();
  view.typing(true);
  let failed = false;
  try {
    const result = settings.apiKey ? await askClaude(view) : await askDemo(view);
    const time = Date.now();
    if (result) {
      history.push({ id: uid(), role: "assistant", time, ...result });
      persist();
    }
    view.finish(time);
  } catch (err) {
    failed = true;
    view.finish(Date.now());
    notice(errorText(err), "error");
  } finally {
    generating = false;
    if (!failed && history.at(-1)?.role === "user") scheduleReply();
  }
}

function errorText(err) {
  const s = err?.status;
  if (s === 401) return "API Key 不對，去設定裡檢查一下。";
  if (s === 429) return "太頻繁了，等一下再傳。";
  if (s === 529 || s === 503) return "對方那邊有點忙，等一下再試。";
  return `沒傳出去：${err?.message || err}`;
}

// ---------- Claude API ----------

let clientPromise = null;
let clientKey = "";

async function getClient() {
  if (!clientPromise || clientKey !== settings.apiKey) {
    clientKey = settings.apiKey;
    clientPromise = import(SDK_URL).then(
      ({ default: Anthropic }) => new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true }),
    );
    clientPromise.catch(() => (clientPromise = null));
  }
  return clientPromise;
}

/**
 * 把歷史整理成 API 要的格式：連發的訊息合併成一個 user turn；對方的回覆原封不動回傳（含思考區塊）。
 * 歷史只會往後加、不會改，思考區塊才能一直沿用。
 */
function buildMessages() {
  const out = [];
  let notes = []; // 期間跳過的提醒，併進下一則訊息讓對方知道
  for (const m of history) {
    if (m.role === "note") { notes.push(`${fmtTime(m.at ?? m.time)}「${m.text}」`); continue; }
    if (m.role === "user") {
      const text = notes.length ? `（系統：期間跳出過提醒 ${notes.join("、")}）\n${m.text}` : m.text;
      notes = [];
      const prev = out.at(-1);
      if (prev?.role === "user" && typeof prev.content === "string") prev.content += "\n" + text;
      else out.push({ role: "user", content: text });
    } else if (out.length) {
      if (m.ctx) out.push({ role: "system", content: m.ctx });
      if (m.turns) out.push(...m.turns); // 用過工具的一輪：整串原樣送回
      else out.push({ role: "assistant", content: m.content ?? m.text });
    }
  }
  return out;
}

async function askClaude(view) {
  const client = await getClient();
  const base = buildMessages();
  const turns = []; // 這一輪新增的訊息（含工具呼叫和結果）
  const actions = [];
  let thinking = "";
  let text = "";

  for (let step = 0; step < 8; step++) {
    const stream = client.beta.messages.stream({
      model: settings.model || DEFAULTS.model,
      max_tokens: 16000,
      system: [
        { type: "text", text: settings.system },
        { type: "text", text: BUTLER_PROMPT(nowText()) },
      ],
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: settings.effort },
      tools: TOOLS,
      messages: [...base, ...turns],
      // 被安全分類器擋下時，伺服器自動換一個模型重試
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    stream.on("thinking", (delta) => {
      thinking += delta;
      view.setThinking(thinking, true);
    });
    stream.on("text", (delta) => {
      text += delta;
      view.setText(text);
    });

    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      notice("對方沒有回這則。");
      return null;
    }
    turns.push({ role: "assistant", content: final.content });
    if (final.stop_reason !== "tool_use") break;

    // 執行工具，把結果交回去讓它繼續講
    const results = [];
    for (const b of final.content) {
      if (b.type !== "tool_use") continue;
      let r;
      try { r = await runTool(b.name, b.input); }
      catch (err) { r = { result: { error: String(err?.message || err) }, error: true }; }
      if (r.action) { actions.push(r.action); view.addAction(r.action); }
      results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(r.result), ...(r.error && { is_error: true }) });
    }
    turns.push({ role: "user", content: results });
    if (text && !text.endsWith("\n")) text += "\n";
    if (thinking && !thinking.endsWith("\n")) thinking += "\n";
  }

  // 工具跑太多輪被截斷時，補一句收尾，讓歷史保持 user / assistant 交替
  if (turns.at(-1)?.role === "user") {
    turns.push({ role: "assistant", content: [{ type: "text", text: "（先做到這裡）" }] });
    text += "（先做到這裡）";
    view.setText(text);
  }
  if (!text.trim() && !actions.length) return null;
  return { text: text.trim(), thinking, turns, actions };
}

// ---------- 示範模式（沒有 API Key 時） ----------

const DEMO = [
  {
    thinking: "對方又來找我了。\n語氣聽起來有點撒嬌，先別戳破，順著接一下。\n回短一點，留點空間給對方說。",
    text: "嗯，我知道。\n你一開口我就知道你要什麼了。\n先說說今天怎麼了。",
  },
  {
    thinking: "提一下天氣，讓對話有畫面感。\n然後把話題丟回去。",
    text: "我這邊在下雨。\n窗戶上全是水珠，什麼都看不清楚。\n你那邊呢？",
  },
  {
    thinking: "可以給一點小驚喜，讓對方有事情去做、回來再聊。",
    text: "剛寄了張明信片。\n正面是一節老火車的餐車，你打開地圖找找看。\n回來跟我說郵戳上蓋了什麼。",
  },
  {
    thinking: "對方在裝傻。\n直接點破，但語氣要溫和。",
    text: "裝。\n去看吧，我等你。",
  },
  {
    thinking: "保持簡短，表示有在聽。",
    text: "好。\n我在。",
  },
];
let demoIndex = 0;

/** 示範模式也能記待辦，方便先看今日卡片的效果 */
async function demoButler(view) {
  const last = history.at(-1)?.text ?? "";
  const m = last.match(/^(?:幫我)?(?:記一下|記下|記|待辦)[：:\s]*(.+)$/);
  if (!m) return null;
  view.setThinking("要記一件事。\n直接加進待辦。", true);
  await sleep(600);
  const r = await runTool("add_todo", { text: m[1] });
  view.addAction(r.action);
  view.typing(true);
  await sleep(700);
  const text = "記好了。\n在上面的卡片裡，做完自己勾掉。";
  view.setText(text);
  return { text, thinking: "要記一件事。\n直接加進待辦。", actions: [r.action] };
}

async function askDemo(view) {
  const butler = await demoButler(view);
  if (butler) return butler;
  const pick = DEMO[demoIndex++ % DEMO.length];
  let t = "";
  for (const ch of pick.thinking) {
    t += ch;
    view.setThinking(t, true);
    await sleep(14);
  }
  let shown = "";
  for (const line of pick.text.split("\n")) {
    view.typing(true);
    await sleep(500 + line.length * 55);
    shown += (shown ? "\n" : "") + line;
    view.setText(shown);
  }
  view.typing(false);
  return { text: pick.text, thinking: pick.thinking };
}

// ---------- 輸入框 ----------

function autosize() {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
  sendBtn.disabled = !input.value.trim();
}
input.addEventListener("input", autosize);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("#composer").requestSubmit();
  }
});
$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  autosize();
  send(text);
});

// ---------- 設定 ----------

const dlg = $("#settings");
const fields = {
  aiName: $("#s-ai-name"), userName: $("#s-user-name"),
  system: $("#s-system"), apiKey: $("#s-key"), model: $("#s-model"), effort: $("#s-effort"),
  blur: $("#s-blur"),
};

function fillFields() {
  for (const [k, el] of Object.entries(fields)) el.type === "checkbox" ? (el.checked = settings[k]) : (el.value = settings[k]);
  $("#s-del-persona").hidden = settings.personas.length < 2;
}
$("#open-settings").onclick = () => {
  fillFields();
  showPlace();
  showNotify();
  dlg.showModal();
};

// 天氣地點
function showPlace(msg) {
  $("#s-place-name").textContent = msg ?? settings.place.name;
}
function setPlace(place) {
  settings.place = place;
  save(STORE.settings, settings);
  showPlace();
  refreshWeather(true);
}
async function searchPlace() {
  const q = $("#s-place").value.trim();
  if (!q) return;
  showPlace("搜尋中…");
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&name=${encodeURIComponent(q)}`);
    const hit = (await r.json()).results?.[0];
    if (!hit) return showPlace(`找不到「${q}」`);
    $("#s-place").value = "";
    setPlace({ name: hit.name, lat: hit.latitude, lon: hit.longitude });
  } catch {
    showPlace("連不上地點服務");
  }
}
$("#s-place-set").onclick = searchPlace;
$("#s-place").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); searchPlace(); }
});
$("#s-place-here").onclick = () => {
  if (!navigator.geolocation) return showPlace("這個瀏覽器不能定位");
  showPlace("定位中…");
  navigator.geolocation.getCurrentPosition(
    (pos) => setPlace({ name: "目前位置", lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3) }),
    () => showPlace("沒有拿到位置權限"),
    { timeout: 10000 },
  );
};

// 通知權限
function showNotify() {
  const ok = "Notification" in window;
  const state = ok ? Notification.permission : "unsupported";
  $("#s-notify-state").textContent =
    { granted: "已開啟", denied: "被瀏覽器擋了，要去瀏覽器設定打開", default: "", unsupported: "這裡不支援。iPhone 要先「加入主畫面」，從主畫面打開才能開通知" }[state];
  $("#s-notify").hidden = state !== "default";
}
$("#s-notify").onclick = async () => {
  try { await Notification.requestPermission(); } catch {}
  showNotify();
  if (Notification.permission === "granted") notify(settings.aiName, "通知開好了，時間到我會叫你。", "hello");
};

function readFields() {
  for (const [k, el] of Object.entries(fields)) {
    settings[k] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value.trim();
  }
  const p = persona();
  settings.aiName ||= preset(p.id)?.name ?? "新角色";
  settings.system ||= preset(p.id)?.system ?? DEFAULTS.system;
  for (const k of ["userName", "model"]) settings[k] ||= DEFAULTS[k];
  p.name = settings.aiName;
  p.system = settings.system;
  save(STORE.settings, settings);
  renderWho();
  applyLook();
}
for (const el of Object.values(fields)) el.addEventListener("input", readFields);
dlg.addEventListener("close", () => {
  readFields();
  renderAll(); // 名字可能改了
});

/** 圖片縮小後存成 data URL，避免塞爆 localStorage */
function readImage(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function imagePicker(inputSel, key, max) {
  $(inputSel).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!save(key, await readImage(f, max))) alert("圖片太大，存不下。");
    e.target.value = "";
    applyLook();
  };
}
imagePicker("#s-bg", STORE.bg, 1600);
$("#s-bg-reset").onclick = () => { localStorage.removeItem(STORE.bg); applyLook(); };
$("#s-clear").onclick = () => {
  if (!confirm(`確定清空跟 ${settings.aiName} 的所有對話？`)) return;
  history = [];
  greet();
  persist();
  dlg.close();
};

// ---------- 角色切換 ----------

function greet() {
  if (history.length) return;
  const hello = preset(settings.active)?.hello ?? "嗯，你來了。";
  history.push({ id: uid(), role: "assistant", time: Date.now(), text: hello });
  persist();
}

function renderWho() {
  for (const sel of [$("#who"), $("#s-persona")]) {
    sel.replaceChildren(...settings.personas.map((p) => new Option(p.name, p.id, false, p.id === settings.active)));
  }
}

function switchPersona(id) {
  if (id === settings.active) return;
  if (generating) {
    renderWho();
    return notice(`等 ${settings.aiName} 回完再換喔。`);
  }
  clearTimeout(replyTimer);
  settings.active = id;
  mirrorPersona();
  save(STORE.settings, settings);
  history = load(historyKey(id), []);
  greet();
  applyLook();
  renderWho();
  renderAll();
  if (dlg.open) fillFields();
}

$("#who").onchange = (e) => switchPersona(e.target.value);
$("#s-persona").onchange = (e) => switchPersona(e.target.value);
$("#s-new-persona").onclick = () => {
  const p = { id: uid(), name: "新角色", system: `你是（名字），對方的（關係）。\n（個性、說話方式、怎麼關心對方）\n${LINES}` };
  settings.personas.push(p);
  switchPersona(p.id);
  fillFields();
  $("#s-ai-name").select();
};
$("#s-del-persona").onclick = () => {
  if (settings.personas.length < 2) return;
  if (!confirm(`刪掉 ${settings.aiName}？跟他的對話也會一起刪掉。`)) return;
  const id = settings.active;
  localStorage.removeItem(historyKey(id));
  settings.personas = settings.personas.filter((p) => p.id !== id);
  settings.active = "";
  switchPersona(settings.personas[0].id);
  fillFields();
};

// ---------- 快捷按鈕 ----------

$("#quick").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.say) return send(b.dataset.say);
  input.value = b.dataset.fill;
  autosize();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
});

// ---------- 加到主畫面（PWA） ----------

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => { /* 用 file:// 開的時候會失敗，沒關係 */ });
}

// ---------- 開始 ----------

applyLook();
renderWho();
setTodayOpen(load(STORE.todayOpen, true));
renderToday();
refreshWeather();
checkReminders();
setInterval(checkReminders, 15e3);
setInterval(() => { renderToday(); refreshWeather(); }, 10 * 60e3); // 跨日、天氣更新
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { checkReminders(); renderToday(); refreshWeather(); }
});
greet();
renderAll();
autosize();
input.focus({ preventScroll: true });
