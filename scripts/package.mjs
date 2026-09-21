// Zips the built extension for a GitHub release. Run after `npm run build`.
// The archive unpacks to a folder named after the version, which is what "Load unpacked" wants.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "dist");
if (!existsSync(join(dist, "manifest.json"))) {
  console.error("dist/manifest.json not found. Run `npm run build` first.");
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
const expected = process.env.EXPECTED_VERSION;
if (expected && expected !== version) {
  console.error(`Tag version ${expected} does not match manifest version ${version}.`);
  process.exit(1);
}

const out = join(root, "release");
const folder = `xplore-v${version}`;
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, folder), { recursive: true });
cpSync(dist, join(out, folder), { recursive: true });

const zip = `${folder}.zip`;
execFileSync("zip", ["-r", "-q", "-X", zip, folder], { cwd: out, stdio: "inherit" });
rmSync(join(out, folder), { recursive: true, force: true });
console.log(`release/${zip}`);
