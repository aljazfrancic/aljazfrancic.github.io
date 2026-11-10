// Lighthouse against the built site (dist/), served locally: each page several times, on the
// mobile and the desktop settings, each run in a fresh Chrome.
//
//   node tests/lighthouse.mjs [--form-factor mobile|desktop] [--runs 3]
//
// It fails when:
//   - Accessibility, Best Practices or SEO is under 100 in any run (these don't vary between runs);
//   - the median of one of the five metrics behind the performance score is over its budget
//     (BUDGETS below). The budgets amount to a performance score of 100, judged on medians: a
//     single run's score swings by a few points on a shared machine, the medians hold steady.
//     (Total Blocking Time is the one that broke before: the backdrop drawing on the page's own
//     thread.)
// A median performance score under 100 is a warning only.
import { chromium } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { serve } from "../scripts/serve.mjs";

const PORT = 8124;
const PAGES = ["/", "/sl/"];
const STRICT = ["accessibility", "best-practices", "seo"];

// Medians must stay at or under these: milliseconds, except CLS (unitless). Each sits just inside
// the value where Lighthouse 13's curve for that metric still gives it 99.5 of 100 points, so
// with every median within budget the performance score works out at 100 (its five metrics are
// weighted, and all of them at 99.5 or more rounds to 100). One exception: First Contentful Paint
// on mobile may reach 1250 ms, where it still earns 99 points. Lighthouse's simulated first paint
// there lands at about 760 or about 930 ms from run to run, on either page, which left only 120 ms
// under the 99.5-point line (1050 ms). With the other four metrics at full marks, as they are, the
// performance score still works out at 100 up to 1500 ms.
const BUDGETS = {
  mobile: { "first-contentful-paint": 1250, "speed-index": 1950, "largest-contentful-paint": 1550, "total-blocking-time": 60, "cumulative-layout-shift": 0.035 },
  desktop: { "first-contentful-paint": 540, "speed-index": 740, "largest-contentful-paint": 590, "total-blocking-time": 60, "cumulative-layout-shift": 0.035 },
};
const SHORT = { "first-contentful-paint": "FCP", "largest-contentful-paint": "LCP", "total-blocking-time": "TBT", "cumulative-layout-shift": "CLS", "speed-index": "SI" };

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const factors = option("--form-factor") ? [option("--form-factor")] : ["mobile", "desktop"];
const runs = Number(option("--runs", 3));
const CI = Boolean(process.env.CI);

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const show = (id, value) => (id === "cumulative-layout-shift" ? value.toFixed(3) : `${Math.round(value)} ms`);
const score = (lhr, id) => Math.round(lhr.categories[id].score * 100);

// Each run in a fresh browser: Playwright's own Chromium, the version pinned with @playwright/test
// and started the same way as for the browser tests. Lighthouse attaches to it through a
// debugging port (a free one, picked here).
const freePort = () =>
  new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const audit = async (url, factor) => {
  const port = await freePort();
  const browser = await chromium.launch({ channel: "chromium", args: [`--remote-debugging-port=${port}`] });
  try {
    const flags = { port, output: "html", logLevel: "error", onlyCategories: ["performance", ...STRICT] };
    const result = await lighthouse(url, flags, factor === "desktop" ? desktopConfig : undefined);
    if (result.lhr.runtimeError) throw new Error(`${url}: ${result.lhr.runtimeError.message}`);
    return result;
  } finally {
    await browser.close();
  }
};

const server = await serve({ port: PORT });
const failures = [];
const warnings = [];
const summary = ["| Page | Settings | Performance | Accessibility | Best Practices | SEO | FCP | SI | LCP | TBT | CLS |", "|---|---|---|---|---|---|---|---|---|---|---|"];
await mkdir("lighthouse-reports", { recursive: true });

try {
  for (const factor of factors) {
    for (const path of PAGES) {
      const results = [];
      for (let run = 1; run <= runs; run++) {
        const result = await audit(`http://127.0.0.1:${PORT}${path}`, factor);
        const { lhr } = result;
        results.push(result);
        const metrics = Object.keys(SHORT).map((id) => `${SHORT[id]} ${show(id, lhr.audits[id].numericValue)}`);
        console.log(`${factor} ${path} run ${run}: performance ${score(lhr, "performance")}, ${STRICT.map((id) => `${id} ${score(lhr, id)}`).join(", ")} | ${metrics.join(", ")}`);

        for (const id of STRICT) {
          if (lhr.categories[id].score === 1) continue;
          const failed = lhr.categories[id].auditRefs
            .filter((ref) => ref.weight > 0 && lhr.audits[ref.id].score !== null && lhr.audits[ref.id].score < 1)
            .map((ref) => ref.id);
          failures.push(`${factor} ${path} run ${run}: ${lhr.categories[id].title} ${score(lhr, id)} (${failed.join(", ")})`);
        }
      }

      const medians = Object.fromEntries(Object.keys(SHORT).map((id) => [id, median(results.map(({ lhr }) => lhr.audits[id].numericValue))]));
      for (const [id, budget] of Object.entries(BUDGETS[factor])) {
        if (medians[id] > budget) failures.push(`${factor} ${path}: median ${SHORT[id]} ${show(id, medians[id])}, over the budget of ${show(id, budget)}`);
      }
      const performance = median(results.map(({ lhr }) => score(lhr, "performance")));
      if (performance < 100) warnings.push(`${factor} ${path}: median performance score ${performance}`);

      // Keep the report of the run with the median performance score.
      const middle = [...results].sort((a, b) => a.lhr.categories.performance.score - b.lhr.categories.performance.score)[results.length >> 1];
      const name = `${factor}-${path === "/" ? "en" : path.replaceAll("/", "")}`;
      await writeFile(`lighthouse-reports/${name}.html`, middle.report);
      const strict = STRICT.map((id) => Math.min(...results.map(({ lhr }) => score(lhr, id))));
      summary.push(`| ${path} | ${factor} | ${performance} | ${strict.join(" | ")} | ${Object.keys(BUDGETS[factor]).map((id) => show(id, medians[id])).join(" | ")} |`);
    }
  }
} finally {
  server.close();
}

console.log(`\n${summary.join("\n")}\n(medians of ${runs} runs; the category columns other than performance show the lowest run)`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Lighthouse (median of ${runs} runs)\n\n${summary.join("\n")}\n\n`);
for (const warning of warnings) console.log(CI ? `::warning title=Lighthouse::${warning}` : `Warning: ${warning}`);
for (const failure of failures) console.log(CI ? `::error title=Lighthouse::${failure}` : `Failed: ${failure}`);
if (failures.length) process.exit(1);
console.log("Lighthouse: all gates passed.");
