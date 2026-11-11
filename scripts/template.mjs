// The HTML around the content: page(site, lang) is one language's page, sitemap(site) the sitemap.
// The content itself comes from site.toml (see the notes at its top).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const SITE = "https://aljazfrancic.github.io/";
const SOURCE = "https://github.com/aljazfrancic/aljazfrancic.github.io";
// The portrait's address stays exactly this: Google ranks it, in image search too.
const PORTRAIT = "assets/avatar.jpg?v=20260605";

// A file's address with a fingerprint of its content (?v=…): browsers and caches keep files for a
// while, and a changed file gets a new address, so nobody sees an old one next to a new page.
const sources = new URL("../", import.meta.url);
const fingerprints = new Map();
const v = (path) => {
  if (!fingerprints.has(path)) fingerprints.set(path, createHash("sha256").update(readFileSync(new URL(path, sources))).digest("hex").slice(0, 8));
  return `${path}?v=${fingerprints.get(path)}`;
};

export const LANGUAGES = {
  en: { code: "en-GB", hreflang: "en", locale: "en_GB", dir: "", name: "English", flag: "gb" },
  sl: { code: "sl", hreflang: "sl", locale: "sl_SI", dir: "sl/", name: "Slovenščina", flag: "si" },
};
const MONTHS = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  sl: ["jan.", "feb.", "mar.", "apr.", "maj", "jun.", "jul.", "avg.", "sep.", "okt.", "nov.", "dec."],
};

// Text in HTML (and in attribute values): escaped, with non-breaking spaces spelled out.
const esc = (text) =>
  String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll(" ", "&nbsp;");

// A link to another site: it opens in a new tab. before and after are more attributes, around href.
const away = (url, inner, before = "", after = "") => `<a${before} href="${esc(url)}"${after} rel="noopener noreferrer" target="_blank">${inner}</a>`;

// Text with [words](https://…) links in it.
const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const rich = (text) => {
  let html = "";
  let at = 0;
  for (const match of text.matchAll(LINK)) {
    html += esc(text.slice(at, match.index)) + away(match[2], esc(match[1]));
    at = match.index + match[0].length;
  }
  return html + esc(text.slice(at));
};
const plain = (text) => text.replace(LINK, "$1");
const lastLink = (text) => [...text.matchAll(LINK)].at(-1)?.[2];

// Content for one language: a plain value is the same in both, a { en, sl } pair differs. A pair
// with only one of the two still counts as a pair, so the missing text stops the build.
const pick = (value, lang) => {
  const pair = value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(LANGUAGES).some((code) => code in value);
  if (!pair) return value;
  if (value[lang] === undefined) throw new Error(`No ${lang} text for ${JSON.stringify(value)}`);
  return value[lang];
};

// Structured data (JSON-LD), laid out for reading: short lists and lone references on one line.
const json = (value, indent) => {
  const pad = " ".repeat(indent);
  const scalar = (v) => v === null || typeof v !== "object";
  if (Array.isArray(value)) {
    if (value.every(scalar)) return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
    return `[\n${value.map((v) => `${pad}  ${json(v, indent + 2)}`).join(",\n")}\n${pad}]`;
  }
  if (!scalar(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && scalar(value[keys[0]])) return `{ ${JSON.stringify(keys[0])}: ${JSON.stringify(value[keys[0]])} }`;
    return `{\n${keys.map((key) => `${pad}  ${JSON.stringify(key)}: ${json(value[key], indent + 2)}`).join(",\n")}\n${pad}}`;
  }
  return JSON.stringify(value);
};

const doi = (id) => `https://doi.org/${id}`;
const orcid = (id) => `https://orcid.org/${id}`;

export const page = (site, lang) => {
  const L = LANGUAGES[lang];
  const other = Object.entries(LANGUAGES).find(([key]) => key !== lang)[1];
  const t = (value) => pick(value, lang);
  const missing = new Set();
  const term = (english) => {
    if (lang === "en") return english;
    const translated = site.glossary[english];
    if (translated === undefined) missing.add(english);
    return translated ?? english;
  };
  const root = "../".repeat(L.dir.split("/").length - 1); // from this page to the site's root
  const url = SITE + L.dir;
  const { person, meta, words } = site;
  const role = t(person.role);
  const title = `${person.name} · ${role}`;
  const updated = site.updated.toISOString();
  const year = updated.slice(0, 4);
  const shareImage = SITE + v(t(meta.share_image));
  const school = t(site.education.school);

  // A paper or thesis: in italics, marked with its language when that isn't the page's.
  const work = ({ title: name, url: href, lang: language }) =>
    away(t(href), esc(t(name)), ' class="work"', language && language !== L.code.split("-")[0] ? ` lang="${language}"` : "");
  const month = (yearMonth) => `<time datetime="${yearMonth}">${MONTHS[lang][Number(yearMonth.slice(5, 7)) - 1]} ${yearMonth.slice(0, 4)}</time>`;
  const span = ({ from, to }) => `${month(from)} – ${to ? month(to) : esc(t(words.present))}`;
  const tags = ({ languages = [], tags: topics = [], live, status }, outer, inner) => {
    const items = [
      ...languages.map((name) => `<${inner} class="tags__lang">${esc(name)}</${inner}>`),
      ...topics.map((topic) => `<${inner}>${esc(term(topic))}</${inner}>`),
      ...(live ? [`<${inner} class="tags__live">${esc(term(live))}</${inner}>`] : []),
      ...(status ? [`<${inner} class="tags__live tags__status">${esc(term(status))}</${inner}>`] : []),
    ];
    return `<${outer} class="tags">${items.join("")}</${outer}>`;
  };

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE}#website`,
        url: SITE,
        name: person.name,
        inLanguage: Object.values(LANGUAGES).map((language) => language.code),
        publisher: { "@id": `${SITE}#person` },
      },
      {
        "@type": "ProfilePage",
        "@id": `${url}#profile`,
        url,
        name: title,
        inLanguage: L.code,
        isPartOf: { "@id": `${SITE}#website` },
        dateModified: updated,
        mainEntity: { "@id": `${SITE}#person` },
      },
      {
        "@type": "Person",
        "@id": `${SITE}#person`,
        name: person.name,
        givenName: person.given_name,
        familyName: person.family_name,
        alternateName: person.alternate_name,
        url: SITE,
        image: {
          "@type": "ImageObject",
          "@id": `${SITE}#portrait`,
          url: SITE + PORTRAIT,
          contentUrl: SITE + PORTRAIT,
          width: 1280,
          height: 1280,
          caption: t(person.portrait_alt),
        },
        jobTitle: role,
        description: t(meta.summary),
        alumniOf: { "@type": "CollegeOrUniversity", name: plain(school), url: lastLink(school) },
        knowsAbout: meta.knows_about.map(term),
        knowsLanguage: Object.values(LANGUAGES).map((language) => language.hreflang),
        identifier: { "@type": "PropertyValue", propertyID: "ORCID", value: person.orcid, url: orcid(person.orcid) },
        sameAs: [person.github, person.linkedin, orcid(person.orcid), t(person.cobiss)],
      },
      {
        "@type": "ScholarlyArticle",
        "@id": `${SITE}#${site.paper.code.name}-paper`,
        headline: site.paper.title,
        name: site.paper.title,
        author: { "@id": `${SITE}#person` },
        datePublished: site.paper.published.toISOString(),
        version: site.paper.version,
        inLanguage: site.paper.lang,
        url: doi(site.paper.doi),
        identifier: { "@type": "PropertyValue", propertyID: "DOI", value: site.paper.doi, url: doi(site.paper.doi) },
        publisher: { "@type": "Organization", ...site.paper.publisher },
        encoding: { "@type": "MediaObject", contentUrl: site.paper.pdf, encodingFormat: "application/pdf" },
        isBasedOn: { "@id": `${SITE}#${site.paper.code.name}-code` },
        license: site.paper.license,
        keywords: site.paper.keywords,
      },
      {
        "@type": "SoftwareSourceCode",
        "@id": `${SITE}#${site.paper.code.name}-code`,
        name: site.paper.code.name,
        author: { "@id": `${SITE}#person` },
        url: doi(site.paper.code.doi),
        identifier: { "@type": "PropertyValue", propertyID: "DOI", value: site.paper.code.doi, url: doi(site.paper.code.doi) },
        codeRepository: site.paper.code.repository,
        programmingLanguage: site.paper.code.language,
        license: site.paper.code.licenses,
      },
    ],
  };

  const featured = site.projects.slice(0, 4);
  const more = site.projects.slice(4);

  const html = `<!DOCTYPE html>
<html lang="${L.code}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(t(meta.description))}">
  <meta name="author" content="${esc(person.name)}">
  <meta name="robots" content="max-image-preview:large">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#f5f7fa" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0f1419" media="(prefers-color-scheme: dark)">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(person.name)}">
  <meta property="og:locale" content="${L.locale}">
  <meta property="og:locale:alternate" content="${other.locale}">
  <meta property="og:title" content="${esc(person.name)}">
  <meta property="og:description" content="${esc(t(meta.share_description))}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${esc(shareImage)}">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${esc(t(meta.share_image_alt))}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(person.name)}">
  <meta name="twitter:description" content="${esc(t(meta.share_description))}">
  <meta name="twitter:image" content="${esc(shareImage)}">
  <meta name="twitter:image:alt" content="${esc(t(meta.share_image_alt))}">
  <link rel="canonical" href="${url}">
${Object.values(LANGUAGES).map((language) => `  <link rel="alternate" hreflang="${language.hreflang}" href="${SITE + language.dir}">`).join("\n")}
  <link rel="alternate" hreflang="x-default" href="${SITE}">
  <link rel="me" href="${orcid(person.orcid)}">
  <script type="application/ld+json">
  ${json(graph, 2).replaceAll("<", "\\u003c")}
  </script>
  <script>
    // Theme: re-apply a saved choice before first paint; the switch's script takes over from there.
    // Key "home-theme", not "theme": the project sites under this origin share its localStorage.
    try { const saved = localStorage.getItem("home-theme"); if (saved) document.documentElement.dataset.theme = saved; } catch {}
  </script>
  <link rel="icon" href="${root}${v("favicon.ico")}" sizes="32x32">
  <link rel="icon" href="${root}${v("favicon.svg")}" type="image/svg+xml">
  <link rel="preload" href="${root}assets/fonts/dm-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${root}assets/fonts/dm-sans-italic-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${root}${v("styles.css")}">
  <script src="${root}${v("assets/landscape.js")}" defer></script>
</head>
<body>
  <a class="skip" href="#content">${esc(t(words.skip))}</a>
  <div class="page">
    <header class="intro">
      <div class="controls">
        <a class="switch switch--lang${lang === "en" ? "" : " switch--end"}" href="${root}${other.dir}" hreflang="${other.hreflang}" lang="${other.hreflang}" title="${other.name}" aria-label="${other.name}">
          <span class="switch__track" aria-hidden="true">
            <img class="switch__icon switch__flag switch__flag--gb" src="${root}${v("assets/flags/gb.svg")}" alt="" width="16" height="16">
            <img class="switch__icon switch__flag switch__flag--si" src="${root}${v("assets/flags/si.svg")}" alt="" width="16" height="16">
            <span class="switch__thumb"><img class="switch__flag switch__flag--${L.flag}" src="${root}${v(`assets/flags/${L.flag}.svg`)}" alt="" width="24" height="24"></span>
          </span>
        </a>
        <label class="switch switch--theme" title="${esc(t(words.theme))}">
          <input class="switch__input" type="checkbox" role="switch" id="theme-toggle" aria-label="${esc(t(words.theme))}">
          <script>
            // Remember the switch: store a choice that differs from the system, forget one that matches.
            (() => {
              const box = document.getElementById("theme-toggle");
              const systemDark = matchMedia("(prefers-color-scheme: dark)");
              const saved = () => { try { return localStorage.getItem("home-theme"); } catch { return null; } };
              // The phone's browser bar follows the switch: both theme-color tags get the active colour.
              const bars = [...document.querySelectorAll('meta[name="theme-color"]')], tones = bars.map((m) => m.content);
              const paintBars = () => bars.forEach((m) => { m.content = tones[+(box.checked !== systemDark.matches)]; });
              const sync = () => {
                box.checked = saved() !== null && (saved() === "dark") !== systemDark.matches;
                delete document.documentElement.dataset.theme;
                paintBars();
              };
              box.addEventListener("change", () => {
                try { box.checked ? localStorage.setItem("home-theme", systemDark.matches ? "light" : "dark") : localStorage.removeItem("home-theme"); } catch {}
                paintBars();
              });
              systemDark.addEventListener("change", sync);
              addEventListener("pageshow", sync);
              sync();
            })();
          </script>
          <span class="switch__track" aria-hidden="true">
            <svg class="switch__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4.25" fill="currentColor" stroke="none"/><path d="M12 2.75v2.5M12 18.75v2.5M2.75 12h2.5M18.75 12h2.5M5.46 5.46l1.77 1.77M16.77 16.77l1.77 1.77M5.46 18.54l1.77-1.77M16.77 7.23l1.77-1.77"/></svg>
            <svg class="switch__icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M19.9 13.81A8.5 8.5 0 1 1 10.19 4.1 7 7 0 0 0 19.9 13.81Z"/></svg>
            <span class="switch__thumb">
              <svg class="switch__glyph switch__glyph--sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4.25" fill="currentColor" stroke="none"/><path d="M12 2.75v2.5M12 18.75v2.5M2.75 12h2.5M18.75 12h2.5M5.46 5.46l1.77 1.77M16.77 16.77l1.77 1.77M5.46 18.54l1.77-1.77M16.77 7.23l1.77-1.77"/></svg>
              <svg class="switch__glyph switch__glyph--moon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M19.9 13.81A8.5 8.5 0 1 1 10.19 4.1 7 7 0 0 0 19.9 13.81Z"/></svg>
            </span>
          </span>
        </label>
      </div>
      <div class="intro__id">
        <img src="${root}${PORTRAIT}" srcset="${root}${v("assets/avatar-240.webp")} 240w" sizes="6.25rem" alt="${esc(t(person.portrait_alt))}" class="intro__avatar" width="160" height="160" fetchpriority="high">
        <h1 class="intro__name"><span class="intro__line"><span class="intro__type" style="--chars: ${[...person.given_name].length}">${esc(person.given_name)}</span></span> <span class="intro__line"><span class="intro__type" style="--chars: ${[...person.family_name].length}">${esc(person.family_name)}</span></span></h1>
      </div>
      <p class="intro__role">${esc(role)}</p>
      <p class="intro__degree">${esc(t(person.degree))}</p>
      <nav class="toc" aria-label="${esc(t(words.sections))}">
        <ol>
${["about", "experience", "education", "projects"].map((id) => `          <li><a href="#${id}">${esc(t(words[id]))}</a></li>`).join("\n")}
        </ol>
      </nav>
      <nav class="intro__links" aria-label="${esc(t(words.profiles))}">
        ${away(person.github, `
          <svg class="intro__links-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
          <span>GitHub</span>
        `)}
        ${away(person.linkedin, `
          <svg class="intro__links-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"/></svg>
          <span>LinkedIn</span>
        `)}
        <a href="mailto:${esc(person.email)}">
          <svg class="intro__links-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true" focusable="false"><path d="M1.5 8.67v8.58a3 3 0 0 0 3 3h15a3 3 0 0 0 3-3V8.67l-8.928 5.493a3 3 0 0 1-3.144 0L1.5 8.67Z"/><path d="M22.5 6.908V6.75a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3v.158l9.714 5.978a1.5 1.5 0 0 0 1.572 0L22.5 6.908Z"/></svg>
          <span>${esc(person.email)}</span>
        </a>
      </nav>
    </header>

    <main id="content">
      <section id="about" class="section">
        <h2>${esc(t(words.about))}</h2>
        <p class="lead">${rich(t(site.about.text))}</p>
      </section>

      <section id="experience" class="section">
        <h2>${esc(t(words.experience))}</h2>
${site.experience
  .map(
    (job) => `        <article class="entry">
          <div class="entry__body">
            <h3 class="entry__title">${esc(t(job.title))}</h3>
            <p class="entry__org">${rich(t(job.org))}</p>
            <p>${rich(t(job.text))}</p>
            <dl class="refs">
${(job.refs ?? []).map((ref) => `              <dt>${esc(t(ref.label))}</dt><dd>${ref.work ? work(ref.work) : rich(t(ref.links))}</dd>`).join("\n")}
            </dl>
          </div>
          <p class="entry__when">${span(job)}</p>
        </article>`,
  )
  .join("\n")}
      </section>

      <section id="education" class="section">
        <h2>${esc(t(words.education))}</h2>
        <p class="section__lede">${rich(school)}</p>
${site.education.degrees
  .map(
    (degree) => `        <article class="entry entry--compact">
          <div class="entry__body">
            <h3 class="entry__title">${esc(t(degree.title))}</h3>
            ${degree.thesis ? `<p>${work(degree.thesis)}</p>` : `<p class="entry__org">${rich(t(degree.org))}</p>`}
          </div>
          <p class="entry__when"><time>${degree.year}</time></p>
        </article>`,
  )
  .join("\n")}
      </section>

      <section id="projects" class="section">
        <h2>${esc(t(words.projects))}</h2>
        <div class="featured">
${featured
  .map(
    (project) => `          <a href="${esc(project.url)}" class="card" rel="noopener noreferrer" target="_blank">
            <img class="card__img" src="${root}${v(`assets/projects/${project.image}`)}" alt="" width="720" height="405" loading="lazy" decoding="async">
            <h3 class="card__title">${esc(project.title)}</h3>
            <p class="card__desc">${esc(t(project.description))}</p>
            ${tags(project, "ul", "li")}
          </a>`,
  )
  .join("\n")}
        </div>

        <h3 class="subhead">${esc(t(words.more_projects))}</h3>
        <ul class="more">
${more
  .map(
    (project) => `          <li>${away(
      project.url,
      `
            <img class="more__img" src="${root}${v(`assets/projects/${project.image}`)}" alt="" width="264" height="176" loading="lazy" decoding="async">
            <span class="more__title">${esc(project.title)}</span>
            <span class="more__desc">${esc(t(project.description))}</span>
            ${tags(project, "span", "span")}
          `,
    )}</li>`,
  )
  .join("\n")}
        </ul>
      </section>

      <footer class="footer">
        <p>© ${year} ${esc(person.name)}</p>
        <p>${away(SOURCE, esc(t(words.source)))} · <a href="#top">${esc(t(words.top))}</a></p>
      </footer>
    </main>
  </div>
</body>
</html>
`;

  if (missing.size) throw new Error(`No Slovenian for these terms; add them to [glossary] in site.toml: ${[...missing].join(", ")}`);
  return html;
};

export const sitemap = (site) => {
  const updated = site.updated.toISOString();
  const alternates = [
    ...Object.values(LANGUAGES).map((language) => `    <xhtml:link rel="alternate" hreflang="${language.hreflang}" href="${SITE + language.dir}"/>`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}"/>`,
  ].join("\n");
  const urls = Object.values(LANGUAGES).map(
    (language) => `  <url>
    <loc>${SITE + language.dir}</loc>
    <lastmod>${updated}</lastmod>
${alternates}
    <image:image>
      <image:loc>${SITE + PORTRAIT}</image:loc>
    </image:image>
  </url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join("\n")}
</urlset>
`;
};
