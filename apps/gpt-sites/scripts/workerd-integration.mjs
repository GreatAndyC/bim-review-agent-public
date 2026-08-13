import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const requestedPort = process.env.BIM_REVIEW_TEST_PORT;
const port = requestedPort
  ? Number(requestedPort)
  : await new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          reject(new Error("Could not allocate a local integration-test port."));
          return;
        }
        server.close((error) => (error ? reject(error) : resolve(address.port)));
      });
    });
assert.ok(Number.isSafeInteger(port) && port > 1024 && port < 65536);
const baseUrl = `http://localhost:${port}`;
const output = [];
const persistenceRoot = join(appRoot, ".wrangler");
await mkdir(persistenceRoot, { recursive: true });
const persistenceDirectory = await mkdtemp(
  join(persistenceRoot, "integration-test-"),
);

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "wrangler",
    "dev",
    "--config",
    "dist/server/wrangler.json",
    "--port",
    String(port),
    "--persist-to",
    persistenceDirectory,
    "--show-interactive-dev-session=false",
    "--log-level=info",
  ],
  {
    cwd: appRoot,
    detached: process.platform !== "win32",
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    output.push(chunk);
    if (output.length > 80) output.shift();
  });
}

function stopChild(signal = "SIGTERM") {
  if (child.exitCode !== null || child.killed) return;
  if (process.platform === "win32") child.kill(signal);
  else process.kill(-child.pid, signal);
}

async function waitForHealth() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.status === 200) {
        const body = await response.json();
        if (body.status === "ok" && body.parser?.status === "available") return;
      }
    } catch {
      // The local socket is expected to reject until Workerd is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Workerd did not become healthy.\n${output.join("")}`);
}

async function runSmokeScript(name) {
  const script = fileURLToPath(new URL(`./${name}`, import.meta.url));
  const suite = spawn(process.execPath, [script], {
    cwd: appRoot,
    env: { ...process.env, BIM_REVIEW_SITE_URL: baseUrl, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks = [];
  for (const stream of [suite.stdout, suite.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => chunks.push(chunk));
  }
  const exitCode = await new Promise((resolve, reject) => {
    suite.once("error", reject);
    suite.once("exit", resolve);
  });
  const suiteOutput = chunks.join("").trim();
  if (exitCode !== 0) {
    throw new Error(`${name} exited with ${exitCode}.\n${suiteOutput}`);
  }
  if (suiteOutput) console.log(suiteOutput);
}

let forceTimer;
try {
  await waitForHealth();
  await runSmokeScript("equivalence-smoke.mjs");
  await waitForHealth();
  await runSmokeScript("agent-smoke.mjs");
  await waitForHealth();
  // Keep the admission suite last so its request burst cannot perturb the
  // long-lived parser/equivalence process used by the more consequential
  // gates.
  await runSmokeScript("phase0-smoke.mjs");
} catch (error) {
  console.error(`Workerd integration output:\n${output.join("")}`);
  throw error;
} finally {
  stopChild();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const forced = new Promise((resolve) =>
    (forceTimer = setTimeout(() => {
      stopChild("SIGKILL");
      resolve();
    }, 5_000)),
  );
  await Promise.race([exited, forced]);
  clearTimeout(forceTimer);
  await rm(persistenceDirectory, { recursive: true, force: true });
}
