// Checks that don't depend on the browser engine, so they run once: every local reference
// resolves, the metadata in <head> agrees with itself and with the sitemap, the copy rules hold.
import { expect, test } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const SITE = "https://aljazfrancic.github.io/";
const PAGES = [
  { path: "/", url: SITE, lang: "en-GB", locale: "en_GB", alternate: "sl_SI" },
  { path: "/sl/", url: `${SITE}sl/`, lang: "sl", locale: "sl_SI", alternate: "en_GB" },
];
const ALTERNATES = { en: SITE, sl: `${SITE}sl/`, "x-default": SITE };

// A URL on the live site, as the matching path on the local server.
const local = (url) => (url.startsWith(SITE) ? `/${url.slice(SITE.length)}` : url);

test("every file the pages, the stylesheet, the metadata and the sitemap refer to exists", async ({ page, request, baseURL }) => {
  const refs = new Map(); // URL → where it was found
  const add = (url, where) => {
    const target = new URL(url, baseURL);
    target.hash = "";
    if (target.origin === new URL(baseURL).origin && !refs.has(target.href)) refs.set(target.href, where);
  };

  for (const { path } of PAGES) {
    await page.goto(path);
    const found = await page.evaluate(() => {
      const urls = [];
      for (const element of document.querySelectorAll("[href], [src], [srcset]")) {
        for (const name of ["href", "src"]) if (element.hasAttribute(name)) urls.push(element.getAttribute(name));
        for (const candidate of element.getAttribute("srcset")?.split(",") ?? []) urls.push(candidate.trim().split(/\s+/)[0]);
      }
      // Absolute URLs of the live site that are this site's own files: share images, canonical
      // and language links, the images in the structured data. (Links in the page to the
      // project sites under the same domain are other repositories.)
      const live = [];
      for (const meta of document.querySelectorAll('meta[property$=":image"], meta[name$=":image"]')) live.push(meta.content);
      for (const link of document.querySelectorAll('link[rel="canonical"], link[rel="alternate"]')) live.push(link.getAttribute("href"));
      const graph = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)["@graph"];
      for (const node of graph) if (node.image?.contentUrl) live.push(node.image.contentUrl);
      return { page: urls.map((url) => new URL(url, document.baseURI).href), live };
    });
    for (const url of found.page) add(url, path);
    for (const url of found.live) add(local(url), path);

    // Same-page anchors point at an element that exists ("#top" is the top of the page by definition).
    const anchors = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href").slice(1)).filter((id) => id !== "top" && !document.getElementById(id)),
    );
    expect(anchors, `${path}: anchors without a target`).toEqual([]);
  }

  // Inline SVGs (data: URLs) are dropped first: their own url(#…) references aren't files.
  const css = (await (await request.get("/styles.css")).text()).replace(/url\(\s*(["'])data:.*?\1\s*\)/g, "");
  for (const [, url] of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) add(new URL(url, `${baseURL}/styles.css`).href, "styles.css");

  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const [, url] of sitemap.matchAll(/(?:<loc>|<image:loc>|href=")([^<"]+)/g)) add(local(url), "sitemap.xml");
  const robots = await (await request.get("/robots.txt")).text();
  for (const [, url] of robots.matchAll(/^Sitemap:\s*(\S+)/gm)) add(local(url), "robots.txt");

  const missing = [];
  for (const [url, where] of refs) {
    const response = await request.get(url, { maxRedirects: 0 });
    if (response.status() !== 200) missing.push(`${response.status()} ${new URL(url).pathname} (in ${where})`);
  }
  expect(missing).toEqual([]);
  expect(refs.size).toBeGreaterThan(30); // a sanity check of the collection itself
});

for (const { path, url, lang, locale, alternate } of PAGES) {
  test(`${path}: the metadata in <head> agrees with itself`, async ({ page }) => {
    await page.goto(path);
    const head = await page.evaluate(() => {
      const meta = (key) => document.querySelector(`meta[property="${key}"], meta[name="${key}"]`)?.content;
      return {
        lang: document.documentElement.lang,
        title: document.title,
        description: meta("description"),
        canonical: document.querySelector('link[rel="canonical"]')?.href,
        alternates: Object.fromEntries([...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((link) => [link.hreflang, link.href])),
        og: { url: meta("og:url"), locale: meta("og:locale"), alternate: meta("og:locale:alternate"), image: meta("og:image"), description: meta("og:description") },
        twitter: { image: meta("twitter:image"), description: meta("twitter:description") },
        size: [meta("og:image:width"), meta("og:image:height")].map(Number),
        jsonld: document.querySelector('script[type="application/ld+json"]').textContent,
      };
    });

    expect(head.lang).toBe(lang);
    expect(head.title).not.toBe("");
    expect(head.description).toBeTruthy();
    expect(head.canonical).toBe(url);
    expect(head.og.url).toBe(url);
    expect(head.og.locale).toBe(locale);
    expect(head.og.alternate).toBe(alternate);
    expect(head.alternates).toEqual(ALTERNATES);
    expect(head.twitter.image).toBe(head.og.image);
    expect(head.twitter.description).toBe(head.og.description);

    // The share card really is the size the tags say.
    const size = await page.evaluate(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }, local(head.og.image));
    expect(size).toEqual(head.size);

    // Structured data: valid JSON, about this page, and every reference to a node ({"@id": …}
    // on its own) points at a node the graph defines.
    const graph = JSON.parse(head.jsonld)["@graph"];
    const profile = graph.find((node) => node["@type"] === "ProfilePage");
    expect(profile.url).toBe(url);
    expect(profile.inLanguage).toBe(lang);
    const defined = new Set();
    const referenced = new Set();
    const walk = (value) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!value || typeof value !== "object") return;
      if (value["@id"]) (Object.keys(value).length === 1 ? referenced : defined).add(value["@id"]);
      Object.values(value).forEach(walk);
    };
    walk(graph);
    expect([...referenced].filter((id) => !defined.has(id)), "references to undefined nodes").toEqual([]);
  });

  test(`${path}: the copy has no em dashes`, async ({ page }) => {
    await page.goto(path);
    const text = await page.evaluate(() =>
      [document.body.innerText, document.title, ...[...document.querySelectorAll('meta[name$="description"], meta[property$="description"], meta[property$=":alt"], meta[name$=":alt"]')].map((meta) => meta.content)].join("\n"),
    );
    const lines = text.split("\n").filter((line) => line.includes("—"));
    expect(lines, "use a colon or a comma instead").toEqual([]);
  });
}

test("the sitemap lists both pages with their language alternates", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  const entries = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, entry]) => ({
    loc: entry.match(/<loc>([^<]+)<\/loc>/)[1],
    alternates: Object.fromEntries([...entry.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map(([, lang, href]) => [lang, href])),
  }));
  expect(entries.map((entry) => entry.loc)).toEqual(PAGES.map((page) => page.url));
  for (const entry of entries) expect(entry.alternates).toEqual(ALTERNATES);
});

// Size budgets, so weight can't creep in unnoticed. Text is measured gzipped, as it is sent;
// fonts and images as they are. Each budget leaves some room over today's size (in brackets).
const KB = 1024;
const BUDGETS = {
  page: 12 * KB, // each page's HTML (7.7 and 8.2 KB)
  css: 10 * KB, // styles.css (7.5 KB)
  js: 10 * KB, // the backdrop's script (7.2 KB)
  preview: 30 * KB, // each project preview SVG (at most 22.2 KB)
  shareCard: 300 * KB, // each share card: WhatsApp shows no preview of a bigger one (at most 159 KB)
  firstLoad: 450 * KB, // all a first visit downloads by the time the page has loaded (at most 314 KB in English and 379 KB in Slovenian, which needs the fonts' extra letters)
};

test("every file stays within its size budget", async () => {
  const dist = new URL("../dist/", import.meta.url);
  const gz = async (file) => gzipSync(await readFile(new URL(file, dist))).length;
  const raw = async (file) => (await readFile(new URL(file, dist))).length;
  const over = [];
  const check = (what, size, budget) => size > budget && over.push(`${what}: ${(size / KB).toFixed(1)} KB, over ${budget / KB} KB`);
  for (const { path } of PAGES) check(`${path} (HTML)`, await gz(`${path.slice(1)}index.html`), BUDGETS.page);
  check("styles.css", await gz("styles.css"), BUDGETS.css);
  check("assets/landscape.js", await gz("assets/landscape.js"), BUDGETS.js);
  for (const file of await readdir(new URL("assets/projects/", dist))) check(`assets/projects/${file}`, await gz(`assets/projects/${file}`), BUDGETS.preview);
  for (const file of ["assets/og-card.jpg", "assets/og-card-sl.jpg"]) check(file, await raw(file), BUDGETS.shareCard);
  expect(over).toEqual([]);
});

for (const { path } of PAGES) {
  test(`${path}: a first visit downloads at most ${BUDGETS.firstLoad / KB} KB, on a desktop and on a phone`, async ({ browser }) => {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      await page.goto(path, { waitUntil: "load" });
      await page.waitForTimeout(1500); // the backdrop's worker loads its script after the first paint
      const { total, files } = await page.evaluate(() => {
        const entries = [performance.getEntriesByType("navigation")[0], ...performance.getEntriesByType("resource")];
        return {
          total: entries.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
          files: entries.sort((a, b) => b.encodedBodySize - a.encodedBodySize).slice(0, 5).map((e) => `${new URL(e.name).pathname} ${(e.encodedBodySize / 1024).toFixed(1)} KB`),
        };
      });
      await page.close();
      expect(total, `${viewport.width} px: ${(total / KB).toFixed(1)} KB; the largest: ${files.join(", ")}`).toBeLessThanOrEqual(BUDGETS.firstLoad);
    }
  });
}
