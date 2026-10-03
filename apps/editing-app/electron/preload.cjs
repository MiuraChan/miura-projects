const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("grayfoxDesktop", Object.freeze({
  platform: process.platform,
  chooseExportPath: () => ipcRenderer.invoke("workspace:choose-export-path"),
  loadWorkspace: () => ipcRenderer.invoke("workspace:load"),
  saveWorkspace: (workspace) => ipcRenderer.invoke("workspace:save", workspace),
  chooseVideo: () => ipcRenderer.invoke("video:choose"),
  findRememberedVideo: (options) => ipcRenderer.invoke("video:find-near-export", options),
  chooseTranscript: () => ipcRenderer.invoke("dialogue:choose"),
  restoreVideo: (filePath) => ipcRenderer.invoke("video:restore", filePath),
  checkMediaTools: () => ipcRenderer.invoke("video:tools"),
  analyzeVideo: (options) => ipcRenderer.invoke("video:analyze", options),
  searchMemes: (options) => ipcRenderer.invoke("meme:search", options),
  produceVideo: (options) => ipcRenderer.invoke("video:produce", options),
  produceEditedVideo: (options) => ipcRenderer.invoke("video:produce-edit", options),
  exportApprovedVideo: (options) => ipcRenderer.invoke("video:export-approved", options),
  createHandoff: (options) => ipcRenderer.invoke("video:handoff", options),
  onProductionProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("video:production-progress", listener);
    return () => ipcRenderer.removeListener("video:production-progress", listener);
  },
  versions: Object.freeze({ chrome: process.versions.chrome, electron: process.versions.electron, app: process.env.GRAYFOX_RUNTIME_VERSION || "unknown", build: process.env.GRAYFOX_RUNTIME_BUILD || "packaged", channel: process.env.GRAYFOX_UPDATE_CHANNEL || "packaged" })
}));
