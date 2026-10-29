import { createRain } from "./rain.js";

const SDK_URL = "./vendor/anthropic-sdk.js"; // @anthropic-ai/sdk 1.3.0，已打包成瀏覽器可用的單檔
const STORE = { settings: "grey.settings", history: "grey.history", aiAvatar: "grey.aiAvatar", bg: "grey.bg" };
const REPLY_DELAY = 1100; // 停止輸入多久後對方才回（可以連發好幾則）
const DEFAULTS = {
  aiName: "Grey",
  title: "Grey",
  subtitle: "手帳",
  userName: "我",
  system:
    "你是 Grey，正在用通訊軟體跟對方聊天。\n" +
    "說話簡短、口語、有點冷但很在乎對方。\n" +
    "每一句話單獨一行（用換行分開），像一則一則傳訊息，一次最多四五行。\n" +
    "不要用 Markdown 標題或清單，不要用表情符號。用繁體中文。",
  apiKey: "",
  model: "claude-opus-5-5",
  effort: "low",
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

// 從別的主題換過來時，背景改用這個主題的預設（不模糊、不去色、不下雨）
const stored = load(STORE.settings, {});
if (stored.theme !== "scrapbook") {
  delete stored.blur; delete stored.gray; delete stored.rain;
  if (["觀測記錄", "夜間筆記"].includes(stored.subtitle)) delete stored.subtitle;
}
const settings = { ...DEFAULTS, ...stored, theme: "scrapbook" };

/**
 * ctx 是更早的版本每輪注入的時間；那些回覆要原樣送回，所以保留。
 * @type {{id:string, role:'user'|'assistant', text:string, time:number, thinking?:string, content?:any[], ctx?:string}[]}
 */
let history = load(STORE.history, null) ?? (await fromLaterVersion());

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

// ---------- 渲染 ----------

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

  const lines = document.createElement("div");
  lines.className = "turn lines";
  const sig = document.createElement("div");
  sig.className = "sig";

  g.append(sealed, lines, sig);
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
      if (!rendered.length && sealed.hidden) g.remove();
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

// ---------- 對話流程 ----------

let replyTimer = 0;
let generating = false;

function persist() {
  if (!save(STORE.history, history)) notice("瀏覽器的儲存空間滿了，最新的對話可能不會被記住。", "error");
}

function send(text) {
  const msg = { id: uid(), role: "user", text, time: Date.now() };
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

/**
 * 把歷史整理成 API 要的格式：連發的訊息合併成一個 user turn；對方的回覆原封不動回傳（含思考區塊）。
 * 歷史只會往後加、不會改，思考區塊才能一直沿用。
 */
function buildMessages() {
  const out = [];
  for (const m of history) {
    if (m.role === "user") {
      const prev = out.at(-1);
      if (prev?.role === "user") prev.content += "\n" + m.text;
      else out.push({ role: "user", content: m.text });
    } else if (out.length) {
      if (m.ctx) out.push({ role: "system", content: m.ctx });
      out.push({ role: "assistant", content: m.content ?? m.text });
    }
  }
  return out;
}

async function askClaude(view) {
  const client = await getClient();
  const stream = client.beta.messages.stream({
    model: settings.model || DEFAULTS.model,
    max_tokens: 16000,
    system: settings.system,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: settings.effort },
    messages: buildMessages(),
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
  return { text, thinking, content: final.content };
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
  send(text);
});

// ---------- 設定 ----------

const dlg = $("#settings");
const fields = {
  aiName: $("#s-ai-name"), title: $("#s-title"), subtitle: $("#s-subtitle"), userName: $("#s-user-name"),
  system: $("#s-system"), apiKey: $("#s-key"), model: $("#s-model"), effort: $("#s-effort"),
  blur: $("#s-blur"), gray: $("#s-gray"), rain: $("#s-rain"),
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
