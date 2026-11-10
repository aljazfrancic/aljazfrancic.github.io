// Test harness, never published: scripts/serve.mjs --harness puts this in front of
// assets/landscape.js for the Safari tests. In the backdrop's worker it notes when each frame is
// drawn (every frame starts by clearing the canvas) and what the page told it (size, colours,
// show, calm, start), and reports both to the page twice a second, where tests/harness.js keeps
// them in window.__frames and window.__told. On the page itself it does nothing.
if (typeof document === "undefined" && typeof OffscreenCanvasRenderingContext2D === "function") {
  const frames = [];
  const told = [];
  addEventListener("message", ({ data }) => {
    const at = Math.round(performance.now());
    if (told.length < 200) told.push(data.canvas ? `canvas@${at}` : `${data[0]}(${data.slice(1).map((v) => (typeof v === "number" ? Math.round(v) : JSON.stringify(v))).join(",")})@${at}`);
  });
  const clear = OffscreenCanvasRenderingContext2D.prototype.clearRect;
  OffscreenCanvasRenderingContext2D.prototype.clearRect = function (...args) {
    if (frames.length < 5000) frames.push(Math.round(performance.now()));
    return clear.apply(this, args);
  };
  setInterval(() => postMessage({ harnessFrames: frames, harnessTold: told }), 500);
}
