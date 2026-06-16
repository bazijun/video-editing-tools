const path = require("node:path");

const MAX_CLIP_DURATION_MS = 10 * 60 * 1000;

function normalizeClipPayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const startMs = Math.max(0, Math.round(Number(source.startMs)));
  const endMs = Math.max(0, Math.round(Number(source.endMs)));

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("Invalid clip range");
  }

  const durationMs = endMs - startMs;
  if (durationMs > MAX_CLIP_DURATION_MS) {
    throw new Error("Invalid clip range: clip is too long");
  }

  return {
    segmentId: normalizeId(source.segmentId, "segment"),
    assetId: normalizeId(source.assetId, "asset"),
    filename: String(source.filename || "clip"),
    startMs,
    endMs,
    durationMs,
    startTimecode: String(source.startTimecode || ""),
    endTimecode: String(source.endTimecode || "")
  };
}

function normalizeId(value, fallback) {
  const text = String(value || "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || fallback;
}

function buildClipOutputPath(cacheDir, payload) {
  const normalizedPayload = normalizeClipPayload(payload);
  const filename = [
    normalizedPayload.assetId,
    normalizedPayload.segmentId,
    safeFilenamePart(normalizedPayload.filename),
    normalizedPayload.startMs,
    normalizedPayload.endMs
  ].join("-");

  return path.join(cacheDir, `${filename}.mp4`);
}

function safeFilenamePart(filename) {
  const base = path.basename(String(filename || "clip"), path.extname(String(filename || "")));
  const safe = base
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return safe || "clip";
}

function buildStreamCopyArgs({ sourcePath, outputPath, startMs, durationMs }) {
  return [
    "-y",
    "-ss",
    formatSeconds(startMs),
    "-t",
    formatSeconds(durationMs),
    "-i",
    sourcePath,
    "-map",
    "0",
    "-c",
    "copy",
    "-avoid_negative_ts",
    "make_zero",
    "-movflags",
    "+faststart",
    outputPath
  ];
}

function buildTranscodeArgs({ sourcePath, outputPath, startMs, durationMs }) {
  return [
    "-y",
    "-ss",
    formatSeconds(startMs),
    "-t",
    formatSeconds(durationMs),
    "-i",
    sourcePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    outputPath
  ];
}

function formatSeconds(milliseconds) {
  return (Math.max(0, Number(milliseconds) || 0) / 1000).toFixed(3);
}

module.exports = {
  buildClipOutputPath,
  buildStreamCopyArgs,
  buildTranscodeArgs,
  normalizeClipPayload,
  safeFilenamePart
};
