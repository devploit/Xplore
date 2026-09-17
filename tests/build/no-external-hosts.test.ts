import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The extension must never talk to anything but X. Every URL literal in the built bundles is
 * checked here. Non-network literals shipped by dependencies are listed with the reason they are safe.
 */
const ALLOWED = [
  /^https?:\/\/([a-z0-9-]+\.)*x\.com/,
  /^https?:\/\/([a-z0-9-]+\.)*twitter\.com/,
  /^https?:\/\/([a-z0-9-]+\.)*twimg\.com/,
  /^http:\/\/www\.w3\.org\//, // XML/SVG namespace identifiers, never fetched
  /^https:\/\/tailwindcss\.com/, // license comment in the generated CSS
  /^http:\/\/bit\.ly\/2kdckMn/, // Dexie error message text
  /^https:\/\/tinyurl\.com\/y2uuvskb/, // Dexie error message text
  /^https:\/\/dexie\.org/, // Dexie error message text
  /^https:\/\/github\.com\/preactjs/, // preact debug link in error text
];

describe("built bundles", () => {
  const dist = join(process.cwd(), "dist");
  const files = readdirSync(dist).filter((f) => f.endsWith(".js"));
  it("exist", () => {
    expect(files).toEqual(expect.arrayContaining(["interceptor.js", "sidebar.js"]));
  });
  for (const file of files) {
    it(`${file} references no host outside X`, () => {
      const src = readFileSync(join(dist, file), "utf8");
      const urls = [...src.matchAll(/https?:\/\/[A-Za-z0-9.-]+(?:\/[^\s"'`)\\]*)?/g)].map((m) => m[0]);
      const offenders = [...new Set(urls)].filter((u) => !ALLOWED.some((re) => re.test(u)));
      expect(offenders).toEqual([]);
    });
    it(`${file} uses no dynamic code evaluation`, () => {
      const src = readFileSync(join(dist, file), "utf8");
      expect(/\beval\s*\(/.test(src)).toBe(false);
      expect(/new\s+Function\s*\(/.test(src)).toBe(false);
    });
  }
});
