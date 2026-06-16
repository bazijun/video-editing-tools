const { app, BrowserWindow, ipcMain, nativeImage } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const bundledFfmpegPath = require("ffmpeg-static");
const {
  buildClipOutputPath,
  buildStreamCopyArgs,
  buildTranscodeArgs,
  normalizeClipPayload
} = require("./clip-drag.cjs");

const sourceFiles = new Map();
let clipCacheDir = "";
let mainWindow = null;
let usableFfmpegPathPromise = null;

const DRAG_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAKUlEQVR4nO3OMQEAAAgDINc/9G1hQ4R2QJmZ2QAAAAAAAAAAAAAAALgGJpAAAW2RZ4QAAAAASUVORK5CYII=";

app.whenReady().then(async () => {
  clipCacheDir = await createClipCacheDir();
  await cleanupOldClipCaches();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1040,
    minHeight: 720,
    title: "ShotCompare",
    backgroundColor: "#f5f7f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.env.SHOTCOMPARE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.SHOTCOMPARE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

ipcMain.handle("shotcompare:register-source-file", async (_event, payload) => {
  const assetId = sanitizeAssetId(payload?.assetId);
  const filePath = typeof payload?.filePath === "string" ? payload.filePath : "";
  if (!assetId || !filePath) {
    return { ok: false };
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return { ok: false };
    }
    sourceFiles.set(assetId, filePath);
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

ipcMain.on("shotcompare:start-clip-drag", (event, payload) => {
  void startClipDrag(event.sender, payload);
});

async function startClipDrag(webContents, rawPayload) {
  let payload;
  try {
    payload = normalizeClipPayload(rawPayload);
  } catch (error) {
    sendDragStatus(webContents, "error", getErrorMessage(error, "片段范围无效，无法拖拽。"));
    return;
  }

  const sourcePath = sourceFiles.get(payload.assetId);
  if (!sourcePath) {
    sendDragStatus(webContents, "error", "没有拿到源视频本地路径，请重新导入这个素材后再拖拽。");
    return;
  }

  let dragPath = sourcePath;
  try {
    sendDragStatus(webContents, "info", `正在生成可拖拽片段：${payload.filename}`);
    dragPath = await ensureClipFile(sourcePath, payload);
    sendDragStatus(webContents, "success", `已生成临时片段，可拖入剪映：${payload.startTimecode} - ${payload.endTimecode}`);
  } catch (error) {
    sendDragStatus(webContents, "warning", `${getErrorMessage(error, "片段裁剪失败")} 已改为拖出原视频文件。`);
  }

  if (webContents.isDestroyed()) return;
  webContents.startDrag({
    file: dragPath,
    icon: nativeImage.createFromDataURL(DRAG_ICON_DATA_URL)
  });
}

async function ensureClipFile(sourcePath, payload) {
  const ffmpegPath = await getUsableFfmpegPath();
  await fs.mkdir(clipCacheDir, { recursive: true });
  const outputPath = buildClipOutputPath(clipCacheDir, payload);
  if (await fileExists(outputPath)) {
    return outputPath;
  }

  const copyArgs = buildStreamCopyArgs({
    sourcePath,
    outputPath,
    startMs: payload.startMs,
    durationMs: payload.durationMs
  });

  try {
    await runFfmpeg(ffmpegPath, copyArgs);
    return outputPath;
  } catch {
    await fs.rm(outputPath, { force: true }).catch(() => {});
  }

  const transcodeArgs = buildTranscodeArgs({
    sourcePath,
    outputPath,
    startMs: payload.startMs,
    durationMs: payload.durationMs
  });
  await runFfmpeg(ffmpegPath, transcodeArgs);
  return outputPath;
}

function getUsableFfmpegPath() {
  if (!usableFfmpegPathPromise) {
    usableFfmpegPathPromise = resolveUsableFfmpegPath();
  }
  return usableFfmpegPathPromise;
}

async function resolveUsableFfmpegPath() {
  const candidates = [
    process.env.SHOTCOMPARE_FFMPEG_PATH,
    bundledFfmpegPath,
    "ffmpeg"
  ].filter(Boolean);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      await ensureFfmpegExecutable(candidate);
      await runFfmpeg(candidate, ["-version"]);
      return candidate;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("找不到可用 FFmpeg。");
}

async function ensureFfmpegExecutable(executablePath) {
  if (process.platform === "win32" || !path.isAbsolute(executablePath)) return;
  try {
    const stat = await fs.stat(executablePath);
    if ((stat.mode & 0o111) === 0) {
      await fs.chmod(executablePath, 0o755);
    }
  } catch {
    throw new Error("FFmpeg 不可执行。");
  }
}

function runFfmpeg(executablePath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 4000) {
        stdout = stdout.slice(-4000);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) {
        stderr = stderr.slice(-4000);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `FFmpeg exited with code ${code}`));
    });
  });
}

async function createClipCacheDir() {
  const root = getClipCacheRoot();
  const runDir = path.join(root, `run-${Date.now()}`);
  await fs.mkdir(runDir, { recursive: true });
  return runDir;
}

function getClipCacheRoot() {
  return path.join(app.getPath("temp"), "shotcompare-drag-cache");
}

async function cleanupOldClipCaches() {
  const root = getClipCacheRoot();
  const now = Date.now();
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;

  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory()) return;
      const entryPath = path.join(root, entry.name);
      const stat = await fs.stat(entryPath).catch(() => null);
      if (stat && now - stat.mtimeMs > maxAgeMs) {
        await fs.rm(entryPath, { recursive: true, force: true });
      }
    }));
  } catch {
    await fs.mkdir(root, { recursive: true }).catch(() => {});
  }
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function sanitizeAssetId(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sendDragStatus(webContents, level, message) {
  if (webContents.isDestroyed()) return;
  webContents.send("shotcompare:drag-status", { level, message });
}

function getErrorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}
