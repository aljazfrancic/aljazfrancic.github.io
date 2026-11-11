# Personal website

A static, bilingual (English and Slovenian) one-page site, generated from a single TOML file and
published on GitHub Pages. The published site has no dependencies and works with JavaScript
turned off. Node is only needed to build and test it.

## Layout

| Path | What it is |
| --- | --- |
| `site.toml` | All the content, in both languages (see the notes at its top) |
| `scripts/template.mjs` | The HTML around the content, the structured data and the sitemap |
| `scripts/build.mjs` | Writes the site to `dist/` |
| `scripts/dev.mjs`, `scripts/serve.mjs` | Local server that rebuilds when a file changes |
| `styles.css`, `assets/` | Stylesheet, fonts, images, the backdrop's script |
| `tests/` | Validation, browser, Lighthouse, Safari and link tests |
| `.github/workflows/` | CI and deployment, plus a weekly link check |

## Requirements

- Node 22.19 or newer
- Java, for the W3C validator
- Playwright's browsers: `npx playwright install chromium firefox webkit`
- For the Safari tests only: macOS, with `sudo safaridriver --enable` run once

## Commands

```sh
npm ci              # install the build and test tools
npm run dev         # build, serve at http://127.0.0.1:8000/, rebuild on every save
npm run build       # write the site to dist/
npm test            # build, validate (W3C), Playwright in Chromium, Firefox and WebKit
npm run lighthouse  # Lighthouse on mobile and desktop settings (run a build first)
npm run safari      # real Safari through safaridriver (SAFARI=chrome runs the same tests in Chrome)
npm run links       # check the external links in dist/
```

## Editing

Change `site.toml`, not the generated HTML. Text that differs by language is an `en`/`sl` pair,
and project tags are translated through its `[glossary]` table. The build stops on a missing
translation. Asset URLs get a content fingerprint (`?v=…`) during the build, so nothing needs
to be renamed when a file changes.

## Deployment

Every push runs `.github/workflows/ci.yml`. It builds the site once and tests that build: W3C
validation, the Playwright suite (with axe accessibility checks and size budgets), Lighthouse
and desktop Safari. On `main`, that same build is deployed to GitHub Pages, but only when every
job has passed. Pushes to other branches are only tested.

## Licence

MIT, see [LICENSE](LICENSE). The fonts are under the SIL Open Font License (`assets/fonts/`),
and the flags are public domain (Wikimedia Commons).
