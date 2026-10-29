import { createRain } from "./rain.js";

const SDK_URL = "./vendor/anthropic-sdk.js"; // @anthropic-ai/sdk 1.3.0，已打包成瀏覽器可用的單檔
const STORE = { settings: "grey.settings", history: "grey.history", aiAvatar: "grey.aiAvatar", bg: "grey.bg" };
const REPLY_DELAY = 1100; // 停止輸入多久後對方才回（可以連發好幾則）
const CONTEXT_WINDOW = 1_000_000;

// 每百萬 token 的美元價格（標準價；快取讀取另計，1 小時快取寫入是輸入價的 2 倍）
const PRICES = [
  ["claude-opus-5-5", { input: 4, output: 20, read: 0.2 }],
  ["claude-sonnet-5-5", { input: 2, output: 10, read: 0.2 }],
  ["claude-haiku-5-5", { input: 0.1, output: 0.5, read: 0.01 }],
  ["claude-fable-5-1", { input: 10, output: 50, read: 0.25 }],
  ["claude-opus-5", { input: 5, output: 25, read: 0.5 }],
];
const priceOf = (model = "") => PRICES.find(([id]) => model.startsWith(id))?.[1];

const DEFAULTS = {
  aiName: "Grey",
  title: "Grey",
  subtitle: "夜間筆記",
  userName: "我",
  system:
    "你是 Grey，正在用通訊軟體跟對方聊天。\n" +
    "說話簡短、口語、有點冷但很在乎對方。\n" +
    "每一句話單獨一行（用換行分開），像一則一則傳訊息，一次最多四五行。\n" +
    "不要用 Markdown 標題或清單，不要用表情符號。用繁體中文。",
  apiKey: "",
  model: "claude-opus-5-5",
  effort: "low",
  injectTime: true,
  city: "",
  blur: 0,
  gray: false,
  rain: false,
};

// ---------- 儲存 ----------

const load = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
};
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
};

// 舊版預設是黑白、模糊、下雨；換風格後只有還沒自己調過的人改用新預設
const stored = load(STORE.settings, {});
if (!("injectTime" in stored)) { delete stored.blur; delete stored.gray; delete stored.rain; }
if (stored.subtitle === "觀測記錄") delete stored.subtitle; // 舊版預設的副標題
const settings = { ...DEFAULTS, ...stored };

// 對話和貼圖可能有照片，localStorage 放不下，改存 IndexedDB
const idb = new Promise((resolve, reject) => {
  const req = indexedDB.open("grey", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("kv");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const idbGet = async (k) => {
  const db = await idb;
  return new Promise((resolve, reject) => {
    const req = db.transaction("kv").objectStore("kv").get(k);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};
const idbSet = async (k, v) => {
  const db = await idb;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(v, k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};
const idbLoad = (k) => idbGet(k).catch(() => undefined);

/**
 * 使用者的一則：text、image（data URL）或 sticker（{name, src}）其中之一。
 * @type {{id:string, role:'user'|'assistant', text?:string, image?:string, sticker?:{name:string, src:string},
 *   time:number, thinking?:string, content?:any[], ctx?:string, usage?:object, model?:string, secs?:number}[]}
 */
let history = (await idbLoad("history")) ?? load(STORE.history, []);
/** @type {{id:string, name:string, src:string}[]} */
let stickers = (await idbLoad("stickers")) ?? [];

const $ = (s) => document.querySelector(s);
const chat = $("#chat");
const input = $("#input");
const sendBtn = $("#send");
const status = $("#status");

// ---------- 外觀 ----------

const rain = createRain($("#rain"));

function applyLook() {
  const root = document.documentElement.style;
  root.setProperty("--bg-blur", `${settings.blur}px`);
  root.setProperty("--bg-gray", settings.gray ? "1" : "0");
  settings.rain ? rain.start() : rain.stop();

  const bg = load(STORE.bg, null);
  const photo = $("#photo");
  photo.style.backgroundImage = bg ? `url("${bg}")` : "";
  photo.classList.toggle("on", !!bg);

  const avatar = load(STORE.aiAvatar, null);
  $("#ai-avatar-top").style.backgroundImage = avatar ? `url("${avatar}")` : "";
  $("#ai-tag").textContent = settings.aiName;
  $("#title").textContent = settings.title;
  $("#subtitle").textContent = settings.subtitle;
  input.placeholder = `給 ${settings.aiName} 發消息…`;
  document.title = settings.title;
  renderWeather();
}

// ---------- 天氣（Open-Meteo，免金鑰） ----------

let weather = null; // { city, temp, desc }
let geo = null; // { query, lat, lon, name }

const WEATHER_CODES = [
  [0, "晴"], [1, "晴時多雲"], [2, "多雲"], [3, "陰"], [48, "霧"], [57, "毛毛雨"], [65, "雨"],
  [67, "凍雨"], [77, "雪"], [82, "陣雨"], [86, "陣雪"], [99, "雷雨"],
];
const weatherText = (code) => WEATHER_CODES.find(([max]) => code <= max)?.[1] ?? "";

async function refreshWeather() {
  const city = settings.city.trim();
  if (!city) { weather = null; return renderWeather(); }
  try {
    if (geo?.query !== city) {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&format=json&name=${encodeURIComponent(city)}`);
      const hit = (await r.json()).results?.[0];
      if (!hit) throw new Error("找不到城市");
      geo = { query: city, lat: hit.latitude, lon: hit.longitude, name: hit.name };
    }
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code`);
    const cur = (await r.json()).current;
    weather = { city: geo.name, temp: Math.round(cur.temperature_2m), desc: weatherText(cur.weather_code) };
  } catch {
    weather = null;
  }
  renderWeather();
}

function renderWeather() {
  $("#weather").hidden = !weather;
  if (!weather) return;
  $("#w-temp").textContent = `${weather.temp}°`;
  $("#w-desc").textContent = weather.desc;
  $("#weather").title = weather.city;
}

// ---------- 小工具 ----------

const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const uid = () => Math.random().toString(36).slice(2, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WEEK = "日一二三四五六";

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

const STICKER_LINE = /^\[貼圖[:：]\s*(.+?)\s*\]$/;
const isQuestion = (t) => /[?？]$/.test(t);

function frameEl(src, kind, alt = "") {
  const f = document.createElement("figure");
  f.className = `frame ${kind}`;
  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  img.onload = () => scrollDown();
  f.append(img);
  return f;
}

/** 對方的一行：程式碼、貼圖、問句（加框）或一般的話 */
function lineEl(b) {
  if (b.code != null) {
    const p = document.createElement("p");
    p.className = "line code";
    p.textContent = b.code;
    return p;
  }
  const name = b.text.match(STICKER_LINE)?.[1];
  const st = name && stickers.find((x) => x.name === name);
  if (st) return frameEl(st.src, "sticker", st.name);
  const p = document.createElement("p");
  p.className = isQuestion(b.text) ? "line box" : "line";
  p.innerHTML = `<span class="hl">${inline(b.text)}</span>`;
  return p;
}

function nearBottom() {
  return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 140;
}
function scrollDown(force = false) {
  if (force || nearBottom()) requestAnimationFrame(() => (chat.scrollTop = chat.scrollHeight));
}

// ---------- 渲染 ----------

/** 使用者連發的訊息放在同一組，時間標籤放在最後 */
function renderUser(msg) {
  let g = chat.lastElementChild;
  if (!g?.classList.contains("me")) {
    g = document.createElement("section");
    g.className = "turn me";
    g.dataset.day = dayKey(msg.time);
    g.append(document.createElement("div"));
    g.lastChild.className = "time-tag";
    chat.append(g);
  }
  const tag = g.lastChild;
  if (msg.image) g.insertBefore(frameEl(msg.image, "photo", "照片"), tag);
  else if (msg.sticker) g.insertBefore(frameEl(msg.sticker.src, "sticker", msg.sticker.name), tag);
  else {
    for (const b of toLines(msg.text)) {
      const p = document.createElement("p");
      p.className = b.code != null ? "line code" : "line box";
      if (b.code != null) p.textContent = b.code;
      else p.innerHTML = `<span class="hl">${inline(b.text)}</span>`;
      g.insertBefore(p, tag);
    }
  }
  tag.textContent = fmtTime(msg.time);
}

/** 對方的一輪：一行式思考摘要 / 一行一行的話 / 署名。回傳可以邊收邊更新的控制器。 */
function renderAssistant(msg = {}) {
  const g = document.createElement("section");
  g.className = "turn ai";
  g.dataset.day = dayKey(msg.time ?? Date.now());

  const musing = document.createElement("button");
  musing.type = "button";
  musing.className = "musing";
  musing.hidden = true;
  musing.setAttribute("aria-expanded", "false");
  musing.innerHTML = `<i class="dia"></i><span class="gist"></span><span class="at"></span><span class="caret">▼</span>`;
  const gist = musing.querySelector(".gist");
  const card = document.createElement("div");
  card.className = "musing-card";
  card.hidden = true;
  musing.onclick = () => {
    card.hidden = !card.hidden;
    musing.setAttribute("aria-expanded", String(!card.hidden));
    if (!card.hidden) card.scrollTop = card.scrollHeight;
  };

  const lines = document.createElement("div");
  lines.className = "turn lines";
  const sig = document.createElement("div");
  sig.className = "sig";

  g.append(musing, card, lines, sig);
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
      musing.hidden = false;
      musing.classList.toggle("live", live);
      gist.textContent = t.split("\n").find((l) => l.trim())?.trim() ?? "";
      card.textContent = t;
      if (!card.hidden) card.scrollTop = card.scrollHeight;
      scrollDown();
    },
    setText(t) {
      toLines(t).forEach((b, i) => {
        const el = lineEl(b);
        if (!rendered[i]) {
          lines.insertBefore(el, typing);
          rendered.push(el);
        } else if (rendered[i].outerHTML !== el.outerHTML) {
          rendered[i].replaceWith(el);
          rendered[i] = el;
        }
      });
      scrollDown();
    },
    finish(t) {
      view.typing(false);
      musing.classList.remove("live");
      musing.querySelector(".at").textContent = fmtTime(t);
      sig.textContent = `${settings.aiName} · ${fmtTime(t)}`;
      if (!rendered.length && musing.hidden) g.remove();
    },
  };

  if (msg.text != null) {
    view.setThinking(msg.thinking);
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
  for (const m of history) m.role === "user" ? renderUser(m) : renderAssistant(m);
  renderDays();
  renderTide();
  scrollDown(true);
}

/** 頁首的 DAY 列：最近有對話的幾天，點一下跳到那天 */
function renderDays() {
  const nav = $("#days");
  const today = dayKey(Date.now());
  const days = [...new Set([...history.map((m) => dayKey(m.time)), today])].sort().slice(-4);
  nav.innerHTML = `<span class="lbl">DAY</span>`;
  for (const d of days) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = Number(d.slice(-2));
    b.title = d;
    b.classList.toggle("today", d === today);
    b.onclick = () => chat.querySelector(`[data-day="${d}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    nav.append(b);
  }
}

const lastUsage = () => history.findLast((m) => m.usage);
const contextUsed = (u) => u.input + u.cacheRead + u.cacheWrite + u.output;

function renderTide() {
  const m = lastUsage();
  const pct = m ? Math.min(100, (contextUsed(m.usage) / CONTEXT_WINDOW) * 100) : 0;
  $("#tide-fill").style.height = `${pct}%`;
  $("#tide-num").textContent = pct < 10 ? pct.toFixed(1).replace(/\.0$/, "") : Math.round(pct);
}

// ---------- 帳本 ----------

const fmtUsd = (n) => `$${n.toFixed(4)}`;
const fmtNum = (n) => n.toLocaleString("en-US");

function costOf(m) {
  const p = priceOf(m.model);
  if (!p || !m.usage) return null;
  const u = m.usage;
  return {
    input: (u.input * p.input) / 1e6,
    cacheRead: (u.cacheRead * p.read) / 1e6,
    cacheWrite: (u.cacheWrite * p.input * 2) / 1e6,
    output: (u.output * p.output) / 1e6,
  };
}
const sum = (c) => c.input + c.cacheRead + c.cacheWrite + c.output;

function openLedger() {
  const body = $("#ledger-body");
  const m = lastUsage();
  if (!m) {
    $("#l-time").textContent = "--:--";
    body.innerHTML = `<p class="ledger-big">$0<small>還沒有紀錄</small></p>
      <p class="ledger-note">填入 API Key 開始聊天後，這裡會記下每一輪用了多少、花了多少。示範模式不計費。</p>`;
    $("#ledger").showModal();
    return;
  }

  const u = m.usage;
  const c = costOf(m);
  const prompt = u.input + u.cacheRead + u.cacheWrite;
  const hit = prompt ? Math.round((u.cacheRead / prompt) * 100) : 0;
  const all = history.map(costOf).filter(Boolean).reduce((a, x) => a + sum(x), 0);
  const used = contextUsed(u);
  const d = new Date(m.time);
  const cell = (k) => (c ? fmtUsd(c[k]) : "—");

  $("#l-time").textContent = fmtTime(m.time);
  body.innerHTML = `
    <svg class="postmark" viewBox="0 0 140 100" aria-hidden="true">
      <g fill="none" stroke="currentColor" stroke-width="1.6">
        <path d="M0 32 q10 -7 20 0 t20 0 t20 0 t20 0"/><path d="M0 44 q10 -7 20 0 t20 0 t20 0 t20 0"/>
        <path d="M0 56 q10 -7 20 0 t20 0 t20 0 t20 0"/><path d="M0 68 q10 -7 20 0 t20 0 t20 0 t20 0"/>
        <circle cx="100" cy="50" r="38" stroke-width="2"/><circle cx="100" cy="50" r="26"/>
      </g>
      <path d="M100 58 c-8 -6 -12 -10 -12 -15 a6 6 0 0 1 12 -2 a6 6 0 0 1 12 2 c0 5 -4 9 -12 15z" fill="currentColor"/>
      <text x="100" y="84" text-anchor="middle" font-family="Playfair Display, serif" font-size="8" fill="currentColor">${d.toLocaleString("en-US", { month: "short" }).toUpperCase()} ${d.getDate()}</text>
    </svg>
    <p class="ledger-big">${c ? fmtUsd(sum(c)) : "—"}</p>
    <p class="ledger-note">${escapeHtml(m.model || "")}<br>${d.getMonth() + 1}/${d.getDate()} 週${WEEK[d.getDay()]} · 快取命中 ${hit}%${m.secs ? ` · ${m.secs.toFixed(1)}s` : ""}</p>
    <table class="ledger-table">
      <tr><td>input</td><td>${fmtNum(u.input)}</td><td>${cell("input")}</td></tr>
      <tr><td>cache read</td><td>${fmtNum(u.cacheRead)}</td><td>${cell("cacheRead")}</td></tr>
      <tr><td>cache write</td><td>${fmtNum(u.cacheWrite)}</td><td>${cell("cacheWrite")}</td></tr>
      <tr><td>output</td><td>${fmtNum(u.output)}</td><td>${cell("output")}</td></tr>
      <tr class="total"><td>本次對話累計</td><td></td><td>${fmtUsd(all)}</td></tr>
    </table>
    <div class="ledger-section">
      <h3>Context · 上下文</h3>
      <div class="ledger-bar"><i style="width:${Math.max(0.5, (used / CONTEXT_WINDOW) * 100)}%"></i></div>
      <div class="ledger-row"><span>已用 ${fmtNum(used)}</span><span>還剩 ${fmtNum(Math.max(0, CONTEXT_WINDOW - used))} / 1M</span></div>
    </div>
    ${m.ctx ? `<div class="ledger-section"><h3>Injected · 本輪注入</h3><div class="ledger-inject">${escapeHtml(m.ctx)}</div></div>` : ""}
    <p class="ledger-note" style="margin-top:16px">價格依官方標準價估算：1 小時快取寫入算輸入價 2 倍。實際以 Console 帳單為準。</p>`;
  $("#ledger").showModal();
}
$("#tide").onclick = openLedger;
$("#ledger-close").onclick = () => $("#ledger").close();
$("#ledger").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

// ---------- 對話流程 ----------

let replyTimer = 0;
let generating = false;

function persist() {
  idbSet("history", history)
    .then(() => localStorage.removeItem(STORE.history)) // 舊版存在 localStorage 的搬過來了
    .catch(() => notice("瀏覽器的儲存空間滿了，最新的對話可能不會被記住。", "error"));
}

/** 傳一則：{ text } / { image } / { sticker } */
function send(part) {
  const msg = { id: uid(), role: "user", time: Date.now(), ...part };
  history.push(msg);
  persist();
  renderUser(msg);
  renderDays();
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
  status.textContent = "輸入中";
  status.classList.add("busy");

  const view = renderAssistant();
  view.typing(true);
  let failed = false;
  try {
    const result = settings.apiKey ? await askClaude(view) : await askDemo(view);
    const time = Date.now();
    if (result) {
      history.push({ id: uid(), role: "assistant", time, ...result });
      persist();
      renderTide();
    }
    view.finish(time);
  } catch (err) {
    failed = true;
    view.finish(Date.now());
    notice(errorText(err), "error");
  } finally {
    generating = false;
    status.textContent = "醒著";
    status.classList.remove("busy");
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

function timeNote() {
  const d = new Date();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = `現在時間：${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（週${WEEK[d.getDay()]}）${fmtTime(d)}，${zone}`;
  return weather ? `${now}\n${weather.city}現在的天氣：${weather.desc}，${weather.temp}°C` : now;
}

const imageBlock = (dataUrl) => {
  const [, media_type, data] = dataUrl.match(/^data:(.+?);base64,(.*)$/);
  return { type: "image", source: { type: "base64", media_type, data } };
};

/** 一則使用者訊息在 API 裡的樣子：純文字維持字串，照片和貼圖是區塊 */
function userContent(m) {
  if (m.image) return [imageBlock(m.image)];
  if (m.sticker) return [{ type: "text", text: `（傳了一張貼圖「${m.sticker.name}」）` }, imageBlock(m.sticker.src)];
  return m.text;
}

/** 對方能用的貼圖清單，附在人設後面 */
function stickerNote() {
  if (!stickers.length) return "";
  return (
    "\n\n你可以傳貼圖給對方：單獨一行只寫 [貼圖:名字]。" +
    `可用的貼圖：${stickers.map((s) => s.name).join("、")}。偶爾在適合的時候用就好。`
  );
}

/**
 * 把歷史整理成 API 要的格式：連發的訊息合併成一個 user turn；
 * 當時注入的時間以 system 訊息放在那輪回覆前面；對方的回覆原封不動回傳（含思考區塊）。
 * 歷史只會往後加、不會改，快取和思考區塊才能一直沿用。
 */
function buildMessages(ctx) {
  const out = [];
  for (const m of history) {
    if (m.role === "user") {
      const prev = out.at(-1);
      const c = userContent(m);
      if (prev?.role !== "user") out.push({ role: "user", content: c });
      else if (typeof prev.content === "string" && typeof c === "string") prev.content += "\n" + c;
      else {
        const asBlocks = (x) => (typeof x === "string" ? [{ type: "text", text: x }] : x);
        prev.content = [...asBlocks(prev.content), ...asBlocks(c)];
      }
    } else if (out.length) {
      if (m.ctx) out.push({ role: "system", content: m.ctx });
      out.push({ role: "assistant", content: m.content ?? m.text });
    }
  }
  if (ctx) out.push({ role: "system", content: ctx });
  return out;
}

async function askClaude(view) {
  const client = await getClient();
  const ctx = settings.injectTime ? timeNote() : "";
  const started = performance.now();
  const stream = client.beta.messages.stream({
    model: settings.model || DEFAULTS.model,
    max_tokens: 16000,
    system: settings.system + stickerNote(),
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: settings.effort },
    messages: buildMessages(ctx),
    // 舊的對話用快取價計費（約輸入價的一成以下），聊天間隔常超過 5 分鐘，所以用 1 小時
    cache_control: { type: "ephemeral", ttl: "1h" },
    // 被安全分類器擋下時，伺服器自動換一個模型重試
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  let thinking = "";
  let text = "";
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
  if (!text.trim()) return null;
  const u = final.usage;
  return {
    text,
    thinking,
    content: final.content,
    ctx,
    model: final.model,
    secs: (performance.now() - started) / 1000,
    usage: {
      input: u.input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      output: u.output_tokens ?? 0,
    },
  };
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

async function askDemo(view) {
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
  send({ text });
});

// ---------- 照片與貼圖 ----------

$("#pick-photo").onclick = () => $("#photo-input").click();
$("#photo-input").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (f) send({ image: await readImage(f, 1280) });
};

const stickerDlg = $("#stickers");
const grid = $("#sticker-grid");

function renderStickers() {
  grid.replaceChildren();
  for (const st of stickers) {
    const fig = document.createElement("figure");
    fig.innerHTML = `<img alt=""><figcaption></figcaption><button type="button" class="del" aria-label="刪除">×</button>`;
    fig.querySelector("img").src = st.src;
    fig.querySelector("figcaption").textContent = st.name;
    fig.onclick = (e) => {
      if (e.target.classList.contains("del")) {
        if (!confirm(`刪除貼圖「${st.name}」？`)) return;
        stickers = stickers.filter((x) => x !== st);
        idbSet("stickers", stickers);
        return renderStickers();
      }
      if (grid.classList.contains("manage")) return;
      stickerDlg.close();
      send({ sticker: { name: st.name, src: st.src } });
    };
    grid.append(fig);
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "add";
  add.textContent = "＋ 新增貼圖";
  add.onclick = () => $("#sticker-input").click();
  grid.append(add);
}

$("#open-stickers").onclick = () => {
  grid.classList.remove("manage");
  $("#stickers-manage").textContent = "管理";
  renderStickers();
  stickerDlg.showModal();
};
$("#stickers-close").onclick = () => stickerDlg.close();
$("#stickers-manage").onclick = (e) => {
  const on = grid.classList.toggle("manage");
  e.target.textContent = on ? "完成" : "管理";
};
$("#sticker-input").onchange = async (e) => {
  for (const f of e.target.files) {
    const base = f.name.replace(/\.[^.]+$/, "");
    let name = prompt("幫這張貼圖取個名字（對方會用這個名字挑貼圖）", base)?.trim();
    if (!name) continue;
    name = name.replace(/[[\]:：]/g, "");
    while (stickers.some((x) => x.name === name)) name += "2";
    stickers.push({ id: uid(), name, src: await readImage(f, 360, "image/png") });
  }
  e.target.value = "";
  idbSet("stickers", stickers).catch(() => alert("存不下了，刪掉幾張再試試。"));
  renderStickers();
};

// ---------- 設定 ----------

const dlg = $("#settings");
const fields = {
  aiName: $("#s-ai-name"), title: $("#s-title"), subtitle: $("#s-subtitle"), userName: $("#s-user-name"),
  system: $("#s-system"), apiKey: $("#s-key"), model: $("#s-model"), effort: $("#s-effort"),
  injectTime: $("#s-inject-time"), city: $("#s-city"), blur: $("#s-blur"), gray: $("#s-gray"), rain: $("#s-rain"),
};

$("#open-settings").onclick = () => {
  for (const [k, el] of Object.entries(fields)) el.type === "checkbox" ? (el.checked = settings[k]) : (el.value = settings[k]);
  dlg.showModal();
};

function readFields() {
  for (const [k, el] of Object.entries(fields)) {
    settings[k] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value.trim();
  }
  for (const k of ["aiName", "title", "subtitle", "userName", "system", "model"]) settings[k] ||= DEFAULTS[k];
  save(STORE.settings, settings);
  applyLook();
}
for (const el of Object.values(fields)) el.addEventListener("input", readFields);
dlg.addEventListener("close", () => {
  readFields();
  renderAll(); // 名字可能改了
  if (settings.city.trim() !== (geo?.query ?? "")) refreshWeather();
});

/** 圖片縮小後存成 data URL；貼圖用 PNG 保留透明背景 */
function readImage(file, max, type = "image/jpeg") {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL(type, 0.85));
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
imagePicker("#s-ai-avatar", STORE.aiAvatar, 400);
imagePicker("#s-bg", STORE.bg, 1600);
$("#s-ai-avatar-reset").onclick = () => { localStorage.removeItem(STORE.aiAvatar); applyLook(); };
$("#s-bg-reset").onclick = () => { localStorage.removeItem(STORE.bg); applyLook(); };
$("#s-clear").onclick = () => {
  if (!confirm("確定清空所有對話？")) return;
  history = [];
  persist();
  dlg.close();
};

// ---------- 開始 ----------

applyLook();
if (!history.length) {
  history.push({ id: uid(), role: "assistant", time: Date.now(), text: "嗯，你來了。\n今天想記下什麼？" });
  persist();
}
renderAll();
autosize();
input.focus({ preventScroll: true });
refreshWeather();
setInterval(refreshWeather, 30 * 60 * 1000);
