// Local preview: builds the site, serves it at http://127.0.0.1:8000/ and builds it again whenever
// a source changes (site.toml, the template, the stylesheet, the assets). Reload the page to see it.
//
//   npm run dev [-- --port 8000]
import { spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const IGNORED = /^(dist|node_modules|test-results|playwright-report|lighthouse-reports|\.git)(\/|$)/;
const args = process.argv.slice(2);
const port = args.includes("--port") ? Number(args[args.indexOf("--port") + 1]) : 8000;

// In a fresh process each time, so a changed template is loaded anew.
const build = () => spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: root, stdio: "inherit" }).status === 0;

build();
await serve({ port });
console.log(`Serving at http://127.0.0.1:${port}/ and rebuilding on changes (Ctrl+C stops).`);

let timer;
watch(root, { recursive: true }, (_, file) => {
  if (!file || IGNORED.test(file)) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`${file} changed.`);
    if (!build()) console.log("The build failed: the server still has the last good build.");
  }, 150);
});
