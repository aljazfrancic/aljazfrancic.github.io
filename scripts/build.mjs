// Builds the site into dist/, the folder that is tested and then deployed as it is.
// For now the pages are written by hand, so this copies the files that make up the site and
// nothing else: tests, tooling and repository files never reach the published site.
import { cp, mkdir, rm } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const out = new URL("dist/", root);

const SITE = [
  "index.html",
  "sl/",
  "styles.css",
  "assets/",
  "favicon.ico",
  "favicon.svg",
  "robots.txt",
  "sitemap.xml",
  "googlef05255cc2416719f.html", // Google Search Console ownership check
];

await rm(out, { recursive: true, force: true });
await mkdir(out);
for (const entry of SITE) await cp(new URL(entry, root), new URL(entry, out), { recursive: true });
console.log(`Built dist/ (${SITE.length} entries).`);
