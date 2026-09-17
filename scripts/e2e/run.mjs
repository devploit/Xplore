import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Starts the fake X, runs the headless smoke test, then stops the fake X whatever happens.
const here = dirname(fileURLToPath(import.meta.url));
const server = spawn(process.execPath, [join(here, "fake-x.mjs")], { stdio: "inherit" });
await new Promise((r) => setTimeout(r, 1000));
const smoke = spawn(process.execPath, [join(here, "smoke.mjs"), process.argv[2] ?? "dist", process.argv[3] ?? "22000"], { stdio: "inherit" });
const code = await new Promise((r) => smoke.on("exit", r));
server.kill("SIGKILL");
process.exit(code ?? 1);
