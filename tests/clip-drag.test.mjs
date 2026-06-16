import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  buildClipOutputPath,
  buildStreamCopyArgs,
  buildTranscodeArgs,
  normalizeClipPayload,
  safeFilenamePart
} from "../electron/clip-drag.cjs";

describe("clip drag helpers", () => {
  it("normalizes a renderer payload into bounded clip timing", () => {
    const payload = normalizeClipPayload({
      segmentId: "segment-3",
      assetId: "asset-2",
      filename: "take.mov",
      startMs: 2500.4,
      endMs: 4800.9,
      startTimecode: "00:00:02.500",
      endTimecode: "00:00:04.801"
    });

    assert.deepEqual(payload, {
      segmentId: "segment-3",
      assetId: "asset-2",
      filename: "take.mov",
      startMs: 2500,
      endMs: 4801,
      durationMs: 2301,
      startTimecode: "00:00:02.500",
      endTimecode: "00:00:04.801"
    });
  });

  it("rejects invalid or empty clip ranges", () => {
    assert.throws(
      () => normalizeClipPayload({ segmentId: "segment-1", assetId: "asset-1", startMs: 5000, endMs: 5000 }),
      /Invalid clip range/
    );
  });

  it("creates a safe mp4 output path inside the drag cache", () => {
    const outputPath = buildClipOutputPath("/tmp/shotcompare", {
      segmentId: "segment-7",
      assetId: "asset-1",
      filename: "../A:B? take.mov",
      startMs: 1200,
      endMs: 3450
    });

    assert.equal(path.dirname(outputPath), "/tmp/shotcompare");
    assert.equal(path.basename(outputPath), "asset-1-segment-7-A-B-take-1200-3450.mp4");
  });

  it("sanitizes filename pieces without returning an empty string", () => {
    assert.equal(safeFilenamePart("../alpha beta.mov"), "alpha-beta");
    assert.equal(safeFilenamePart("????"), "clip");
  });

  it("builds ffmpeg stream-copy arguments as an argument array", () => {
    const args = buildStreamCopyArgs({
      sourcePath: "/videos/source.mov",
      outputPath: "/tmp/clip.mp4",
      startMs: 1500,
      durationMs: 2500
    });

    assert.deepEqual(args, [
      "-y",
      "-ss",
      "1.500",
      "-t",
      "2.500",
      "-i",
      "/videos/source.mov",
      "-map",
      "0",
      "-c",
      "copy",
      "-avoid_negative_ts",
      "make_zero",
      "-movflags",
      "+faststart",
      "/tmp/clip.mp4"
    ]);
  });

  it("builds ffmpeg transcode fallback arguments as an argument array", () => {
    const args = buildTranscodeArgs({
      sourcePath: "/videos/source.webm",
      outputPath: "/tmp/clip.mp4",
      startMs: 0,
      durationMs: 1800
    });

    assert.deepEqual(args, [
      "-y",
      "-ss",
      "0.000",
      "-t",
      "1.800",
      "-i",
      "/videos/source.webm",
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
      "/tmp/clip.mp4"
    ]);
  });
});
