// How the site behaves, run in each engine (Chromium, Firefox, WebKit): see playwright.config.mjs.
import { expect, test } from "@playwright/test";

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
