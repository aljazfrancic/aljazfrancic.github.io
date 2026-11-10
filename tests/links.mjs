// Do the external links on both pages still work? Run weekly by .github/workflows/links.yml,
// never before a deploy: other sites go down, rate-limit or turn automated requests away now
// and then, and that shouldn't hold up a change to this one.
//
//   npm run build && node tests/links.mjs [--report links.md]
//
// Broken (a 404, a dead domain, a server error that lasts) fails the run. Server errors and
// timeouts are retried for about a minute and a half: a sleeping free-tier app (edh-deck-diff on
// Render) answers 503 while it wakes up. Sites that turn automated requests away (401, 403,
// 429, LinkedIn's 999) can't be checked this way: they're listed, but don't fail it.
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const PAGES = ["dist/index.html", "dist/sl/index.html"];
const TURNED_AWAY = new Set([401, 403, 418, 429, 999]);
const AGENT = "Mozilla/5.0 (compatible; link-check)";
const PARALLEL = 6;
const RETRIES_MS = [10_000, 30_000, 50_000]; // waits before the second, third and fourth try

const urls = new Map(); // URL → pages it is on
for (const page of PAGES) {
  const html = await readFile(page, "utf8");
  for (const [, raw] of html.matchAll(/"(https?:\/\/[^"\s]+)"/g)) {
    const url = new URL(raw.replaceAll("&amp;", "&"));
    url.hash = "";
    if (url.hostname === "schema.org") continue; // the structured data's vocabulary, not a link
    urls.set(url.href, [...(urls.get(url.href) ?? []), page.replace("dist/", "")]);
  }
}

const check = async (url) => {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
        headers: { "User-Agent": AGENT, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      });
      await response.body?.cancel();
      if (response.ok) return { url, result: "ok", status: response.status };
      if (TURNED_AWAY.has(response.status)) return { url, result: "turned away", status: response.status };
      if (response.status < 500 || attempt > RETRIES_MS.length) return { url, result: "broken", status: response.status };
    } catch (error) {
      if (attempt > RETRIES_MS.length) return { url, result: "broken", status: error.cause?.code ?? error.name };
    }
    await sleep(RETRIES_MS[attempt - 1]);
  }
};

const queue = [...urls.keys()];
const results = [];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    while (queue.length) results.push(await check(queue.shift()));
  }),
);
results.sort((a, b) => a.url.localeCompare(b.url));

const line = ({ url, status }) => `- ${status} ${url} (on ${[...new Set(urls.get(url))].join(", ")})`;
const broken = results.filter((r) => r.result === "broken");
const away = results.filter((r) => r.result === "turned away");
const report = [
  `Checked ${results.length} external links on the site: ${results.length - broken.length - away.length} work, ${broken.length} broken, ${away.length} couldn't be checked.`,
  ...(broken.length ? ["", "**Broken**", "", ...broken.map(line)] : []),
  ...(away.length ? ["", "**Turned the checker away** (check these by hand now and then)", "", ...away.map(line)] : []),
].join("\n");

console.log(report);
const at = process.argv.indexOf("--report");
if (at > 0) await writeFile(process.argv[at + 1], `${report}\n`);
if (broken.length) process.exit(1);
