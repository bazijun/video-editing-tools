import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 5173;
const url = `http://127.0.0.1:${port}`;
const binExt = process.platform === "win32" ? ".cmd" : "";
const viteBin = path.join(rootDir, "node_modules", ".bin", `vite${binExt}`);
const electronBin = path.join(rootDir, "node_modules", ".bin", `electron${binExt}`);

const vite = spawn(viteBin, ["--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: rootDir,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"]
});

let electronProcess = null;
let stopping = false;

vite.stdout.on("data", (chunk) => process.stdout.write(chunk));
vite.stderr.on("data", (chunk) => process.stderr.write(chunk));
vite.on("exit", (code) => {
  if (!stopping && code !== 0) {
    process.exit(code || 1);
  }
});

await waitForServer(url);

electronProcess = spawn(electronBin, ["."], {
  cwd: rootDir,
  env: {
    ...process.env,
    SHOTCOMPARE_DEV_SERVER_URL: url
  },
  stdio: "inherit"
});

electronProcess.on("exit", (code) => {
  stop();
  process.exit(code || 0);
});

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function waitForServer(targetUrl) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    try {
      const response = await fetch(targetUrl);
      if (response.ok) return;
    } catch {
      await delay(200);
    }
  }
  throw new Error(`Timed out waiting for ${targetUrl}`);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stop() {
  if (stopping) return;
  stopping = true;
  electronProcess?.kill();
  vite.kill();
}
