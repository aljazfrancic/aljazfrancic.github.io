// Serves dist/ the way GitHub Pages does: a folder answers with its index.html, a folder URL
// without its trailing slash redirects to it, text is gzipped, anything else is a 404. Nothing
// is cached, so a reload always shows the latest build.
//
//   node scripts/serve.mjs [--port 8000] [--harness]
//
// --harness puts tests/harness.js at the top of every page, for the Safari tests: WebDriver
// can't read Safari's console, so the harness keeps the page's errors where a test can. It also
// puts tests/harness-worker.js in front of the backdrop's script, to log the frames it draws.
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("../dist/", import.meta.url));
const HARNESS = fileURLToPath(new URL("../tests/harness.js", import.meta.url));
const HARNESS_WORKER = fileURLToPath(new URL("../tests/harness-worker.js", import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".json", ".xml", ".txt", ".svg", ".ico"]);

const isFile = async (path) => (await stat(path).catch(() => null))?.isFile() ?? false;
const isDir = async (path) => (await stat(path).catch(() => null))?.isDirectory() ?? false;

export const serve = ({ port = 8000, harness = false } = {}) =>
  new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, "http://localhost");
        const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
        if (path !== ROOT.slice(0, -1) && !path.startsWith(ROOT)) {
          res.writeHead(403).end();
          return;
        }
        let file = path;
        if (await isDir(path)) {
          if (!url.pathname.endsWith("/")) {
            res.writeHead(301, { Location: `${url.pathname}/${url.search}` }).end();
            return;
          }
          file = join(path, "index.html");
        }
        if (!(await isFile(file))) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
          return;
        }
        const ext = extname(file);
        let body = await readFile(file);
        if (harness && ext === ".html") {
          const script = `<script>${await readFile(HARNESS, "utf8")}</script>`;
          body = Buffer.from(body.toString("utf8").replace("<head>", `<head>${script}`));
        }
        if (harness && url.pathname === "/assets/landscape.js") body = Buffer.concat([await readFile(HARNESS_WORKER), body]);
        const headers = { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "no-cache" };
        if (COMPRESSIBLE.has(ext)) {
          headers.Vary = "Accept-Encoding";
          if (/\bgzip\b/.test(req.headers["accept-encoding"] ?? "")) {
            body = gzipSync(body);
            headers["Content-Encoding"] = "gzip";
          }
        }
        headers["Content-Length"] = body.length;
        res.writeHead(200, headers).end(req.method === "HEAD" ? undefined : body);
      } catch (error) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end(String(error));
      }
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--port");
  const port = at >= 0 ? Number(args[at + 1]) : 8000;
  await serve({ port, harness: args.includes("--harness") });
  console.log(`Serving dist${sep} at http://127.0.0.1:${port}/`);
}
