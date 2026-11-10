// Builds the site into dist/, the folder that is tested and then deployed as it is: both pages
// and the sitemap from site.toml (through scripts/template.mjs), next to copies of the files the
// site uses as they are. Tests, tooling and repository files never reach the published site.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { parse } from "smol-toml";
import { LANGUAGES, page, sitemap } from "./template.mjs";

const root = new URL("../", import.meta.url);
const out = new URL("dist/", root);

const STATIC = [
  "styles.css",
  "assets/",
  "favicon.ico",
  "favicon.svg",
  "robots.txt",
  "googlef05255cc2416719f.html", // Google Search Console ownership check
];

// Everything is rendered before dist/ is touched: a mistake in site.toml stops the build with
// the last good one still in place.
const site = parse(await readFile(new URL("site.toml", root), "utf8"));
const generated = {
  ...Object.fromEntries(Object.entries(LANGUAGES).map(([lang, { dir }]) => [`${dir}index.html`, page(site, lang)])),
  "sitemap.xml": sitemap(site),
};

await rm(out, { recursive: true, force: true });
await mkdir(out);
for (const entry of STATIC) await cp(new URL(entry, root), new URL(entry, out), { recursive: true });
for (const [file, content] of Object.entries(generated)) {
  await mkdir(new URL(".", new URL(file, out)), { recursive: true });
  await writeFile(new URL(file, out), content);
}
console.log(`Built dist/: ${Object.keys(LANGUAGES).length} pages and the sitemap from site.toml, ${STATIC.length} static entries.`);
