const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "mkv", "webm"]);
const HASH_BITS = 8;
const HASH_METHOD = 2;
const MAX_SEGMENT_SIGNATURE_FRAMES = 5;
const MAX_WINDOWS_PER_ASSET = 140;
const MIN_REPEAT_GAP_SECONDS = 1.2;
let hashEnginePromise = null;
let hashEngineName = "local-fallback";

const dom = {
  fileInput: document.querySelector("#fileInput"),
  folderInput: document.querySelector("#folderInput"),
  pickFilesButton: document.querySelector("#pickFilesButton"),
  pickFolderButton: document.querySelector("#pickFolderButton"),
  analyzeButton: document.querySelector("#analyzeButton"),
  cancelButton: document.querySelector("#cancelButton"),
  sampleInterval: document.querySelector("#sampleInterval"),
  sceneThreshold: document.querySelector("#sceneThreshold"),
  sceneThresholdValue: document.querySelector("#sceneThresholdValue"),
  similarityThreshold: document.querySelector("#similarityThreshold"),
  similarityThresholdValue: document.querySelector("#similarityThresholdValue"),
  maxSamples: document.querySelector("#maxSamples"),
  showSoloGroups: document.querySelector("#showSoloGroups"),
  placementButtons: document.querySelectorAll("[data-default-placement]"),
  assetSummary: document.querySelector("#assetSummary"),
  assetList: document.querySelector("#assetList"),
  groupSummary: document.querySelector("#groupSummary"),
  groupList: document.querySelector("#groupList"),
  activeGroupTitle: document.querySelector("#activeGroupTitle"),
  activeGroupMeta: document.querySelector("#activeGroupMeta"),
  candidateSummary: document.querySelector("#candidateSummary"),
  segmentGrid: document.querySelector("#segmentGrid"),
  stageColumn: document.querySelector("#stageColumn"),
  compareGrid: document.querySelector("#compareGrid"),
  clearCompareButton: document.querySelector("#clearCompareButton"),
  moveAllToCompareButton: document.querySelector("#moveAllToCompareButton"),
  fullscreenCompareButton: document.querySelector("#fullscreenCompareButton"),
  restartCompareButton: document.querySelector("#restartCompareButton"),
  pauseCompareButton: document.querySelector("#pauseCompareButton"),
  playCompareButton: document.querySelector("#playCompareButton"),
  loopCompare: document.querySelector("#loopCompare"),
  statusText: document.querySelector("#statusText"),
  metricText: document.querySelector("#metricText")
};

const state = {
  assets: [],
  segments: [],
  groups: [],
  activeGroupId: null,
  compareSegmentIds: [],
  initialPlacement: "compare",
  analysisPlacement: "compare",
  analyzing: false,
  analysisQueued: false,
  cancelRequested: false,
  nextAssetNumber: 1,
  nextSegmentNumber: 1,
  nextGroupNumber: 1,
  toastTimer: null
};

dom.pickFilesButton.addEventListener("click", () => dom.fileInput.click());
dom.pickFolderButton.addEventListener("click", () => dom.folderInput.click());
dom.placementButtons.forEach((button) => {
  button.addEventListener("click", () => setInitialPlacement(button.dataset.defaultPlacement));
});
dom.fileInput.addEventListener("change", (event) => {
  handleFiles(event.target.files);
  event.target.value = "";
});
dom.folderInput.addEventListener("change", (event) => {
  handleFiles(event.target.files);
  event.target.value = "";
});
dom.analyzeButton.addEventListener("click", analyzeAssets);
dom.cancelButton.addEventListener("click", () => {
  state.cancelRequested = true;
  setStatus("正在取消当前分析任务...");
});
dom.showSoloGroups.addEventListener("change", rebuildGroups);
dom.sceneThreshold.addEventListener("input", () => {
  dom.sceneThresholdValue.textContent = Number(dom.sceneThreshold.value).toFixed(2);
});
dom.similarityThreshold.addEventListener("input", () => {
  dom.similarityThresholdValue.textContent = Number(dom.similarityThreshold.value).toFixed(2);
  if (state.segments.length > 0) {
    rebuildGroups();
  }
});
dom.clearCompareButton.addEventListener("click", () => {
  state.compareSegmentIds = [];
  renderCompareGrid();
  renderSegments();
});
dom.moveAllToCompareButton.addEventListener("click", moveAllCandidatesToCompare);
dom.fullscreenCompareButton.addEventListener("click", toggleCompareFullscreen);
dom.restartCompareButton.addEventListener("click", restartCompare);
dom.pauseCompareButton.addEventListener("click", pauseCompare);
dom.playCompareButton.addEventListener("click", playCompare);

dom.groupList.addEventListener("click", (event) => {
  const groupRow = event.target.closest("[data-group-id]");
  if (!groupRow) return;
  state.activeGroupId = groupRow.dataset.groupId;
  applyInitialPlacementToActiveGroup();
  render();
});

dom.segmentGrid.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const segmentId = button.closest("[data-segment-id]")?.dataset.segmentId;
  if (!segmentId) return;

  if (button.dataset.action === "move-to-compare") {
    moveToCompare(segmentId);
  }
});

dom.compareGrid.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action], button[data-remove-slot]");
  if (!button) return;
  const segmentId = button.closest("[data-segment-id]")?.dataset.segmentId || button.dataset.removeSlot;
  if (!segmentId) return;

  if (button.dataset.removeSlot || button.dataset.action === "move-to-similar") {
    moveToCandidates(segmentId);
  }
  if (button.dataset.action === "copy-timecode") {
    copyText(formatSegmentForClipboard(getSegment(segmentId)));
  }
  if (button.dataset.action === "drag-clip") {
    requestClipDrag(segmentId);
  }
});

dom.compareGrid.addEventListener("dragstart", (event) => {
  const handle = event.target.closest("[data-drag-clip]");
  if (!handle) return;
  const segment = getSegment(handle.closest("[data-segment-id]")?.dataset.segmentId);
  if (!segment) return;
  if (tryHostClipDrag(segment)) {
    event.preventDefault();
    return;
  }
  if (!event.dataTransfer) return;
  const text = formatClipFallbackText(segment);
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("text/plain", text);
  setStatus("浏览器 demo 只能拖拽片段说明；桌面版会生成临时视频片段并拖入剪映。");
});

window.addEventListener("beforeunload", () => {
  if (typeof unsubscribeHostDragStatus === "function") {
    unsubscribeHostDragStatus();
  }
  for (const asset of state.assets) {
    URL.revokeObjectURL(asset.url);
  }
});

document.addEventListener("fullscreenchange", renderFullscreenButton);

const unsubscribeHostDragStatus = window.shotCompareHost?.onDragStatus?.((status) => {
  if (!status?.message) return;
  setStatus(status.message);
  if (status.level === "error" || status.level === "warning") {
    toast(status.message);
  }
});

render();

function handleFiles(fileList) {
  const incomingFiles = Array.from(fileList || []).filter(isVideoFile);
  if (incomingFiles.length === 0) {
    toast("没有发现可用的视频文件。");
    return;
  }

  const existingKeys = new Set(state.assets.map((asset) => asset.fileKey));
  const freshAssets = [];

  for (const file of incomingFiles) {
    const fileKey = `${file.name}-${file.size}-${file.lastModified}`;
    if (existingKeys.has(fileKey)) continue;
    existingKeys.add(fileKey);
    const asset = createAsset(file, fileKey);
    registerHostSourceFile(asset, file);
    freshAssets.push(asset);
  }

  state.assets.push(...freshAssets);
  setStatus(`已加入 ${freshAssets.length} 个视频，开始自动分析。`);
  render();
  if (state.analyzing) {
    state.analysisQueued = true;
    return;
  }

  void analyzeAssets();
}

function createAsset(file, fileKey) {
  return {
    id: `asset-${state.nextAssetNumber++}`,
    file,
    fileKey,
    url: URL.createObjectURL(file),
    name: file.name,
    displayPath: file.webkitRelativePath || file.name,
    size: file.size,
    status: "ready",
    progress: 0,
    duration: 0,
    width: 0,
    height: 0,
    frames: [],
    segments: [],
    error: ""
  };
}

function registerHostSourceFile(asset, file) {
  const registerSourceFile = window.shotCompareHost?.registerSourceFile;
  if (typeof registerSourceFile !== "function") return;

  void registerSourceFile(asset.id, file).then((result) => {
    if (!result?.ok) {
      asset.hostFileStatus = "unavailable";
    }
  }).catch(() => {
    asset.hostFileStatus = "unavailable";
  });
}

function isVideoFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return file.type.startsWith("video/") || VIDEO_EXTENSIONS.has(extension);
}

async function analyzeAssets() {
  if (state.analyzing) {
    state.analysisQueued = true;
    return;
  }

  state.analysisPlacement = state.initialPlacement;
  const targets = state.assets.filter((asset) => asset.status !== "done");
  if (targets.length === 0 && state.assets.length > 0) {
    rebuildGroups();
    applyInitialPlacementToActiveGroup();
    toast("已用现有分析结果重新聚类。");
    return;
  }

  state.analyzing = true;
  state.analysisQueued = false;
  state.cancelRequested = false;
  state.segments = [];
  state.groups = [];
  state.activeGroupId = null;
  state.compareSegmentIds = [];
  render();

  try {
    for (const asset of targets) {
      if (state.cancelRequested) break;
      await analyzeAsset(asset);
      state.segments = state.assets.flatMap((item) => item.segments);
      rebuildGroups({ keepStatus: true });
      await nextFrame();
    }
  } finally {
    const shouldAnalyzeQueuedFiles = state.analysisQueued && !state.cancelRequested;
    state.analyzing = false;
    const wasCancelled = state.cancelRequested;
    state.cancelRequested = false;
    rebuildGroups();
    applyInitialPlacementToActiveGroup();
    setStatus(
      state.groups.length > 0
        ? (state.analysisPlacement === "compare" ? "分析完成。最相似的一组已初始放入对比区。" : "分析完成。最相似的一组已初始放入相似区。")
        : "分析完成，但没有找到重复相似分组。可以打开“显示单段”。"
    );
    if (shouldAnalyzeQueuedFiles && !wasCancelled) {
      void analyzeAssets();
    }
  }
}

async function analyzeAsset(asset) {
  asset.status = "analyzing";
  asset.progress = 0;
  asset.error = "";
  asset.frames = [];
  asset.segments = [];
  setStatus(`正在分析：${asset.name}`);
  render();

  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;

  try {
    const metadataReady = waitForVideoMetadata(video);
    video.src = asset.url;
    video.load();
    await metadataReady;
    asset.duration = Number.isFinite(video.duration) ? video.duration : 0;
    asset.width = video.videoWidth || 0;
    asset.height = video.videoHeight || 0;

    if (!asset.duration || asset.duration <= 0) {
      throw new Error("浏览器无法读取视频时长");
    }

    const sampleInterval = Number(dom.sampleInterval.value);
    const maxSamples = Number(dom.maxSamples.value);
    const sampleCount = Math.max(1, Math.min(maxSamples, Math.ceil(asset.duration / sampleInterval)));
    const step = asset.duration / sampleCount;
    const featureCanvas = document.createElement("canvas");
    const featureContext = featureCanvas.getContext("2d", { willReadFrequently: true });
    const thumbCanvas = document.createElement("canvas");
    const thumbContext = thumbCanvas.getContext("2d");
    featureCanvas.width = 32;
    featureCanvas.height = 32;
    thumbCanvas.width = 240;
    thumbCanvas.height = 135;

    for (let index = 0; index < sampleCount; index += 1) {
      if (state.cancelRequested) {
        throw new Error("用户取消");
      }

      const time = Math.min(asset.duration, index * step);
      const safeEnd = Math.max(0, asset.duration - 0.08);
      const seekTime = time === 0 ? Math.min(0.04, safeEnd) : Math.min(time, safeEnd);
      await seekVideo(video, Math.max(0, seekTime));
      drawVideoFrame(video, featureContext, featureCanvas.width, featureCanvas.height);
      drawVideoFrame(video, thumbContext, thumbCanvas.width, thumbCanvas.height);

      const feature = await readFrameFeature(featureContext, featureCanvas.width, featureCanvas.height);
      const thumb = thumbCanvas.toDataURL("image/jpeg", 0.66);
      asset.frames.push({ time, feature, thumb });
      asset.progress = (index + 1) / sampleCount;

      if (index % 4 === 0 || index === sampleCount - 1) {
        renderAssets();
        await nextFrame();
      }
    }

    asset.segments = buildSegments(asset, asset.frames);
    asset.status = "done";
    asset.progress = 1;
  } catch (error) {
    asset.status = state.cancelRequested ? "ready" : "error";
    asset.error = error instanceof Error ? error.message : "分析失败";
    asset.progress = 0;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

function waitForVideoMetadata(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1) {
      resolve();
      return;
    }

    const cleanup = () => {
      video.removeEventListener("loadedmetadata", handleMetadata);
      video.removeEventListener("error", handleError);
    };
    const handleMetadata = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("当前浏览器不支持读取该视频"));
    };
    video.addEventListener("loadedmetadata", handleMetadata, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) {
      requestAnimationFrame(resolve);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("视频定位超时"));
    }, 8000);
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
    };
    const handleSeeked = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("视频定位失败"));
    };
    video.addEventListener("seeked", handleSeeked, { once: true });
    video.addEventListener("error", handleError, { once: true });
    video.currentTime = time;
  });
}

function drawVideoFrame(video, context, width, height) {
  context.fillStyle = "#111516";
  context.fillRect(0, 0, width, height);
  const videoRatio = video.videoWidth / video.videoHeight;
  const canvasRatio = width / height;
  let drawWidth = width;
  let drawHeight = height;
  let drawX = 0;
  let drawY = 0;

  if (videoRatio > canvasRatio) {
    drawHeight = width / videoRatio;
    drawY = (height - drawHeight) / 2;
  } else {
    drawWidth = height * videoRatio;
    drawX = (width - drawWidth) / 2;
  }

  context.drawImage(video, drawX, drawY, drawWidth, drawHeight);
}

async function readFrameFeature(context, width, height) {
  const imageData = context.getImageData(0, 0, width, height).data;
  const cells = new Array(64).fill(0);
  const counts = new Array(64).fill(0);
  const histogram = new Array(64).fill(0);
  const average = [0, 0, 0];
  const totalPixels = width * height;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const r = imageData[offset];
      const g = imageData[offset + 1];
      const b = imageData[offset + 2];
      const gray = r * 0.299 + g * 0.587 + b * 0.114;
      const cellX = Math.min(7, Math.floor((x / width) * 8));
      const cellY = Math.min(7, Math.floor((y / height) * 8));
      const cellIndex = cellY * 8 + cellX;
      const rBin = Math.min(3, r >> 6);
      const gBin = Math.min(3, g >> 6);
      const bBin = Math.min(3, b >> 6);

      cells[cellIndex] += gray;
      counts[cellIndex] += 1;
      histogram[rBin * 16 + gBin * 4 + bBin] += 1;
      average[0] += r;
      average[1] += g;
      average[2] += b;
    }
  }

  const normalizedCells = cells.map((value, index) => value / Math.max(1, counts[index]));
  const hash = await createPerceptualHash(context, width, height, normalizedCells);

  return {
    hash,
    histogram: histogram.map((value) => value / totalPixels),
    average: average.map((value) => value / totalPixels / 255)
  };
}

function buildSegments(asset, frames) {
  if (frames.length === 0) return [];
  const sceneSegments = buildSceneSegments(asset, frames);
  const windowSegments = buildSlidingWindowSegments(asset, frames);
  return dedupeSegments([...sceneSegments, ...windowSegments]);
}

function buildSceneSegments(asset, frames) {
  const threshold = Number(dom.sceneThreshold.value);
  const segments = [];
  let startIndex = 0;

  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1];
    const current = frames[index];
    const distance = featureDistance(previous.feature, current.feature);
    if (distance >= threshold) {
      pushSegment(asset, frames, segments, startIndex, index - 1, current.time);
      startIndex = index;
    }
  }

  pushSegment(asset, frames, segments, startIndex, frames.length - 1, asset.duration);
  return segments.filter((segment) => segment.end - segment.start >= 0.25);
}

function buildSlidingWindowSegments(asset, frames) {
  const segments = [];
  if (asset.duration <= 0 || frames.length === 0) return segments;

  const windowLength = clamp(asset.duration / 5, 1.2, 4);
  const windowStep = clamp(windowLength / 2, 0.6, 2);
  let start = 0;

  while (start < asset.duration && segments.length < MAX_WINDOWS_PER_ASSET) {
    const end = Math.min(asset.duration, start + windowLength);
    const startIndex = closestFrameIndex(frames, start);
    const endIndex = closestFrameIndex(frames, Math.max(start, end - 0.001));
    pushSegment(asset, frames, segments, startIndex, Math.max(startIndex, endIndex), end, "window");

    if (end >= asset.duration) break;
    start += windowStep;
  }

  return segments.filter((segment) => segment.duration >= 0.5);
}

function pushSegment(asset, frames, segments, startIndex, endIndex, endTime, kind = "scene") {
  const representativeIndex = Math.floor((startIndex + endIndex) / 2);
  const representative = frames[representativeIndex] || frames[startIndex];
  const start = frames[startIndex].time;
  const end = Math.max(start + 0.3, Math.min(asset.duration, endTime));
  const signature = buildSegmentSignature(frames, startIndex, endIndex);

  segments.push({
    id: `segment-${state.nextSegmentNumber++}`,
    assetId: asset.id,
    assetName: asset.name,
    displayPath: asset.displayPath,
    start,
    end,
    duration: end - start,
    feature: representative.feature,
    signature,
    thumb: representative.thumb,
    frameCount: endIndex - startIndex + 1,
    kind
  });
}

function buildSegmentSignature(frames, startIndex, endIndex) {
  const safeStart = Math.max(0, startIndex);
  const safeEnd = Math.min(frames.length - 1, endIndex);
  const span = Math.max(0, safeEnd - safeStart);
  const count = Math.min(MAX_SEGMENT_SIGNATURE_FRAMES, span + 1);
  const signature = [];

  for (let index = 0; index < count; index += 1) {
    const ratio = count === 1 ? 0.5 : index / (count - 1);
    const frame = frames[Math.round(safeStart + span * ratio)];
    if (frame?.feature) {
      signature.push(frame.feature);
    }
  }

  return signature.length > 0 ? signature : [frames[safeStart].feature];
}

function dedupeSegments(segments) {
  const result = [];
  const sortedSegments = segments.slice().sort((left, right) => left.start - right.start || right.duration - left.duration);

  for (const segment of sortedSegments) {
    const duplicate = result.some((existing) => (
      existing.assetId === segment.assetId
      && Math.abs(existing.start - segment.start) < 0.25
      && Math.abs(existing.end - segment.end) < 0.25
    ));

    if (!duplicate) {
      result.push(segment);
    }
  }

  return result;
}

function closestFrameIndex(frames, time) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < frames.length; index += 1) {
    const distance = Math.abs(frames[index].time - time);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
}

function rebuildGroups(options = {}) {
  state.segments = state.assets.flatMap((asset) => asset.segments);
  state.groups = clusterSegments(state.segments);

  if (!state.groups.some((group) => group.id === state.activeGroupId)) {
    state.activeGroupId = state.groups[0]?.id || null;
  }

  if (!options.keepStatus) {
    applyInitialPlacementToActiveGroup();
    render();
  }
}

function clusterSegments(segments) {
  const threshold = Number(dom.similarityThreshold.value);
  const groups = [];

  for (const segment of segments) {
    let bestGroup = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const group of groups) {
      const distance = groupDistance(segment, group);
      if (distance < threshold && distance < bestDistance) {
        bestGroup = group;
        bestDistance = distance;
      }
    }

    if (bestGroup) {
      bestGroup.segments.push(segment);
      bestGroup.minDistance = Math.min(bestGroup.minDistance, bestDistance);
      continue;
    }

    groups.push({
      id: `group-${state.nextGroupNumber++}`,
      representative: segment,
      thumb: segment.thumb,
      minDistance: 0,
      segments: [segment]
    });
  }

  const visibleGroups = dom.showSoloGroups.checked ? groups : groups.filter((group) => group.segments.length > 1);
  return visibleGroups.sort((left, right) => {
    if (right.segments.length !== left.segments.length) return right.segments.length - left.segments.length;
    return right.segments.reduce((sum, segment) => sum + segment.duration, 0) - left.segments.reduce((sum, segment) => sum + segment.duration, 0);
  });
}

function groupDistance(segment, group) {
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of group.segments.slice(-8)) {
    const distance = segmentDistance(segment, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
    }
  }

  return bestDistance;
}

function segmentDistance(left, right) {
  if (!left || !right) return 1;
  if (left.assetId === right.assetId) {
    if (segmentsOverlapRatio(left, right) > 0.35) return Number.POSITIVE_INFINITY;
    if (Math.abs(left.start - right.start) < MIN_REPEAT_GAP_SECONDS) return Number.POSITIVE_INFINITY;
  }

  const leftSignature = left.signature?.length ? left.signature : [left.feature];
  const rightSignature = right.signature?.length ? right.signature : [right.feature];
  const distances = [];

  for (const leftFeature of leftSignature) {
    let best = Number.POSITIVE_INFINITY;
    for (const rightFeature of rightSignature) {
      best = Math.min(best, featureDistance(leftFeature, rightFeature));
    }
    distances.push(best);
  }

  distances.sort((a, b) => a - b);
  const kept = distances.slice(0, Math.max(1, Math.ceil(distances.length * 0.6)));
  return kept.reduce((sum, value) => sum + value, 0) / kept.length;
}

function segmentsOverlapRatio(left, right) {
  const overlap = Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
  const shortest = Math.min(left.duration, right.duration);
  return shortest > 0 ? overlap / shortest : 0;
}

function featureDistance(left, right) {
  if (!left || !right) return 1;
  let hashDistance = 0;
  for (let index = 0; index < left.hash.length; index += 1) {
    if (left.hash[index] !== right.hash[index]) hashDistance += 1;
  }
  hashDistance /= left.hash.length;

  let histogramDistance = 0;
  for (let index = 0; index < left.histogram.length; index += 1) {
    histogramDistance += Math.abs(left.histogram[index] - right.histogram[index]);
  }
  histogramDistance = Math.min(1, histogramDistance / 2);

  const colorDistance = Math.hypot(
    left.average[0] - right.average[0],
    left.average[1] - right.average[1],
    left.average[2] - right.average[2]
  ) / Math.sqrt(3);

  return hashDistance * 0.62 + histogramDistance * 0.28 + colorDistance * 0.1;
}

async function createPerceptualHash(context, width, height, normalizedCells) {
  const imageData = context.getImageData(0, 0, width, height);
  const openSourceHash = await createOpenSourceBlockHash(imageData);
  if (openSourceHash) {
    return openSourceHash;
  }

  const meanGray = normalizedCells.reduce((sum, value) => sum + value, 0) / normalizedCells.length;
  return normalizedCells.map((value) => (value >= meanGray ? "1" : "0")).join("");
}

async function createOpenSourceBlockHash(imageData) {
  const engine = await getHashEngine();
  if (!engine) return "";

  try {
    const exported = engine.default || engine;
    const blockhashData = engine.blockhashData || exported.blockhashData;
    const bmvbhash = engine.bmvbhash || exported.bmvbhash;
    const source = {
      data: imageData.data,
      width: imageData.width,
      height: imageData.height
    };

    let rawHash = "";
    if (typeof blockhashData === "function") {
      rawHash = blockhashData(source, HASH_BITS, HASH_METHOD);
    } else if (typeof bmvbhash === "function") {
      rawHash = bmvbhash(source, HASH_BITS);
    }

    return normalizeHash(rawHash);
  } catch {
    hashEngineName = "local-fallback";
    return "";
  }
}

async function getHashEngine() {
  if (!hashEnginePromise) {
    hashEnginePromise = import("blockhash")
      .then((engine) => {
        hashEngineName = "blockhash";
        return engine;
      })
      .catch(() => {
        hashEngineName = "local-fallback";
        return null;
      });
  }

  return hashEnginePromise;
}

function normalizeHash(rawHash) {
  if (Array.isArray(rawHash)) {
    return rawHash.map((value) => (Number(value) > 0 ? "1" : "0")).join("");
  }

  const text = String(rawHash || "");
  if (/^[01]+$/.test(text)) return text;
  if (/^[0-9a-f]+$/i.test(text)) {
    return [...text]
      .map((character) => Number.parseInt(character, 16).toString(2).padStart(4, "0"))
      .join("");
  }

  return "";
}

function moveToCompare(segmentId) {
  if (!getSegment(segmentId) || state.compareSegmentIds.includes(segmentId)) return;
  state.compareSegmentIds.push(segmentId);
  renderCompareGrid();
  renderSegments();
}

function moveToCandidates(segmentId) {
  state.compareSegmentIds = state.compareSegmentIds.filter((id) => id !== segmentId);
  pauseSegmentVideo(segmentId);
  renderCompareGrid();
  renderSegments();
}

function moveAllCandidatesToCompare() {
  const activeGroup = getActiveGroup();
  if (!activeGroup) return;
  const existing = new Set(state.compareSegmentIds);
  const nextIds = activeGroup.segments.map((segment) => segment.id);
  for (const id of nextIds) {
    existing.add(id);
  }
  state.compareSegmentIds = activeGroup.segments
    .map((segment) => segment.id)
    .filter((id) => existing.has(id));
  renderCompareGrid();
  renderSegments();
}

function applyInitialPlacementToActiveGroup() {
  if (state.analysisPlacement === "compare") {
    fillCompareFromActiveGroup();
    return;
  }

  state.compareSegmentIds = [];
}

function fillCompareFromActiveGroup() {
  const activeGroup = getActiveGroup();
  state.compareSegmentIds = activeGroup ? activeGroup.segments.map((segment) => segment.id) : [];
}

function setInitialPlacement(placement) {
  state.initialPlacement = placement === "similar" ? "similar" : "compare";
  renderInitialPlacement();
}

function renderInitialPlacement() {
  dom.placementButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.defaultPlacement === state.initialPlacement);
  });
}

function pauseSegmentVideo(segmentId) {
  const video = Array.from(dom.compareGrid.querySelectorAll("video[data-segment-id]"))
    .find((item) => item.dataset.segmentId === segmentId);
  video?.pause();
}

function requestClipDrag(segmentId) {
  const segment = getSegment(segmentId);
  if (!segment) return;
  if (tryHostClipDrag(segment)) {
    setStatus(`正在准备可拖拽片段：${segment.assetName}`);
    return;
  }

  copyText(formatClipFallbackText(segment));
  toast("浏览器版不能生成可拖拽视频文件，已复制片段信息。Electron 版会用 FFmpeg 生成临时片段后拖进剪映。");
}

function tryHostClipDrag(segment) {
  const dragClip = window.shotCompareHost?.startClipDrag;
  if (typeof dragClip !== "function") return false;

  const payload = buildClipDragPayload(segment);
  dragClip(payload);
  return true;
}

function buildClipDragPayload(segment) {
  return {
    segmentId: segment.id,
    assetId: segment.assetId,
    filename: segment.assetName,
    displayPath: segment.displayPath,
    startMs: Math.round(segment.start * 1000),
    endMs: Math.round(segment.end * 1000),
    startTimecode: formatTimecode(segment.start),
    endTimecode: formatTimecode(segment.end)
  };
}

async function toggleCompareFullscreen() {
  const fullscreenActive = document.fullscreenElement === dom.stageColumn || dom.stageColumn.classList.contains("focus-mode");
  const nextFullscreen = !fullscreenActive;
  const hostFullscreen = window.shotCompareHost?.setCompareFullscreen;

  if (typeof hostFullscreen === "function") {
    await hostFullscreen(nextFullscreen);
    dom.stageColumn.classList.toggle("focus-mode", nextFullscreen);
    renderFullscreenButton();
    return;
  }

  if (!nextFullscreen) {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
    dom.stageColumn.classList.remove("focus-mode");
    renderFullscreenButton();
    return;
  }

  try {
    await dom.stageColumn.requestFullscreen();
  } catch {
    dom.stageColumn.classList.add("focus-mode");
    renderFullscreenButton();
  }
}

function renderFullscreenButton() {
  const active = document.fullscreenElement === dom.stageColumn || dom.stageColumn.classList.contains("focus-mode");
  dom.fullscreenCompareButton.textContent = active ? "退出大屏" : "大屏展示";
}

async function playCompare() {
  const videos = Array.from(dom.compareGrid.querySelectorAll("video[data-segment-id]"));
  for (const video of videos) {
    const segment = getSegment(video.dataset.segmentId);
    if (!segment) continue;
    if (video.currentTime < segment.start || video.currentTime >= segment.end) {
      video.currentTime = segment.start;
    }
    try {
      await video.play();
    } catch {
      toast("浏览器阻止了播放，请先点一下视频画面。");
    }
  }
}

function pauseCompare() {
  for (const video of dom.compareGrid.querySelectorAll("video")) {
    video.pause();
  }
}

function restartCompare() {
  for (const video of dom.compareGrid.querySelectorAll("video[data-segment-id]")) {
    const segment = getSegment(video.dataset.segmentId);
    if (!segment) continue;
    video.currentTime = segment.start;
  }
}

function render() {
  dom.analyzeButton.disabled = state.assets.length === 0 || state.analyzing;
  dom.cancelButton.disabled = !state.analyzing;
  dom.pickFilesButton.disabled = false;
  dom.pickFolderButton.disabled = false;
  renderInitialPlacement();
  renderFullscreenButton();
  renderAssets();
  renderGroups();
  renderSegments();
  renderCompareGrid();
  renderMetrics();
}

function renderAssets() {
  dom.assetSummary.textContent = state.assets.length === 0 ? "等待选择视频" : `${state.assets.length} 个素材`;

  if (state.assets.length === 0) {
    dom.assetList.innerHTML = `<div class="empty-state">选择视频或素材文件夹</div>`;
    return;
  }

  dom.assetList.innerHTML = state.assets.map((asset) => {
    const statusText = assetStatusText(asset);
    const details = asset.status === "done"
      ? `${formatDuration(asset.duration)} / ${asset.width}x${asset.height} / ${asset.segments.length} 段`
      : `${formatBytes(asset.size)}${asset.error ? ` / ${asset.error}` : ""}`;
    return `
      <article class="asset-row">
        <strong title="${escapeHtml(asset.displayPath)}">${escapeHtml(asset.name)}</strong>
        <small>${escapeHtml(details)}</small>
        <span class="status-pill ${asset.status === "done" ? "done" : asset.status === "error" ? "error" : ""}">${statusText}</span>
        <div class="asset-progress"><span style="width: ${Math.round(asset.progress * 100)}%"></span></div>
      </article>
    `;
  }).join("");
}

function renderGroups() {
  dom.groupSummary.textContent = state.groups.length === 0 ? "尚无分组" : `${state.groups.length} 组`;

  if (state.groups.length === 0) {
    dom.groupList.innerHTML = `<div class="empty-state">分析后显示相似分组</div>`;
    return;
  }

  dom.groupList.innerHTML = state.groups.map((group, index) => {
    const assets = new Set(group.segments.map((segment) => segment.assetId));
    const totalDuration = group.segments.reduce((sum, segment) => sum + segment.duration, 0);
    return `
      <article class="group-row ${group.id === state.activeGroupId ? "active" : ""}" data-group-id="${group.id}">
        <div class="group-thumb"><img alt="" src="${group.thumb}" /></div>
        <div>
          <strong>相似组 ${index + 1}</strong>
          <small>${group.segments.length} 个片段 / ${assets.size} 个素材 / ${formatDuration(totalDuration)}</small>
          <span class="group-count">${group.segments.length}</span>
        </div>
      </article>
    `;
  }).join("");
}

function renderSegments() {
  const activeGroup = getActiveGroup();
  if (!activeGroup) {
    dom.activeGroupTitle.textContent = "对比区";
    dom.activeGroupMeta.textContent = "上传视频后自动分析；顶部配置只决定初始放入哪一区";
    dom.candidateSummary.textContent = "暂无相似片段";
    dom.segmentGrid.innerHTML = `<div class="empty-state">暂无相似片段</div>`;
    dom.moveAllToCompareButton.disabled = true;
    return;
  }

  const segments = activeGroup.segments.slice().sort((left, right) => {
    if (left.assetName !== right.assetName) return left.assetName.localeCompare(right.assetName);
    return left.start - right.start;
  });
  const compareIds = new Set(state.compareSegmentIds);
  const candidateSegments = segments.filter((segment) => !compareIds.has(segment.id));
  const assetCount = new Set(segments.map((segment) => segment.assetId)).size;
  dom.activeGroupTitle.textContent = `对比区：${state.compareSegmentIds.length} 个镜头`;
  dom.activeGroupMeta.textContent = `当前相似组共 ${segments.length} 个片段 / ${assetCount} 个素材`;
  dom.candidateSummary.textContent = `${candidateSegments.length} 个相似片段`;
  dom.moveAllToCompareButton.disabled = candidateSegments.length === 0;

  if (candidateSegments.length === 0) {
    dom.segmentGrid.innerHTML = `<div class="empty-state">相似区为空，所有片段都在对比区中</div>`;
    return;
  }

  dom.segmentGrid.innerHTML = candidateSegments.map((segment) => {
    return `
      <article class="segment-card" data-segment-id="${segment.id}">
        <div class="segment-thumb">
          <img alt="" src="${segment.thumb}" />
          <span class="segment-time">${formatTimecode(segment.start)}</span>
        </div>
        <div class="segment-body">
          <strong title="${escapeHtml(segment.displayPath)}">${escapeHtml(segment.assetName)}</strong>
          <small>${formatTimecode(segment.start)} - ${formatTimecode(segment.end)} / ${formatDuration(segment.duration)}</small>
          <div class="segment-actions">
            <button class="primary-button" type="button" data-action="move-to-compare">移入对比</button>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderCompareGrid() {
  const slots = state.compareSegmentIds.map(getSegment).filter(Boolean);
  const columns = calculateCompareColumns(slots.length);
  const rows = calculateCompareRows(slots.length, columns);
  dom.compareGrid.style.setProperty("--compare-columns", String(columns));
  dom.compareGrid.style.setProperty("--compare-rows", String(rows));

  if (slots.length === 0) {
    dom.compareGrid.innerHTML = `<div class="compare-empty">对比区为空。相似区里的片段可以移入这里。</div>`;
    return;
  }

  dom.compareGrid.innerHTML = slots.map((segment, index) => {
      const asset = getAsset(segment.assetId);
      return `
        <article class="compare-slot" data-segment-id="${segment.id}" data-drag-clip draggable="true" title="拖拽这个片段到剪映或其他素材区">
          <video data-segment-id="${segment.id}" src="${asset.url}" muted playsinline controls></video>
          <div class="slot-info">
            <button class="slot-action-exit" type="button" data-action="move-to-similar" data-remove-slot="${segment.id}">移出对比区</button>
            <div class="slot-meta">
              <strong title="${escapeHtml(segment.displayPath)}">${index + 1}. ${escapeHtml(segment.assetName)}</strong>
              <span>${formatTimecode(segment.start)} - ${formatTimecode(segment.end)}</span>
            </div>
            <span class="slot-current-time" data-slot-time="${segment.id}">${formatTimecode(segment.start)}</span>
            <button type="button" data-action="copy-timecode">复制时间码</button>
            <button type="button" data-action="drag-clip" data-drag-clip draggable="true">拖拽片段</button>
          </div>
        </article>
      `;
    }).join("");

  for (const video of dom.compareGrid.querySelectorAll("video[data-segment-id]")) {
    const segment = getSegment(video.dataset.segmentId);
    if (!segment) continue;

    const setStart = () => {
      video.currentTime = Math.max(0, segment.start);
    };
    video.addEventListener("loadedmetadata", setStart, { once: true });
    video.addEventListener("timeupdate", () => {
      const timeNode = dom.compareGrid.querySelector(`[data-slot-time="${segment.id}"]`);
      if (timeNode) {
        timeNode.textContent = formatTimecode(video.currentTime);
      }

      if (video.currentTime >= segment.end) {
        if (dom.loopCompare.checked) {
          video.currentTime = segment.start;
          video.play().catch(() => {});
        } else {
          video.pause();
          video.currentTime = segment.end;
        }
      }
    });
  }
}

function calculateCompareColumns(count) {
  if (count <= 1) return 1;
  return Math.ceil(Math.sqrt(count));
}

function calculateCompareRows(count, columns) {
  if (count <= 0) return 1;
  return Math.ceil(count / Math.max(1, columns));
}

function renderMetrics() {
  const analyzedAssets = state.assets.filter((asset) => asset.status === "done").length;
  dom.metricText.textContent = `${analyzedAssets}/${state.assets.length} 素材 / ${state.segments.length} 片段 / ${state.groups.length} 分组`;
}

function getActiveGroup() {
  return state.groups.find((group) => group.id === state.activeGroupId) || null;
}

function getAsset(assetId) {
  return state.assets.find((asset) => asset.id === assetId) || null;
}

function getSegment(segmentId) {
  return state.segments.find((segment) => segment.id === segmentId) || null;
}

function setStatus(message) {
  dom.statusText.textContent = message;
  renderMetrics();
}

function assetStatusText(asset) {
  if (asset.status === "ready") return "待分析";
  if (asset.status === "analyzing") return `${Math.round(asset.progress * 100)}%`;
  if (asset.status === "done") return "完成";
  if (asset.status === "error") return "失败";
  return asset.status;
}

function formatSegmentForClipboard(segment) {
  if (!segment) return "";
  return `${segment.assetName}\t${formatTimecode(segment.start)} - ${formatTimecode(segment.end)}\t${formatDuration(segment.duration)}`;
}

function formatClipFallbackText(segment) {
  if (!segment) return "";
  return [
    `文件：${segment.assetName}`,
    `区间：${formatTimecode(segment.start)} - ${formatTimecode(segment.end)}`,
    `时长：${formatDuration(segment.duration)}`,
    "说明：浏览器 demo 无法生成可拖拽视频文件；Electron 版会生成临时剪切片段。"
  ].join("\n");
}

function formatTimecode(seconds) {
  const safeSeconds = Math.max(0, seconds || 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.round((safeSeconds - Math.floor(safeSeconds)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "0s";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制。");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    toast("已复制。");
  }
}

function toast(message) {
  window.clearTimeout(state.toastTimer);
  document.querySelector(".toast")?.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.append(node);
  state.toastTimer = window.setTimeout(() => node.remove(), 2400);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
