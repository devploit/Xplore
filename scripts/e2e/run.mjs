import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Starts the fake X, runs the headless smoke test, then stops the fake X whatever happens.
const here = dirname(fileURLToPath(import.meta.url));
const server = spawn(process.execPath, [join(here, "fake-x.mjs")], { stdio: "inherit" });
let serverExit = null;
server.on("exit", (c) => (serverExit = c));
await new Promise((r) => setTimeout(r, 1000));
if (serverExit !== null) { console.error("fake X did not start; exitCode", serverExit); process.exit(2); }
const smoke = spawn(process.execPath, [join(here, "smoke.mjs"), process.argv[2] ?? "dist", process.argv[3] ?? "22000"], { stdio: "inherit" });
const code = await new Promise((r) => smoke.on("exit", r));
server.kill("SIGKILL");
process.exit(code ?? 1);
