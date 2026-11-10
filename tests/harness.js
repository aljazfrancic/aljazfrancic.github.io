// Test harness, never published: scripts/serve.mjs --harness puts this at the top of each page
// for the Safari tests. WebDriver can't read Safari's console, so the page's errors are kept in
// window.__errors instead: uncaught errors (a worker's included, they bubble up to the page),
// rejected promises, resources that failed to load, and console.error calls. The scripts of
// the workers the page starts go in window.__workers, which is how a test sees that the
// backdrop draws in one, and the times its frames were drawn (see harness-worker.js) in
// window.__frames.
(() => {
  const errors = (window.__errors = []);
  const workers = (window.__workers = []);
  window.__frames = [];
  if (window.Worker) {
    window.Worker = new Proxy(window.Worker, {
      construct(Worker, args) {
        workers.push(String(args[0]));
        const worker = new Worker(...args);
        worker.addEventListener("message", ({ data }) => {
          if (data && data.harnessFrames) window.__frames = data.harnessFrames;
        });
        return worker;
      },
    });
  }
  addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (target && target !== window) errors.push(`failed to load: ${target.src || target.href || target.tagName}`);
      else errors.push(`${event.message} (${event.filename}:${event.lineno})`);
    },
    true,
  );
  addEventListener("unhandledrejection", (event) => errors.push(`unhandled rejection: ${event.reason}`));
  const original = console.error;
  console.error = (...args) => {
    errors.push(args.map(String).join(" "));
    original.apply(console, args);
  };
})();
