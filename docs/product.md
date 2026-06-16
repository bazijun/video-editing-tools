# ShotCompare

## Problem

Short-video editors often receive many repeated takes of the same action, composition, product shot, or facial expression. The painful part is finding the right one. They repeatedly open clips, scrub timelines, remember candidates, and compare them mentally.

ShotCompare should make similar visual material appear together so the editor can choose by comparison instead of memory.

## Target User

- Primarily Windows users
- Often using Jianying/CapCut
- Editing short-form content such as beauty, ecommerce, auto, daily vlog, product, and influencer material
- May use a low-spec computer
- Needs a local workflow that does not upload private source footage

## Demo Goal

Build a local browser demo that proves the workflow:

```text
Select videos
-> sample frames locally
-> split rough visual segments
-> cluster similar segments
-> compare candidates on one screen
-> copy timecodes or drag trimmed clips toward Jianying/CapCut
```

## Electron Drag Target

The browser demo cannot drag a real trimmed video file into Jianying/CapCut. The Electron version should expose this preload API:

```ts
window.shotCompareHost.startClipDrag({
  segmentId: string,
  assetId: string,
  filename: string,
  displayPath: string,
  startMs: number,
  endMs: number,
  startTimecode: string,
  endTimecode: string,
})
```

The main process should generate a temporary trimmed MP4 through FFmpeg, then call Electron native drag with the temporary file path.

## MVP Features

- Select multiple local videos or a local folder.
- Read video duration and dimensions in the browser.
- Sample frames at a configurable interval.
- Compute visual fingerprints from canvas pixels.
- Split video into rough scene segments.
- Cluster visually similar segments.
- Show similar groups sorted by candidate count.
- Compare up to four clips in a synchronized 2x2 wall.
- Copy or drag filename/timecode text directly from a compare card.
- Copy or export filename/timecode rows.

## Non-goals For The Demo

- No AI semantic understanding.
- No cloud upload.
- No account system.
- No direct Jianying/CapCut project editing.
- No original file modification.
- No FFmpeg clip export yet.

## Technical Notes

The browser demo cannot access absolute local paths. That is a browser security feature. The future Electron app can solve this with a typed preload bridge and native file system access.

The first similarity algorithm is intentionally simple: frame hashes, color histograms, and threshold-based clustering. It is good enough to validate the workflow before investing in FFmpeg, proxy generation, SQLite, or AI models.
