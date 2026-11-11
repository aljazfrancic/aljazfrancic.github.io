// How the site behaves, run in each engine (Chromium, Firefox, WebKit): see playwright.config.mjs.
import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";

const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

const PAGES = [
  { path: "/", lang: "en-GB" },
  { path: "/sl/", lang: "sl" },
];
const BACKGROUND = { light: "rgb(245, 247, 250)", dark: "rgb(15, 20, 25)" };
const BAR = { light: "#f5f7fa", dark: "#0f1419" }; // theme-color: the phone's browser bar

// Everything that goes wrong while a page runs: console errors, uncaught exceptions, failed or
// missing requests. (An error in the backdrop's worker removes the canvas, which the backdrop
// checks catch.)
const watchErrors = (page) => {
  const errors = [];
  page.on("console", (message) => message.type() === "error" && errors.push(`console: ${message.text()}`));
  page.on("pageerror", (error) => errors.push(`uncaught: ${error.message}`));
  page.on("requestfailed", (request) => errors.push(`failed: ${request.url()} (${request.failure()?.errorText})`));
  page.on("response", (response) => response.status() >= 400 && errors.push(`HTTP ${response.status()}: ${response.url()}`));
  return errors;
};

// Waits for every animation with an end (entrance, typed name, the backdrop's fade-in) to end;
// the blinking cursor and the beta badge's pulse go on forever and don't count.
const settle = (page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );

const backdropWorker = (page) => page.workers().some((worker) => new URL(worker.url()).pathname === "/assets/landscape.js");

// Leaves only the backdrop on screen: the canvas sits on <body>, everything else in .page.
const hideContent = (page) => page.addStyleTag({ content: ".page { visibility: hidden !important; }" });

// The backdrop is moving when two screenshots in a row differ. Polled: a device the backdrop
// judges too slow gets a still frame for a few seconds before it tries again.
const expectMoving = (page) =>
  expect
    .poll(
      async () => {
        const before = await page.screenshot();
        await page.waitForTimeout(400);
        return !before.equals(await page.screenshot());
      },
      { message: "the backdrop should be moving", timeout: 20_000, intervals: [0] },
    )
    .toBe(true);

// The canvas has something drawn on it when hiding it changes the screen.
const expectDrawn = async (page) => {
  const shown = await page.screenshot();
  const style = await page.addStyleTag({ content: "canvas.backdrop { visibility: hidden !important; }" });
  const hidden = await page.screenshot();
  await style.evaluate((element) => element.remove());
  expect(shown.equals(hidden), "the backdrop canvas should have the terrain drawn on it").toBe(false);
};

for (const { path, lang } of PAGES) {
  test(`${path} loads cleanly, with its fonts and the backdrop flying in a worker`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    await expect.poll(() => backdropWorker(page), { message: "the backdrop should draw in a worker" }).toBe(true);
    await settle(page);
    await expect(page.locator("body > canvas.backdrop"), "the canvas stays (a failed worker removes it)").toHaveCount(1);

    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].map((face) => ({ family: face.family.replace(/"/g, ""), style: face.style, status: face.status }));
    });
    expect(fonts.filter((face) => face.status === "error"), "no font fails to load").toEqual([]);
    for (const family of ["DM Sans", "DM Mono"]) {
      expect(fonts.some((face) => face.family === family && face.style === "normal" && face.status === "loaded"), `${family} is loaded`).toBe(true);
    }

    await hideContent(page);
    await expectMoving(page);
    await expectDrawn(page);
    expect(errors).toEqual([]);
  });
}

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the backdrop holds a still frame", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/");
    await expect.poll(() => backdropWorker(page)).toBe(true);
    await settle(page);
    await page.waitForTimeout(3500); // past the point where the flight would have started
    await hideContent(page);
    const first = await page.screenshot();
    await page.waitForTimeout(1500);
    expect(first.equals(await page.screenshot()), "the backdrop should not move").toBe(true);
    await expectDrawn(page);
    expect(errors).toEqual([]);
  });
});

for (const scheme of ["light", "dark"]) {
  const flipped = scheme === "light" ? "dark" : "light";

  test.describe(`on a ${scheme} system theme`, () => {
    test.use({ colorScheme: scheme });

    test(`the switch turns the page ${flipped}, which survives a reload, and back`, async ({ page }) => {
      const body = page.locator("body");
      const toggle = page.locator("#theme-toggle");
      const bars = page.locator('meta[name="theme-color"]');
      const stored = () => page.evaluate(() => localStorage.getItem("home-theme"));

      await page.goto("/");
      await expect(body).toHaveCSS("background-color", BACKGROUND[scheme]);
      await toggle.click();
      await expect(body).toHaveCSS("background-color", BACKGROUND[flipped]); // waits out the cross-fade
      expect(await stored()).toBe(flipped);
      for (const bar of await bars.all()) await expect(bar).toHaveAttribute("content", BAR[flipped]);

      await page.reload();
      await expect(toggle).toBeChecked();
      await expect(body).toHaveCSS("background-color", BACKGROUND[flipped]);

      await toggle.click();
      await expect(body).toHaveCSS("background-color", BACKGROUND[scheme]);
      expect(await stored(), "switching back to the system theme forgets the choice").toBeNull();
      for (const bar of await bars.all()) await expect(bar).toHaveAttribute("content", BAR[scheme]);
    });
  });
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false, colorScheme: "light" });

  for (const { path, lang } of PAGES) {
    test(`${path} is complete, with dots for a backdrop and a working theme switch`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.locator("canvas")).toHaveCount(0);
      for (const section of ["about", "experience", "education", "projects"]) {
        await expect(page.locator(`#${section}`)).toBeVisible();
      }
      await expect(page.locator(".intro__name")).toBeVisible();
      await expect(page.locator(".card")).toHaveCount(4);
      await expect(page.locator(".more li").first()).toBeVisible();

      const dots = await page.evaluate(() => getComputedStyle(document.body, "::before").display);
      expect(dots, "the graph-paper dots stand in for the backdrop").not.toBe("none");

      await page.locator("#theme-toggle").click(); // CSS alone (:has) flips the theme
      await expect(page.locator("body")).toHaveCSS("background-color", BACKGROUND.dark);
      expect(errors).toEqual([]);
    });
  }
});

for (const { path } of PAGES) {
  test(`${path} never scrolls sideways, from 320 px to 1280 px wide`, async ({ page }) => {
    for (const width of [320, 375, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      await settle(page);
      const overflow = await page.evaluate(() => {
        const edge = document.documentElement.clientWidth;
        const wide = [...document.querySelectorAll("body *")]
          .filter((element) => element.getBoundingClientRect().right > edge + 0.5)
          .map((element) => `${element.tagName.toLowerCase()}.${[...element.classList].join(".")}`);
        return { scroll: document.documentElement.scrollWidth, edge, wide: wide.slice(0, 5) };
      });
      expect(overflow.scroll, `${width} px: wider than the screen: ${overflow.wide.join(", ")}`).toBeLessThanOrEqual(overflow.edge);
    }
  });
}

test("the language switch leads to the Slovenian page and back", async ({ page }) => {
  await page.goto("/");
  await page.locator(".switch--lang").click();
  await expect(page).toHaveURL(/\/sl\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "sl");
  await page.locator(".switch--lang").click();
  await expect(page).toHaveURL(/:\d+\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en-GB");
});

// axe-core's rules (WCAG 2 A and AA, and its best practices) on both pages, light and dark, at a
// phone's and a desktop's width. The grain and the backdrop sit behind every text and axe can't
// see through them (it would leave every text's contrast "to review"), so they're hidden for the
// scan, which then measures each text against the page's own background. Anything axe still
// can't decide fails too, so a new layer can't quietly switch the contrast check off.
for (const scheme of ["light", "dark"]) {
  test.describe(`accessibility, ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    for (const { path } of PAGES) {
      test(`${path}: axe finds nothing at 390 and 1280 px`, async ({ page }) => {
        for (const width of [390, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(path);
          await settle(page);
          await page.addStyleTag({ content: "body::before, body::after, canvas.backdrop { display: none !important; }" });
          await page.addScriptTag({ path: AXE });
          const { violations, undecided } = await page.evaluate(async () => {
            const result = await window.axe.run(document);
            const describe = (rule) => `${rule.id}: ${rule.help} (${rule.nodes.length}×, first ${rule.nodes[0].target.join(" ")})`;
            return { violations: result.violations.map(describe), undecided: result.incomplete.map(describe) };
          });
          expect(violations, `${width} px`).toEqual([]);
          expect(undecided, `${width} px: what axe couldn't decide`).toEqual([]);
        }
      });
    }
  });
}

// With the keyboard alone: the first Tab reaches the skip link, which then shows; it leads to the
// content; and every link and control after it, in order, shows a focus ring and is scrolled into
// view. (The two switches draw their ring on their track, beside or around the control itself.)
// With reduced motion, which turns the page's smooth scrolling off: the browser's own smooth
// scroll to each focused link is slow to settle, and in WebKit now and then never does.
test.describe("from the keyboard", () => {
  test.use({ reducedMotion: "reduce" });

  for (const { path } of PAGES) {
    test(`${path} works from the keyboard, with a visible focus ring at every stop`, async ({ page }) => {
      await page.goto(path);
      await settle(page);
      const focused = () =>
        page.evaluate(() => {
          const element = document.activeElement;
          if (!element || element === document.body) return null;
          const ring = element.closest(".switch")?.querySelector(".switch__track") ?? element;
          const style = getComputedStyle(ring);
          const box = element.getBoundingClientRect();
          return {
            name: `${element.tagName.toLowerCase()} "${(element.getAttribute("aria-label") || element.textContent).trim().slice(0, 40)}"`,
            ring: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 1,
            inView: box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth,
          };
        });

      await page.keyboard.press("Tab");
      const skip = await focused();
      expect(skip?.name).toMatch(/^a "/);
      expect(await page.evaluate(() => document.activeElement.classList.contains("skip")), "the first Tab reaches the skip link").toBe(true);
      expect(skip.inView, "the skip link shows once focused").toBe(true);
      expect(skip.ring).toBe(true);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/#content$/);
      await expect.poll(() => page.evaluate(() => document.getElementById("content").getBoundingClientRect().top < innerHeight)).toBe(true);

      await page.evaluate(() => document.activeElement.blur());
      const stops = await page.locator("a[href], input, button").count();
      const missing = [];
      for (let i = 0; i < stops; i++) {
        await page.keyboard.press("Tab");
        let stop = await focused();
        if (!stop) break; // past the last stop, into the browser's own controls
        // WebKit scrolls the focused link into view on its next rendering update, a moment later.
        for (let wait = 0; !stop.inView && wait < 20; wait++) {
          await page.waitForTimeout(100);
          stop = await focused();
        }
        if (!stop.ring || !stop.inView) missing.push(`${stop.name}: ${stop.ring ? "" : "no focus ring "}${stop.inView ? "" : "not scrolled into view"}`);
      }
      expect(missing).toEqual([]);
    });
  }
});
