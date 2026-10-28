import { drawScene, createRain } from "./rain.js";

const SDK_URL = "./vendor/anthropic-sdk.js"; // @anthropic-ai/sdk 1.3.0，已打包成瀏覽器可用的單檔
const STORE = { settings: "grey.settings", history: "grey.history", avatar: "grey.avatar", bg: "grey.bg" };
const REPLY_DELAY = 1100; // 停止輸入多久後對方才回（可以連發好幾則）

const DEFAULTS = {
  aiName: "Grey",
  system:
    "你是 Grey，正在用通訊軟體跟對方聊天。\n" +
    "說話簡短、口語、有點冷但很在乎對方。\n" +
    "每一句話單獨一行（用換行分開），像一則一則傳訊息，一次最多四五行。\n" +
    "不要用 Markdown 標題或清單，不要用表情符號。用繁體中文。",
  apiKey: "",
  model: "claude-opus-5-5",
  effort: "low",
  blur: 14,
  gray: true,
  rain: true,
};

// ---------- 儲存 ----------

const load = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
};
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
};

const settings = { ...DEFAULTS, ...load(STORE.settings, {}) };
/** @type {{id:string, role:'user'|'assistant', text:string, time:number, thinking?:string, content?:any[]}[]} */
let history = load(STORE.history, []);

const $ = (s) => document.querySelector(s);
const chat = $("#chat");
const input = $("#input");
const sendBtn = $("#send");
const status = $("#status");

// ---------- 背景 ----------

drawScene($("#scene"));
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

  $("#ai-name-top").textContent = settings.aiName;
  document.title = settings.aiName;
}

// ---------- 渲染 ----------

const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (t) => { const d = new Date(t); return `${d.getHours()}:${pad(d.getMinutes())}`; };
const uid = () => Math.random().toString(36).slice(2, 10);

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const inline = (s) =>
  escapeHtml(s)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");

/** 把一段回覆拆成一則一則泡泡：每行一則，程式碼區塊整塊一則。 */
function toBubbles(text) {
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

function bubbleHtml(b) {
  return b.code != null ? `<code style="display:block;white-space:pre;overflow-x:auto">${escapeHtml(b.code)}</code>` : inline(b.text);
}

function avatarEl(role) {
  const el = document.createElement("div");
  el.className = `avatar ${role === "user" ? "me" : "ai"}`;
  if (role === "user") {
    const img = load(STORE.avatar, null);
    el.style.backgroundImage = img ? `url("${img}")` : defaultAvatar;
  }
  return el;
}

// 預設的「我」：一個灰白小貓臉
const defaultAvatar = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><radialGradient id='g' cx='.5' cy='.35' r='.8'><stop offset='0' stop-color='#fafafa'/><stop offset='1' stop-color='#bdbdbf'/></radialGradient></defs><rect width='100' height='100' fill='#3a3a3c'/><path d='M22 44 L28 20 L42 34 Q50 31 58 34 L72 20 L78 44 Q84 74 50 80 Q16 74 22 44Z' fill='url(#g)'/><path d='M36 52 q4 -4 8 0 M56 52 q4 -4 8 0' stroke='#333' stroke-width='3' fill='none' stroke-linecap='round'/><path d='M44 62 q3 4 6 0 q3 4 6 0' stroke='#333' stroke-width='2.5' fill='none' stroke-linecap='round'/></svg>`,
)}")`;

const tickSvg = `<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="tk" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9fd3ff"/><stop offset=".5" stop-color="#b9a4ff"/><stop offset="1" stop-color="#ff9fd0"/></linearGradient></defs><path d="M4.5 12.5l4.5 4.5L19.5 6" fill="none" stroke="url(#tk)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const chevronSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>`;

function nearBottom() {
  return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 120;
}
function scrollDown(force = false) {
  if (force || nearBottom()) requestAnimationFrame(() => (chat.scrollTop = chat.scrollHeight));
}

/** 使用者連發的訊息放在同一組 */
function userGroup() {
  const lastEl = chat.lastElementChild;
  if (lastEl?.classList.contains("me")) return lastEl;
  const g = document.createElement("section");
  g.className = "group me";
  chat.append(g);
  return g;
}

function renderUser(msg) {
  const g = userGroup();
  for (const b of toBubbles(msg.text)) {
    const row = document.createElement("div");
    row.className = "row-msg";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = bubbleHtml(b);
    row.append(bubble, avatarEl("user"));
    g.append(row);
  }
}

/** 對方的一組回覆：名字 ✓ 思考摘要 ^ / 泡泡們 / 時間。回傳可以邊收邊更新的控制器。 */
function renderAssistant(msg = {}) {
  const g = document.createElement("section");
  g.className = "group ai";

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.innerHTML = `<span class="nm"></span>${tickSvg}`;
  meta.querySelector(".nm").textContent = settings.aiName;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "think-toggle";
  toggle.innerHTML = `<span class="lbl">思考摘要</span>${chevronSvg}`;
  toggle.setAttribute("aria-expanded", "false");
  toggle.hidden = true;
  meta.append(toggle);

  const thinking = document.createElement("div");
  thinking.className = "thinking";
  thinking.hidden = true;
  toggle.onclick = () => {
    const open = thinking.hidden;
    thinking.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) thinking.scrollTop = thinking.scrollHeight;
  };

  const bubbles = document.createElement("div");
  bubbles.className = "group";
  const time = document.createElement("div");
  time.className = "time";

  g.append(meta, thinking, bubbles, time);
  chat.append(g);

  let rows = [];
  let typingRow = null;

  const view = {
    el: g,
    typing(on) {
      if (on && !typingRow) {
        typingRow = document.createElement("div");
        typingRow.className = "row-msg";
        typingRow.innerHTML = `<div class="bubble typing"><i></i><i></i><i></i></div>`;
        typingRow.prepend(avatarEl("assistant"));
        if (rows.length) typingRow.firstChild.classList.add("ghost");
        bubbles.append(typingRow);
      } else if (!on && typingRow) {
        typingRow.remove();
        typingRow = null;
      }
      scrollDown();
    },
    setThinking(text, live = false) {
      if (!text) return;
      toggle.hidden = false;
      toggle.classList.toggle("live", live);
      thinking.textContent = text;
      if (!thinking.hidden) thinking.scrollTop = thinking.scrollHeight;
    },
    setText(text) {
      const list = toBubbles(text);
      list.forEach((b, i) => {
        let row = rows[i];
        if (!row) {
          row = document.createElement("div");
          row.className = "row-msg";
          const av = avatarEl("assistant");
          if (i > 0) av.classList.add("ghost");
          const bubble = document.createElement("div");
          bubble.className = "bubble";
          row.append(av, bubble);
          bubbles.insertBefore(row, typingRow);
          rows.push(row);
          if (typingRow) typingRow.firstChild.classList.add("ghost");
        }
        const html = bubbleHtml(b);
        if (row.lastChild.innerHTML !== html) row.lastChild.innerHTML = html;
      });
      scrollDown();
    },
    finish(t) {
      view.typing(false);
      toggle.classList.remove("live");
      time.textContent = fmtTime(t);
      if (!rows.length && toggle.hidden) g.remove();
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
  scrollDown(true);
}

// ---------- 對話流程 ----------

let replyTimer = 0;
let generating = false;

function persist() {
  if (!save(STORE.history, history)) {
    // 存不下就丟掉最舊的紀錄
    history = history.slice(Math.floor(history.length / 3));
    save(STORE.history, history);
  }
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
  status.textContent = "輸入中";
  status.classList.add("busy");

  const view = renderAssistant();
  view.typing(true);
  try {
    const result = settings.apiKey ? await askClaude(view) : await askDemo(view);
    if (result) {
      const msg = { id: uid(), role: "assistant", time: Date.now(), ...result };
      history.push(msg);
      persist();
      view.finish(msg.time);
    } else {
      view.finish(Date.now());
    }
  } catch (err) {
    view.finish(Date.now());
    notice(errorText(err), "error");
  } finally {
    generating = false;
    status.textContent = "在線";
    status.classList.remove("busy");
    if (history.at(-1)?.role === "user" && !document.querySelector(".notice.error:last-child")) scheduleReply();
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

/** 把歷史整理成 API 要的格式：連發的訊息合併成一個 user turn；對方的回覆原封不動回傳（含思考區塊）。 */
function buildMessages() {
  const out = [];
  for (const m of history) {
    if (m.role === "user") {
      const prev = out.at(-1);
      if (prev?.role === "user") prev.content += "\n" + m.text;
      else out.push({ role: "user", content: m.text });
    } else if (out.length) {
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
  // 只留下 API 需要回傳的區塊，存回歷史時保持原樣
  return { text, thinking, content: final.content };
}

// ---------- 示範模式（沒有 API Key 時） ----------

const DEMO = [
  {
    thinking: "對方又來找我了。\n語氣聽起來有點撒嬌，先別戳破，順著接一下。\n回短一點，留點空間給對方說。",
    text: "嗯，我知道。\n你一開口我就知道你要什麼了。\n先說說今天怎麼了。",
  },
  {
    thinking: "外面在下雨，提一下天氣，讓對話有畫面感。\n然後把話題丟回去。",
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function askDemo(view) {
  const pick = DEMO[demoIndex++ % DEMO.length];
  let t = "";
  for (const ch of pick.thinking) {
    t += ch;
    view.setThinking(t, true);
    await sleep(14);
  }
  const lines = pick.text.split("\n");
  let shown = "";
  for (const line of lines) {
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
  aiName: $("#s-ai-name"), system: $("#s-system"), apiKey: $("#s-key"), model: $("#s-model"),
  effort: $("#s-effort"), blur: $("#s-blur"), gray: $("#s-gray"), rain: $("#s-rain"),
};

$("#open-settings").onclick = () => {
  for (const [k, el] of Object.entries(fields)) el.type === "checkbox" ? (el.checked = settings[k]) : (el.value = settings[k]);
  dlg.showModal();
};

function readFields() {
  for (const [k, el] of Object.entries(fields)) {
    settings[k] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value.trim();
  }
  settings.aiName ||= DEFAULTS.aiName;
  settings.system ||= DEFAULTS.system;
  settings.model ||= DEFAULTS.model;
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

$("#s-avatar").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (!save(STORE.avatar, await readImage(f, 256))) alert("圖片太大，存不下。");
  e.target.value = "";
};
$("#s-avatar-reset").onclick = () => localStorage.removeItem(STORE.avatar);
$("#s-bg").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (!save(STORE.bg, await readImage(f, 1600))) alert("圖片太大，存不下。");
  e.target.value = "";
  applyLook();
};
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
  history.push({
    id: uid(), role: "assistant", time: Date.now(),
    text: "嗯，你來了。\n外面在下雨。",
  });
  persist();
}
renderAll();
autosize();
input.focus({ preventScroll: true });
