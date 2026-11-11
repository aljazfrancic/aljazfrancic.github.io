// The W3C validator (the Nu Html Checker, which needs Java) over every page and SVG in dist/.
// The stylesheet isn't checked: the validator doesn't know the newer CSS the site uses on purpose
// (scroll-target-group, :target-current) and would only raise false alarms.
import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vnu from "vnu-jar";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const NOT_HTML = new Set(["googlef05255cc2416719f.html"]); // Search Console's token file: plain text

const files = (await readdir(dist, { recursive: true }))
  .filter((file) => /\.(html|svg)$/.test(file) && !NOT_HTML.has(file))
  .sort()
  .map((file) => dist + file);

try {
  execFileSync("java", ["-jar", vnu, "--errors-only", "--also-check-svg", ...files], { stdio: "inherit" });
  console.log(`Valid: ${files.length} files (pages and SVGs).`);
} catch (error) {
  // The validator has already listed what it found. When it couldn't start at all, say why.
  if (error.status == null) console.error(error.code === "ENOENT" ? "Java not found: the W3C validator needs it." : `The validator didn't run: ${error.message}`);
  process.exit(1);
}
