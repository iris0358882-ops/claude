// 背景上可以開關的效果：玻璃上的雨滴。

const rand = (a, b) => a + Math.random() * (b - a);

/** 一顆雨滴的貼圖：上緣暗、下緣亮，像玻璃上折射的水珠。 */
function makeSprite() {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const r = s / 2 - 3;

  g.fillStyle = "rgba(0,0,0,0.14)";
  g.beginPath(); g.arc(s / 2, s / 2 + 2, r, 0, Math.PI * 2); g.fill();

  const body = g.createLinearGradient(0, s / 2 - r, 0, s / 2 + r);
  body.addColorStop(0, "rgba(40,40,40,0.42)");
  body.addColorStop(0.55, "rgba(150,150,150,0.18)");
  body.addColorStop(1, "rgba(255,255,255,0.62)");
  g.fillStyle = body;
  g.beginPath(); g.arc(s / 2, s / 2, r, 0, Math.PI * 2); g.fill();

  g.strokeStyle = "rgba(30,30,30,0.22)";
  g.lineWidth = 1.5;
  g.beginPath(); g.arc(s / 2, s / 2, r - 0.5, Math.PI * 1.05, Math.PI * 1.95); g.stroke();

  g.fillStyle = "rgba(255,255,255,0.85)";
  g.beginPath(); g.ellipse(s / 2 - r * 0.35, s / 2 - r * 0.38, r * 0.18, r * 0.12, -0.6, 0, Math.PI * 2); g.fill();
  return c;
}

export function createRain(canvas) {
  const g = canvas.getContext("2d");
  const sprite = makeSprite();
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0, h = 0, dpr = 1;
  let drops = [];
  let sliders = [];
  let running = false;
  let raf = 0;
  let last = 0;

  const maxDrops = () => Math.round((w * h) / 2600);
  const newDrop = (y = rand(0, h)) => ({ x: rand(0, w), y, r: Math.random() < 0.12 ? rand(3.5, 6) : rand(0.8, 3) });
  const newSlider = (y = rand(-h * 0.5, 0)) => ({ x: rand(0, w), y, r: rand(3.5, 6.5), v: 0, wait: rand(0, 3000) });

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth;
    h = innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drops = Array.from({ length: maxDrops() }, () => newDrop());
    sliders = Array.from({ length: Math.max(4, Math.round(w / 120)) }, () => newSlider(rand(-h, h)));
    draw();
  }

  const put = (d, stretch = 1.12) => g.drawImage(sprite, d.x - d.r, d.y - d.r * stretch, d.r * 2, d.r * 2 * stretch);

  function draw() {
    g.clearRect(0, 0, w, h);
    for (const d of drops) put(d);
    for (const s of sliders) if (s.y > -10) put(s, 1.3);
  }

  function step(dt) {
    // 新的雨點打上玻璃
    for (let i = 0; i < 2; i++) if (Math.random() < 0.5) drops.push(newDrop());
    if (drops.length > maxDrops()) drops.splice(0, drops.length - maxDrops());

    for (const s of sliders) {
      if (s.wait > 0) { s.wait -= dt; continue; }
      // 走走停停地往下滑
      s.v += (Math.random() < 0.02 ? -s.v : 0.0009 * dt * s.r);
      s.v = Math.min(s.v, 0.35);
      s.y += s.v * dt;
      s.x += rand(-0.15, 0.15);
      if (Math.random() < 0.04) drops.push({ x: s.x + rand(-1, 1), y: s.y - s.r * 1.6, r: rand(0.6, 1.4) });
      // 吃掉路上的小水珠
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        if (Math.abs(d.x - s.x) < s.r && d.y > s.y - s.r && d.y < s.y + s.r * 1.5 && d.r > 0.6) {
          drops.splice(i, 1);
          s.r = Math.min(s.r + d.r * 0.04, 8);
        }
      }
      if (s.y - s.r > h) Object.assign(s, newSlider());
    }
  }

  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (t - last < 33) return; // ~30fps 就夠了
    const dt = Math.min(t - last, 100);
    last = t;
    step(dt);
    draw();
  }

  function start() {
    if (running) return;
    running = true;
    canvas.style.display = "";
    if (reduceMotion) return draw();
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    canvas.style.display = "none";
  }

  addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (!running || reduceMotion) return;
    if (document.hidden) cancelAnimationFrame(raf);
    else { last = performance.now(); raf = requestAnimationFrame(loop); }
  });
  resize();

  return { start, stop };
}
