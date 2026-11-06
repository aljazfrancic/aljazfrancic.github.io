// Backdrop: a slow flight over Perlin-noise terrain, after "Perlin Landscape" in
// https://aljazfrancic.github.io/generative-art-gallery/ (same camera, hidden lines and fog,
// on a plain canvas without p5), drawn upside down so it hangs from the top of the page and
// scrolls away with it. Decoration only: without JavaScript there is simply no backdrop.
(() => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.className = "backdrop";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);

  // Slower than the gallery's flight, but livelier: taller hills, slow swells rolling through
  // the terrain, and a camera that drifts from side to side.
  const SPEED = 0.35; // rows flown per second
  const SWELL = 0.09; // height of the rolling swells, in noise units
  const SWAY = 5; // columns the camera drifts either side
  const SWAY_S = 80; // seconds per drift there and back
  const NOISE = 0.1; // noise step per grid cell
  const GRID = 26; // larger means fewer rows
  const HORIZON = 0.45; // share of the height between the horizon and the nearest row
  const SHADES = 8; // edges are stroked in batches: height shade × fog level
  const FOGS = 8;
  const FRAME_MS = 1000 / 24; // a slow drift needs no more than 24 fps
  const FADE_MS = 350; // matches the page's theme cross-fade

  // Value noise: a hashed lattice, smoothstep-interpolated, four octaves; 0..1 around 0.5.
  const seed = (Math.random() * 0x7fffffff) | 0;
  const hash = (x, y) => {
    let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  };
  const lattice = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let u = x - xi;
    let v = y - yi;
    u = u * u * (3 - 2 * u);
    v = v * v * (3 - 2 * v);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const noise = (x, y) => {
    let sum = 0;
    for (let o = 0, amp = 0.5, f = 1; o < 4; o++, amp /= 2, f *= 2) sum += amp * lattice(x * f + o * 17.3, y * f);
    return sum / 0.9375;
  };

  // Colours come from CSS (the canvas's color and border colour), so they follow the theme.
  const parse = (css) => (css.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const read = () => {
    const cs = getComputedStyle(canvas);
    return [parse(cs.borderTopColor), parse(cs.color)];
  };
  let from = read();
  let to = from;
  let fadeStart = -Infinity;
  const colours = (now) => {
    const t = Math.min(1, (now - fadeStart) / FADE_MS);
    return [mix(from[0], to[0], t), mix(from[1], to[1], t)];
  };
  const recolour = () => {
    const now = performance.now();
    from = colours(now);
    to = read();
    fadeStart = now;
    schedule();
  };

  let styles = [];
  let glow = [];
  let stylesKey = "";
  const prepare = (now) => {
    const [low, high] = colours(now);
    const key = `${low}|${high}`;
    if (key === stylesKey) return;
    styles = [];
    for (let f = 0; f < FOGS; f++) {
      const alpha = 1 - ((f + 0.5) / FOGS) ** 1.3 * 0.94; // far rows fade out
      for (let s = 0; s < SHADES; s++) {
        const [r, g, b] = mix(low, high, (s + 0.5) / SHADES).map(Math.round);
        styles.push(`rgba(${r},${g},${b},${alpha.toFixed(3)})`);
      }
    }
    const [r, g, b] = high.map(Math.round);
    glow = [`rgba(${r},${g},${b},0)`, `rgba(${r},${g},${b},0.14)`];
    stylesKey = key;
  };

  let w = 0;
  let h = 0;
  let travel = 0; // rows flown so far
  let clock = 0; // seconds of motion so far (stops while paused)
  let quality = 1; // share of the full row count, lowered on slow devices
  const rows = []; // projected rows, nearest first
  const batches = Array.from({ length: SHADES }, () => []);
  const shadeOf = (v) => Math.min(SHADES - 1, Math.max(0, Math.floor(((v - 0.25) / 0.5) * SHADES)));

  // Fade towards the page below: full strength over the top third of the screen, gone near the
  // bottom of the backdrop. Done per strip with globalAlpha (a CSS mask or a full-canvas blend
  // would cost a whole extra pass on every frame). y is in unflipped canvas units: h is the top.
  const fadeAt = (y) => Math.min(1, Math.max(0, (y / h - 0.08) / 0.57));

  const render = (now) => {
    ctx.clearRect(0, 0, w, h);
    if (w < 1 || h < 1) return;
    prepare(now);

    // Camera: the nearest row meets the bottom edge, the farthest sits just below the horizon.
    const horizon = h * HORIZON;
    const focal = h * 1.15;
    const zNear = focal * 0.5;
    const camHeight = (h - horizon) * (zNear / focal);
    const depth = focal * 5.5;
    const full = Math.min(70, Math.max(20, (1500 / GRID) * Math.sqrt(h / 800)));
    const rowCount = Math.max(12, Math.round(full * quality));
    const spacing = depth / rowCount;
    const amp = camHeight * 0.7;
    const base = Math.floor(travel);
    const frac = travel - base;
    const camX = SWAY * Math.sin((clock * 2 * Math.PI) / SWAY_S);
    const cBase = Math.floor(camX);
    const cFrac = camX - cBase;

    const sky = ctx.createLinearGradient(0, horizon - h * 0.22, 0, horizon + h * 0.1);
    sky.addColorStop(0, glow[0]);
    sky.addColorStop(0.8, glow[1]);
    sky.addColorStop(1, glow[0]);
    ctx.fillStyle = sky;
    ctx.globalAlpha = fadeAt(horizon);
    ctx.fillRect(0, horizon - h * 0.22, w, h * 0.32);
    ctx.globalAlpha = 1;

    // Extra rows in front of the camera carry the terrain past the edge it starts from (the top
    // of the page, once flipped), so no hill leaves a bare strip there.
    let lead = 0;
    while (lead < 2 && zNear + (-lead - 1 - frac) * spacing > focal * 0.12) lead++;
    const farthest = rowCount + lead;

    // Project the visible stretch of every row. The terrain is fixed in the world; the camera moves.
    for (let j = 0; j <= farthest; j++) {
      const k = j - lead; // rows behind the nearest regular one are negative
      const z = zNear + (k - frac) * spacing;
      const s = focal / Math.max(z, 1);
      const half = Math.ceil(w / 2 / s / spacing) + 1;
      const n = half * 2 + 1;
      let row = rows[j];
      if (!row || row.sx.length < n) {
        row = rows[j] = { sx: new Float32Array(n + 16), sy: new Float32Array(n + 16), hv: new Float32Array(n + 16) };
      }
      row.c0 = -half;
      row.n = n;
      row.z = z;
      const rz = base + k; // world row
      const nz = rz * NOISE;
      for (let i = 0; i < n; i++) {
        const c = i - half;
        const wc = c + cBase; // world column under the drifting camera
        const v = noise(wc * NOISE, nz) + SWELL * Math.sin(wc * 0.3 + rz * 0.22 - clock * 0.45);
        row.sx[i] = w / 2 + (c - cFrac) * spacing * s;
        const sy = horizon + (camHeight - (v - 0.5) * 2 * amp) * s;
        row.sy[i] = j === 0 ? Math.max(sy, h + 4) : sy; // the nearest row always lies past the edge
        row.hv[i] = v;
      }
    }

    // Strips between neighbouring rows, far to near. Each one first erases what it hides, then
    // strokes its far and side edges; its near edge is the next strip's far edge.
    ctx.lineWidth = 1;
    for (let j = farthest - 1; j >= 0; j--) {
      const near = rows[j];
      const far = rows[j + 1];
      const first = Math.max(near.c0, far.c0);
      const quads = Math.min(near.c0 + near.n, far.c0 + far.n) - 1 - first;
      if (quads < 1) continue;
      const a = first - near.c0;
      const b = first - far.c0;
      const fog = Math.min(FOGS - 1, Math.max(0, Math.floor(((near.z - zNear) / depth) * FOGS)));

      ctx.globalAlpha = 1; // erasing is always complete
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.moveTo(far.sx[b], far.sy[b]);
      for (let i = 1; i <= quads; i++) ctx.lineTo(far.sx[b + i], far.sy[b + i]);
      for (let i = quads; i >= 0; i--) ctx.lineTo(near.sx[a + i], near.sy[a + i]);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";

      for (let i = 0; i <= quads; i++) {
        const f = b + i;
        const n = a + i;
        if (i < quads) {
          batches[shadeOf((far.hv[f] + far.hv[f + 1]) / 2)].push(far.sx[f], far.sy[f], far.sx[f + 1], far.sy[f + 1]);
          if (j === 0) {
            batches[shadeOf((near.hv[n] + near.hv[n + 1]) / 2)].push(near.sx[n], near.sy[n], near.sx[n + 1], near.sy[n + 1]);
          }
        }
        batches[shadeOf((far.hv[f] + near.hv[n]) / 2)].push(far.sx[f], far.sy[f], near.sx[n], near.sy[n]);
      }
      ctx.globalAlpha = fadeAt(far.sy[b + (quads >> 1)]);
      for (let shade = 0; shade < SHADES; shade++) {
        const segs = batches[shade];
        if (segs.length === 0) continue;
        ctx.strokeStyle = styles[fog * SHADES + shade];
        ctx.beginPath();
        for (let i = 0; i < segs.length; i += 4) {
          ctx.moveTo(segs[i], segs[i + 1]);
          ctx.lineTo(segs[i + 2], segs[i + 3]);
        }
        ctx.stroke();
        segs.length = 0;
      }
    }

    ctx.globalAlpha = 1;
  };

  // Size the canvas to its box, drawn upside down. Its CSS height is the large viewport, so a
  // phone's address bar sliding in and out doesn't resize it. Big or dense screens get fewer
  // device pixels.
  let dprCap = 1.5;
  const fit = () => {
    const box = canvas.getBoundingClientRect();
    w = box.width;
    h = box.height;
    if (w < 1 || h < 1) return;
    let dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    if (w * h * dpr * dpr > 0.9e6) dpr = Math.max(1, Math.sqrt(0.9e6 / (w * h)));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(canvas.width / w, 0, 0, -canvas.height / h, 0, canvas.height);
    render(performance.now()); // resizing cleared the canvas: redraw before it is painted
    schedule(); // resumes the flight if the canvas was hidden
  };

  // Animate unless the visitor asked for less motion or less data, or the device is too slow.
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const saveData = navigator.connection?.saveData === true;
  let gaveUp = false;
  let started = false; // the flight waits until the page has loaded and the browser is idle
  const moving = () => started && !still.matches && !saveData && !gaveUp;

  // Too slow? Judged on both the script's own time and how late frames actually arrive (which
  // includes drawing and compositing). After eight slow frames: fewer rows at one pixel per CSS
  // pixel; after eight more: a still frame.
  let cost = 0;
  let late = 0;
  let frames = 0;
  const adapt = (ms, gap) => {
    cost = frames === 0 ? ms : cost * 0.9 + ms * 0.1;
    late = frames === 0 ? FRAME_MS : late * 0.8 + gap * 0.2;
    frames++;
    if (frames < 8 || (cost < 6 && late < FRAME_MS * 1.6)) return;
    frames = 0;
    if (quality === 1) {
      quality = 0.7; // first step: fewer rows at one pixel per CSS pixel
      dprCap = 1;
      fit();
    } else gaveUp = true; // still too slow: hold a still frame
  };

  let raf = 0;
  let last = 0;
  let onScreen = true;
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };
  const frame = (now) => {
    raf = 0;
    if (w < 1 || h < 1) return; // hidden (print, high contrast): wait for the next resize
    if (!onScreen) return; // scrolled away: wait until it comes back
    const go = moving();
    const gap = now - last;
    if (go) {
      if (gap < FRAME_MS - 2) return schedule();
      const dt = Math.min(gap, 100) / 1000; // no jump after a hidden tab
      travel += SPEED * dt * Math.min(1, clock / 3); // eases into the flight over three seconds
      clock += dt;
    }
    last = now;
    const t0 = performance.now();
    render(now);
    if (go) adapt(performance.now() - t0, gap > 200 ? FRAME_MS : gap); // a long gap is a pause, not a slow frame
    if (go || now - fadeStart < FADE_MS) schedule();
  };

  new ResizeObserver(fit).observe(canvas);
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    if (onScreen) schedule();
  }).observe(canvas);
  document.getElementById("theme-toggle")?.addEventListener("change", recolour);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", recolour);
  addEventListener("pageshow", recolour);
  still.addEventListener("change", schedule);
  const start = () => {
    started = true;
    schedule();
  };
  const whenIdle = () => (window.requestIdleCallback ? requestIdleCallback(start, { timeout: 3000 }) : setTimeout(start, 500));
  if (document.readyState === "complete") whenIdle();
  else addEventListener("load", whenIdle, { once: true });
  schedule();
})();
