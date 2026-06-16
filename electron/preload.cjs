const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("shotCompareHost", {
  registerSourceFile(assetId, file) {
    try {
      const filePath = webUtils.getPathForFile(file);
      return ipcRenderer.invoke("shotcompare:register-source-file", {
        assetId,
        filePath,
        filename: file?.name || "",
        size: file?.size || 0,
        lastModified: file?.lastModified || 0
      });
    } catch {
      return Promise.resolve({ ok: false });
    }
  },

  startClipDrag(payload) {
    ipcRenderer.send("shotcompare:start-clip-drag", {
      segmentId: payload?.segmentId,
      assetId: payload?.assetId,
      filename: payload?.filename,
      displayPath: payload?.displayPath,
      startMs: payload?.startMs,
      endMs: payload?.endMs,
      startTimecode: payload?.startTimecode,
      endTimecode: payload?.endTimecode
    });
  },

  onDragStatus(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }

    const listener = (_event, status) => {
      callback({
        level: status?.level || "info",
        message: status?.message || ""
      });
    };
    ipcRenderer.on("shotcompare:drag-status", listener);
    return () => ipcRenderer.removeListener("shotcompare:drag-status", listener);
  }
});
