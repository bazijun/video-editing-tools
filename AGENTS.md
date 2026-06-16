# Development Instructions

## Scope

- This repository starts with a browser-based workflow demo for ShotCompare.
- Keep the demo dependency-free unless a later task explicitly introduces a build stack.
- Do not add AI, cloud upload, accounts, or CapCut/Jianying draft editing in the demo phase.
- Original video files must remain read-only.

## Product Priorities

1. Help editors find visually similar shots faster.
2. Turn serial timeline scrubbing into side-by-side comparison.
3. Work locally on macOS and Windows.
4. Stay friendly to low-spec Windows machines.
5. Produce practical timecode exports that can be used beside Jianying/CapCut.

## Engineering Rules

- Prefer small, testable increments over a large Electron app all at once.
- Use browser APIs for the first demo: file input, video element, canvas sampling, and Blob downloads.
- Do not assume browser file inputs expose absolute paths.
- Do not modify source videos.
- Avoid long blocking loops where possible; yield back to the UI during analysis.
- Keep UI controls functional and dense; this is a working tool, not a landing page.

## Later Electron Phase

When the workflow is validated, migrate the useful parts to:

- Electron
- React
- TypeScript
- Vite or electron-vite
- FFmpeg / ffprobe through `spawn` argument arrays
- SQLite only after JSON/browser state stops being enough

Renderer code in Electron must never directly access Node APIs. Privileged operations must go through a typed preload bridge.
