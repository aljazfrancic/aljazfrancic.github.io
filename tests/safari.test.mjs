// Real Safari, driven through Apple's safaridriver: macOS only (CI runs it on a macOS runner).
// Playwright's WebKit covers the rest; this checks the Safari that visitors actually have.
//
//   sudo safaridriver --enable        once per Mac
//   npm run build && npm run safari   desktop Safari
//   SAFARI=ios npm run safari         Safari in the iOS Simulator
//   SAFARI=chrome npm run safari      the same tests in Chrome, to work on them away from a Mac
//
// WebDriver can't read Safari's console, so the pages are served with tests/harness.js, which
// collects their errors in window.__errors, and with tests/harness-worker.js, which logs the
// backdrop's frames. On a failure, a screenshot lands in test-results/safari/.
//
// Safari on GitHub's macOS runners shows no canvas at all, not even a red square drawn on a plain
// one (they're virtual machines without a GPU), so there the backdrop is checked through its frame
// log only; wherever a canvas does show (the iOS Simulator, a real Mac) its pixels are checked too.
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, describe, test } from "node:test";
import { Browser, Builder, By } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import { Pointer } from "selenium-webdriver/lib/input.js";
import safari from "selenium-webdriver/safari.js";
import { serve } from "../scripts/serve.mjs";

const PORT = 8125;
const BASE = `http://127.0.0.1:${PORT}`;
const TARGET = process.env.SAFARI ?? "desktop"; // desktop | ios | chrome
const PHONE = TARGET === "ios";
const PAGES = [
  { path: "/", lang: "en-GB" },
  { path: "/sl/", lang: "sl" },
];
const BACKGROUND = { light: "rgb(245, 247, 250)", dark: "rgb(15, 20, 25)" };

const builder = () => {
  if (TARGET === "chrome") {
    return new Builder().forBrowser(Browser.CHROME).setChromeOptions(new chrome.Options().addArguments("--headless=new", "--window-size=1280,900"));
  }
  const options = new safari.Options();
  if (PHONE) {
    options.set("platformName", "iOS");
    options.set("safari:useSimulator", true);
    options.set("safari:deviceType", "iPhone");
    // A simulator booted beforehand (CI does): starting a cold one can outlast the session's timeout.
    if (process.env.SIMULATOR_UDID) options.set("safari:deviceUDID", process.env.SIMULATOR_UDID);
  }
  return new Builder().forBrowser(Browser.SAFARI).setSafariOptions(options);
};

// Starting a Safari session now and then fails on CI machines (Safari still starting up, an
// earlier session not yet released): try up to three times before giving up.
const startSession = async () => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await builder().build();
    } catch (error) {
      if (attempt === 3) throw error;
      console.log(`The session didn't start (${error.message.split("\n")[0]}), trying again.`);
      await sleep(5000 * attempt);
    }
  }
};

let driver;
let server;

// Polls fn until it returns something truthy, or fails with message after timeout ms.
const waitFor = async (fn, message, timeout = 10_000) => {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(200);
  }
  assert.fail(`${message} (last seen: ${JSON.stringify(last)})`);
};

const run = (script, ...args) => driver.executeScript(script, ...args);

// Loads a page and waits for every animation with an end (entrance, typed name, the backdrop's
// fade-in); the blinking cursor and the beta badge's pulse go on forever and don't count.
const open = async (path) => {
  await driver.get(BASE + path);
  await waitFor(() => run("return document.readyState === 'complete'"), "the page should finish loading");
  await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    Promise.all(document.getAnimations()
      .filter((animation) => animation.effect && animation.effect.getComputedTiming().endTime !== Infinity)
      .map((animation) => animation.finished.catch(() => {}))).then(() => done());`);
};

const errors = () => run("return window.__errors || ['the test harness is missing']");

// Where the backdrop draws: "worker" when the page started the backdrop's worker (the harness
// keeps a list), "page" when it draws on the page, "none" when the canvas is gone and the dots
// show instead (a worker that fails removes it).
const backdrop = () =>
  run(`if (!document.querySelector("body > canvas.backdrop")) return "none";
    return window.__workers.some((url) => new URL(url).pathname === "/assets/landscape.js") ? "worker" : "page";`);

const addStyle = (css) => run("const style = document.createElement('style'); style.textContent = arguments[0]; document.head.append(style);", css);

const background = () => run("return getComputedStyle(document.body).backgroundColor");

// Clicks an element, or on a phone taps it, then waits for effect() to come true. In the iOS
// Simulator safaridriver's taps haven't always reached the page (seen on CI, even on a plain
// link): when a tap changes nothing, a scripted click stands in and the log says so.
const press = async (selector, effect) => {
  const element = await driver.findElement(By.css(selector));
  if (PHONE) {
    const finger = new Pointer("finger", Pointer.Type.TOUCH);
    try {
      await driver.actions().insert(finger, finger.move({ origin: element }), finger.press(), finger.release()).perform();
    } catch (error) {
      console.log(`The tap on ${selector} failed: ${error.message.split("\n")[0]}`);
    }
  } else {
    await element.click();
  }
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    if (await effect()) return;
    await sleep(200);
  }
  if (!PHONE) assert.fail(`clicking ${selector} changed nothing`);
  console.log(`The tap on ${selector} didn't reach the page; clicking it from a script instead.`);
  await run("arguments[0].click()", element);
  await waitFor(effect, `${selector} should respond to a scripted click`);
};

// Can this browser show a canvas at all? A red square drawn on a plain canvas must change the
// screenshot. Asked once per session.
let canvasShows;
const probeCanvas = async () => {
  const before = await driver.takeScreenshot();
  await run(`const canvas = document.createElement("canvas");
    canvas.id = "probe";
    canvas.width = canvas.height = 100;
    canvas.style.cssText = "position: fixed; left: 0; top: 0; width: 100px; height: 100px; z-index: 9";
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 100, 100);
    document.body.append(canvas);`);
  await sleep(300);
  const shows = before !== (await driver.takeScreenshot());
  await run('document.getElementById("probe").remove()');
  return shows;
};

// How many frames the backdrop has drawn so far (tests/harness-worker.js logs them).
const frames = () => run("return window.__frames.length");

// Saves what the screen showed when a check fails, then fails as before.
const check = (name, fn) =>
  test(name, async () => {
    try {
      await fn();
    } catch (error) {
      await mkdir("test-results/safari", { recursive: true });
      const file = `test-results/safari/${TARGET}-${name.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")}.png`;
      await writeFile(file, await driver.takeScreenshot(), "base64").catch(() => {});
      throw error;
    }
  });

describe(`Safari (${TARGET})`, { timeout: 15 * 60_000 }, () => {
  before(async () => {
    server = await serve({ port: PORT, harness: true });
    driver = await startSession();
    await driver.manage().setTimeouts({ script: 30_000, pageLoad: 60_000 });
    const capabilities = await driver.getCapabilities();
    const version = `${capabilities.getBrowserName()} ${capabilities.getBrowserVersion()} on ${capabilities.getPlatform()}`;
    console.log(`Testing ${version}`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Safari tests (${TARGET})\n\n${version}\n\n`);
    if (!PHONE) await driver.manage().window().setRect({ width: 1280, height: 900 });
  });

  after(async () => {
    await driver?.quit();
    server?.close();
  });

  for (const { path, lang } of PAGES) {
    check(`${path} loads cleanly, with its fonts and the backdrop flying in a worker`, async () => {
      await open(path);
      assert.equal(await run("return document.documentElement.lang"), lang);
      // The backdrop connects its worker once the page has first painted.
      await waitFor(async () => (await backdrop()) === "worker", "the backdrop should draw in a worker");

      const fonts = await driver.executeAsyncScript(`
        const done = arguments[arguments.length - 1];
        document.fonts.ready.then(() => done([...document.fonts].map((face) => [face.family.replace(/"/g, ""), face.style, face.status])));`);
      assert.deepEqual(fonts.filter(([, , status]) => status === "error"), [], "no font fails to load");
      for (const family of ["DM Sans", "DM Mono"]) {
        assert.ok(fonts.some(([name, style, status]) => name === family && style === "normal" && status === "loaded"), `${family} should be loaded`);
      }

      // The flight goes on: new frames keep coming, at least a second's worth (24 a second). Given
      // 45 s, because a machine the backdrop judges too slow (as CI's virtual Macs can be) gets
      // still frames for 5, then 10, then 20 s, with short bursts of flight in between.
      const start = await frames();
      const flying = async () => (await frames()) - start >= 24;
      const end = Date.now() + 45_000;
      while (!(await flying()) && Date.now() < end) await sleep(500);
      if (!(await flying())) {
        const log = await run("return window.__frames");
        const gaps = log.slice(1).map((t, i) => t - log[i]).filter((gap) => gap > 200);
        assert.fail(`the backdrop should keep drawing new frames: ${log.length - start} new in 45 s (frames so far ${log.length}, last at ${log.at(-1)} ms, pauses ${gaps.join(", ")} ms)`);
      }

      // And what it draws reaches the screen, wherever a canvas can show at all.
      canvasShows ??= await probeCanvas();
      if (canvasShows) {
        // Only the backdrop on screen: hiding it changes the screen, and it moves (two
        // screenshots in a row differ; polled, for the same reason as above).
        await addStyle(".page { visibility: hidden !important; }");
        const shown = await driver.takeScreenshot();
        await addStyle("canvas.backdrop { visibility: hidden !important; }");
        assert.notEqual(shown, await driver.takeScreenshot(), "the backdrop canvas should have the terrain drawn on it");
        await addStyle("canvas.backdrop { visibility: visible !important; }");
        await waitFor(
          async () => {
            const before = await driver.takeScreenshot();
            await sleep(400);
            return before !== (await driver.takeScreenshot());
          },
          "the backdrop should be moving on screen",
          20_000,
        );
      } else if (path === "/") {
        const note = "This Safari shows no canvas at all, not even a plain red square (on GitHub's macOS runners: no GPU), so the backdrop was checked through its frame log, not its pixels.";
        console.log(note);
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${note}\n\n`);
      }

      assert.deepEqual(await errors(), []);
    });
  }

  check("the theme switch flips the theme, which survives a reload, and back", async () => {
    await open("/");
    const system = (await run("return matchMedia('(prefers-color-scheme: dark)').matches")) ? "dark" : "light";
    const flipped = system === "light" ? "dark" : "light";
    assert.equal(await background(), BACKGROUND[system]);

    await press("#theme-toggle", async () => (await background()) === BACKGROUND[flipped]);
    assert.equal(await run("return localStorage.getItem('home-theme')"), flipped);

    await driver.navigate().refresh();
    await waitFor(() => run("return document.readyState === 'complete'"), "the page should reload");
    assert.equal(await run("return document.getElementById('theme-toggle').checked"), true, "the switch stays on after a reload");
    await waitFor(async () => (await background()) === BACKGROUND[flipped], `the page should stay ${flipped}`);

    await press("#theme-toggle", async () => (await background()) === BACKGROUND[system]);
    assert.equal(await run("return localStorage.getItem('home-theme')"), null, "switching back forgets the choice");
    assert.deepEqual(await errors(), []);
  });

  for (const { path } of PAGES) {
    check(`${path} never scrolls sideways`, async () => {
      // A phone has the width it has; a desktop window is tried wide and narrow.
      for (const width of PHONE ? [null] : [1280, 768]) {
        if (width) await driver.manage().window().setRect({ width, height: 900 });
        await open(path);
        const { scroll, edge, inner } = await run(`return {
          scroll: document.documentElement.scrollWidth,
          edge: document.documentElement.clientWidth,
          inner: innerWidth,
        }`);
        console.log(`${path} at ${inner} px wide: content ${scroll} px`);
        assert.ok(scroll <= edge, `${path} at ${inner} px: the page is ${scroll} px wide`);
      }
      if (!PHONE) await driver.manage().window().setRect({ width: 1280, height: 900 });
    });
  }

  check("the language switch leads to the Slovenian page and back", async () => {
    await open("/");
    await press(".switch--lang", async () => (await driver.getCurrentUrl()).endsWith("/sl/"));
    await waitFor(async () => (await run("return document.documentElement.lang")) === "sl", "the page should be Slovenian");
    await press(".switch--lang", async () => (await driver.getCurrentUrl()) === `${BASE}/`);
    await waitFor(async () => (await run("return document.documentElement.lang")) === "en-GB", "the page should be English");
  });
});
