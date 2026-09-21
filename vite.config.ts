import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * Chrome refuses content scripts containing Unicode noncharacters (Dexie ships a literal "\uffff"
 * once minified). Escaping every non-ASCII character keeps the emitted JS plain ASCII and valid.
 */
function asciiOnly(): Plugin {
  return {
    name: "xplore-ascii-only",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        chunk.code = chunk.code.replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
      }
    },
  };
}

// Content scripts cannot be ES modules, so each entry is built as a single IIFE.
// Rollup does not support several IIFE inputs in one build; the mode selects the entry.
const entries = {
  interceptor: { input: "src/interceptor/index.ts", name: "interceptor" },
  sidebar: { input: "src/ui/main.tsx", name: "sidebar" },
} as const;

export default defineConfig(({ mode }) => {
  const entry = entries[mode as keyof typeof entries];
  if (!entry) throw new Error(`Unknown build mode "${mode}". Use interceptor or sidebar.`);
  return {
    plugins: [preact(), tailwindcss(), asciiOnly()],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    build: {
      outDir: "dist",
      emptyOutDir: false,
      sourcemap: false,
      minify: true,
      target: "chrome111",
      rollupOptions: {
        input: entry.input,
        output: { format: "iife", entryFileNames: `${entry.name}.js` },
      },
    },
  };
});
