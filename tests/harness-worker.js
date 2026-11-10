// Test harness, never published: scripts/serve.mjs --harness puts this in front of
// assets/landscape.js for the Safari tests. In the backdrop's worker it notes when each frame is
// drawn (every frame starts by clearing the canvas) and reports the list to the page twice a
// second, where tests/harness.js keeps it in window.__frames. On the page itself it does nothing.
if (typeof document === "undefined" && typeof OffscreenCanvasRenderingContext2D === "function") {
  const frames = [];
  const clear = OffscreenCanvasRenderingContext2D.prototype.clearRect;
  OffscreenCanvasRenderingContext2D.prototype.clearRect = function (...args) {
    if (frames.length < 5000) frames.push(Math.round(performance.now()));
    return clear.apply(this, args);
  };
  setInterval(() => postMessage({ harnessFrames: frames }), 500);
}
