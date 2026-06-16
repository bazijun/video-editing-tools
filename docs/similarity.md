# Similarity Engine Notes

## Current Choice

The demo now uses the npm package `blockhash` as the first perceptual image hashing engine.

Reason:

- It is small enough for a browser demo.
- It works from canvas `ImageData`.
- It implements block mean value based perceptual hashing instead of a completely custom hash.
- It is cross-platform when bundled through Vite.

Supporting dependencies:

- `png-js`
- `jpeg-js`

Those are required because the published `blockhash` package imports them at module load time.

## Why The First Demo Missed Matches

The first implementation compared only one representative frame per scene-like segment. If one source video contains repeated action but the auto scene splitter leaves it as one long segment, there is nothing to compare. If the representative frame lands on a different moment in the action, the candidate is also missed.

The current implementation adds:

- fixed sliding windows inside each video
- multiple frame signatures per segment/window
- intra-video overlap filtering
- a looser default similarity threshold

This makes it more suitable for finding repeated shots inside the same video.

## Product Direction

For the real desktop version, treat `blockhash` as the baseline, not the final engine.

Recommended next engines to evaluate:

- FFmpeg scene detection for cut/scene boundaries
- OpenCV.js for browser/WASM experiments
- Native OpenCV or Python/OpenCV worker for heavier desktop analysis
- CLIP or other embedding models only after the non-AI workflow is useful

The likely production flow is:

```text
ffprobe metadata
-> ffmpeg/proxy frame extraction
-> scene/window candidates
-> perceptual hash prefilter
-> OpenCV/embedding rerank
-> side-by-side comparison
```
