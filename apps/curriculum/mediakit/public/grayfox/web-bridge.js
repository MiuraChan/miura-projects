(function installGrayfoxWebBridge(global) {
  "use strict";

  if (!global || global.grayfoxDesktop) return;

  const MAX_SOURCE_BYTES = 500 * 1024 * 1024;
  const MAX_OUTPUT_SECONDS = 60;
  const STORAGE_KEY = "grayfox.workspace.v3";
  const source = { file: null, url: null, duration: 0 };
  const renders = new Map();
  const progressListeners = new Set();

  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const waitFor = (target, event) => new Promise((resolve, reject) => {
    const timeout = global.setTimeout(() => reject(new Error(`Timed out while waiting for ${event}.`)), 15000);
    target.addEventListener(event, () => {
      global.clearTimeout(timeout);
      resolve();
    }, { once: true });
    target.addEventListener("error", () => {
      global.clearTimeout(timeout);
      reject(new Error("The browser could not decode this video."));
    }, { once: true });
  });

  function report(percent, phase, detail) {
    const payload = { percent: Math.round(clamp(Number(percent) || 0, 0, 100)), phase, detail };
    progressListeners.forEach((listener) => listener(payload));
  }

  function setSourceFile(file) {
    if (!(file instanceof global.File) || (!String(file.type || "").startsWith("video/") && !/\.(mp4|mov|webm|mkv|m4v|avi)$/i.test(file.name || ""))) {
      throw new Error("Choose a valid local video file.");
    }
    if (file.size > MAX_SOURCE_BYTES) {
      throw new Error("The online prototype accepts videos up to 500 MB. Use the desktop build for long VODs.");
    }
    if (source.url) global.URL.revokeObjectURL(source.url);
    source.file = file;
    source.url = global.URL.createObjectURL(file);
    source.duration = 0;
    return { name: file.name, size: file.size };
  }

  async function createSourceVideo() {
    if (!source.file || !source.url) throw new Error("Choose a video before rendering.");
    const video = global.document.createElement("video");
    video.preload = "auto";
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.src = source.url;
    if (video.readyState < 1) await waitFor(video, "loadedmetadata");
    if (video.readyState < 2) await waitFor(video, "loadeddata");
    source.duration = Number(video.duration) || 0;
    if (!source.duration) throw new Error("The browser could not read the video duration.");
    return video;
  }

  function toneProfile(tone) {
    const normalized = String(tone || "").toLowerCase();
    if (/(energetic|fast|direct|aggressive|irriverente|energetico)/.test(normalized)) {
      return { label: "Energetic / direct", averageShotLength: 4.5, memeConfidence: 0.72 };
    }
    if (/(calm|warm|serious|premium|serio)/.test(normalized)) {
      return { label: "Measured / serious", averageShotLength: 8, memeConfidence: 0.84 };
    }
    return { label: "Balanced", averageShotLength: 6, memeConfidence: 0.78 };
  }

  function removalRule(direction) {
    const text = String(direction || "").toLowerCase();
    return /(remove|cut|delete|exclude|rimuovi|taglia).{0,80}(first|opening|previous video|watching|prima parte|video precedente|guardo)/.test(text);
  }

  function buildSegments(duration, requestedSeconds, tone, direction) {
    const profile = toneProfile(tone);
    const removeOpening = removalRule(direction);
    const availableStart = removeOpening ? Math.min(duration * 0.18, 60) : 0;
    const available = Math.max(1, duration - availableStart);
    const target = Math.min(MAX_OUTPUT_SECONDS, Math.max(3, requestedSeconds || 30), available);
    const count = clamp(Math.round(target / profile.averageShotLength), 1, 10);
    const segmentLength = target / count;
    const stride = count === 1 ? 0 : Math.max(segmentLength, (available - segmentLength) / (count - 1));
    const segments = Array.from({ length: count }, (_value, index) => {
      const start = Math.min(duration - segmentLength, availableStart + (stride * index));
      const end = Math.min(duration, start + segmentLength);
      const segment = {
        start: Number(Math.max(0, start).toFixed(3)),
        end: Number(end.toFixed(3)),
        role: index === 0 ? "hook" : (index === count - 1 ? "close" : "body"),
      };
      return segment;
    });
    return { segments, profile, removeOpening, outputDuration: segments.reduce((sum, item) => sum + item.end - item.start, 0) };
  }

  async function analyzeVideo(options = {}) {
    const video = await createSourceVideo();
    const duration = source.duration || Number(video.duration) || 0;
    if (options.mode === "clips" && String(options.selectionInstruction || "").trim()) {
      return { provider: "browser-content-verification-unavailable", duration, candidates: [], selectionVerified: false,
        selectionMessage: "This web demo cannot verify specific events such as deaths without a connected recognition service. No unrelated clips were exported. Use desktop Grayfox for event detection." };
    }
    if (options.mode === "edit" && removalRule(options.direction)) throw new Error("This web demo cannot recognize scenes or verify content-removal instructions. Use duration and tone for a browser preview; semantic editing runs in desktop Grayfox.");
    const target = Math.min(MAX_OUTPUT_SECONDS, Number(options.targetLength) || Number(options.maximumDuration) || 30);
    const plan = buildSegments(duration, target, options.tone, options.direction);
    const excludedRanges = plan.removeOpening ? [{ start: 0, end: plan.segments[0].start, reason: "Opening removal requested" }] : [];
    const candidateLength = Math.min(target, duration);
    const candidateCount = Math.min(duration >= 7200 ? 5 : duration >= 3600 ? 4 : 3, Math.max(1, Math.floor(duration / candidateLength)));
    const starts = Array.from({ length: candidateCount }, (_value, index) => {
      const fraction = candidateCount === 1 ? 0 : index / (candidateCount - 1);
      return Math.max(0, (duration - candidateLength) * fraction);
    });
    const candidates = starts.map((start, index) => ({
      start: Number(start.toFixed(3)),
      end: Number(Math.min(duration, start + candidateLength).toFixed(3)),
      score: index + 1,
      title: `Review range ${index + 1}`,
      note: "Selected by timeline position and duration for this demo, not AI content recognition. Review before sharing.",
    }));
    return {
      provider: "browser-local-signals",
      model: null,
      duration,
      candidates,
      editPlan: { segments: plan.segments, outputDuration: plan.outputDuration, toneProfile: plan.profile },
      targetLength: plan.outputDuration,
      minimumDuration: Math.min(Number(options.minimumDuration) || plan.outputDuration, plan.outputDuration),
      maximumDuration: Math.min(Number(options.maximumDuration) || plan.outputDuration, MAX_OUTPUT_SECONDS),
      toneProfile: plan.profile,
      excludedRanges,
      directionRules: { mustRemove: plan.removeOpening ? ["opening"] : [] },
      directionAuditCoverage: 0,
      directionAuditCount: 0,
      dialogueProvider: "browser-prototype",
      dialogueCueCount: 0,
    };
  }


  async function seek(video, time) {
    if (Math.abs(Number(video.currentTime) - time) < 0.08) return;
    video.currentTime = time;
    await waitFor(video, "seeked");
  }

  function waitForRange(video, segment, onProgress = () => {}) {
    return new Promise((resolve, reject) => {
      let interval, timeout;
      const finish = (error) => {
        global.clearInterval(interval); global.clearTimeout(timeout);
        video.removeEventListener("ended", ended); video.removeEventListener("timeupdate", check); video.removeEventListener("error", failed);
        if (error) reject(error); else resolve();
      };
      const ended = () => finish();
      const failed = () => finish(new Error("Video playback failed during export. Your source and settings are unchanged."));
      const check = () => {
        const within = clamp((video.currentTime - segment.start) / (segment.end - segment.start), 0, 1);
        onProgress(within);
        if (video.currentTime >= segment.end || video.ended) finish();
      };
      video.addEventListener("ended", ended); video.addEventListener("timeupdate", check); video.addEventListener("error", failed);
      interval = global.setInterval(check, 100);
      timeout = global.setTimeout(() => finish(new Error("Browser export stalled. Keep this tab visible and retry; your source and settings are unchanged.")), Math.max(30000, (segment.end - segment.start) * 3000 + 15000));
      check();
    });
  }

  async function renderSegments(options = {}) {
    if (!global.MediaRecorder) throw new Error("This browser does not support local video export. Use current Chrome or Edge.");
    const preferred = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
      .find((type) => global.MediaRecorder.isTypeSupported(type));
    if (!preferred) throw new Error("This browser cannot record WebM. Try current Chrome or Edge; no incorrectly labeled file was exported.");
    const video = await createSourceVideo();
    const requested = Array.isArray(options.segments) && options.segments.length
      ? options.segments
      : [{ start: Number(options.trimStart) || 0, end: Number(options.trimEnd) || Math.min(video.duration, 30), role: "clip" }];
    const segments = requested.filter((item) => item.kind !== "meme").map((item) => ({
      start: clamp(Number(item.start) || 0, 0, video.duration),
      end: clamp(Number(item.end) || 0, 0, video.duration),
      role: item.role || "body",
    })).filter((item) => item.end > item.start);
    const outputDuration = segments.reduce((sum, item) => sum + item.end - item.start, 0);
    if (!segments.length) throw new Error("The edit plan has no playable ranges.");
    if (outputDuration > MAX_OUTPUT_SECONDS + 0.1) throw new Error("The web demo renders up to 60 seconds. Use Grayfox desktop for long-form cuts.");

    const canvas = global.document.createElement("canvas");
    const layout = global.GrayfoxMediaLayout;
    const profile = layout?.profile(options.outputPreset);
    canvas.width = profile?.width || Math.min(1280, Number(video.videoWidth) || 1280);
    canvas.height = profile?.height || Math.round(canvas.width / ((Number(video.videoWidth) || 16) / (Number(video.videoHeight) || 9)));
    const context = canvas.getContext("2d", { alpha: false });
    const canvasStream = canvas.captureStream(30);
    const AudioContext = global.AudioContext || global.webkitAudioContext;
    const audioContext = AudioContext ? new AudioContext() : null;
    const audioGain = audioContext ? audioContext.createGain() : null;
    const audioDestination = audioContext ? audioContext.createMediaStreamDestination() : null;
    if (audioContext) {
      audioContext.createMediaElementSource(video).connect(audioGain);
      audioGain.connect(audioDestination);
      await audioContext.resume();
    }
    const combined = new global.MediaStream([
      ...canvasStream.getVideoTracks(),
      ...(audioDestination ? audioDestination.stream.getAudioTracks() : []),
    ]);
    const recorder = new global.MediaRecorder(combined, preferred ? { mimeType: preferred, videoBitsPerSecond: profile ? 16_000_000 : 5_000_000 } : undefined);
    const chunks = [];
    recorder.addEventListener("dataavailable", (event) => { if (event.data?.size) chunks.push(event.data); });
    const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
    let frameHandle = 0;
    let activeSegment = segments[0];
    let completed = 0;
    const paint = () => {
      if (video.readyState >= 2) {
        if (profile && layout) {
          const rect = layout.sourceRect(video.videoWidth, video.videoHeight, options.sourceAspect);
          const fit = layout.fitRect(rect.width, rect.height, canvas.width, canvas.height, options.framing === "crop");
          context.fillStyle = "black";
          context.fillRect(0, 0, canvas.width, canvas.height);
          if (options.outputPreset === "story-vertical" && options.framing !== "crop") {
            const background = layout.fitRect(rect.width, rect.height, canvas.width, canvas.height, true);
            context.save(); context.filter = "blur(24px)";
            context.drawImage(video, rect.x, rect.y, rect.width, rect.height, background.x - 30, background.y - 30, background.width + 60, background.height + 60);
            context.restore();
          }
          context.drawImage(video, rect.x, rect.y, rect.width, rect.height, fit.x, fit.y, fit.width, fit.height);
        } else context.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      const outputTime = completed + clamp((Number(video.currentTime) || 0) - activeSegment.start, 0, activeSegment.end - activeSegment.start);
      const fadeLength = Math.min(0.5, outputDuration / 2);
      const opacity = Math.min(options.fadeIn ? clamp(outputTime / fadeLength, 0, 1) : 1, options.fadeOut ? clamp((outputDuration - outputTime) / fadeLength, 0, 1) : 1);
      if (opacity < 1) {
        context.fillStyle = `rgba(0,0,0,${1 - opacity})`;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (audioGain) audioGain.gain.value = opacity;
      frameHandle = global.requestAnimationFrame(paint);
    };
    paint();
    recorder.start(500);
    try {
      for (let index = 0; index < segments.length; index += 1) {
        activeSegment = segments[index];
        await seek(video, activeSegment.start);
        await video.play();
        await waitForRange(video, activeSegment, (within) => {
          report(((completed + within * (activeSegment.end - activeSegment.start)) / outputDuration) * 100, "browser-render", `Rendering segment ${index + 1} of ${segments.length}`);
        });
        video.pause();
        completed += activeSegment.end - activeSegment.start;
      }
    } finally {
      video.pause();
      recorder.stop();
      await stopped;
      global.cancelAnimationFrame(frameHandle);
      combined.getTracks().forEach((track) => track.stop());
      if (audioContext) await audioContext.close();
    }
    const blob = new global.Blob(chunks, { type: recorder.mimeType || "video/webm" });
    if (!blob.size) throw new Error("The browser produced an empty video file.");
    const outputPath = `web://render/${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const url = global.URL.createObjectURL(blob);
    renders.set(outputPath, { blob, url, duration: outputDuration, segments });
    report(100, "browser-render", "Browser render ready");
    return {
      outputPath,
      duration: Number(outputDuration.toFixed(3)),
      segmentCount: segments.length,
      segments,
      minimumDuration: Number(options.minimumDuration) || outputDuration,
      maximumDuration: Math.min(Number(options.maximumDuration) || outputDuration, MAX_OUTPUT_SECONDS),
      targetDuration: outputDuration,
      meetsTarget: true,
      format: "webm",
      fadeIn: options.fadeIn === true,
      fadeOut: options.fadeOut === true,
      outputSize: profile || null,
    };
  }

  function downloadBlob(blob, filename) {
    const anchor = global.document.createElement("a");
    anchor.href = global.URL.createObjectURL(blob);
    anchor.download = filename;
    global.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    global.setTimeout(() => global.URL.revokeObjectURL(anchor.href), 1000);
  }

  const bridge = {
    environment: "web",
    platform: "web",
    limits: Object.freeze({ maxSourceBytes: MAX_SOURCE_BYTES, maxOutputSeconds: MAX_OUTPUT_SECONDS }),
    setSourceFile,
    setSourceMetadata(metadata = {}) { source.duration = Number(metadata.duration) || source.duration; },
    async loadWorkspace() {
      try { return JSON.parse(global.localStorage.getItem(STORAGE_KEY) || "null"); } catch { return null; }
    },
    async saveWorkspace(workspace) {
      try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace)); } catch { /* Private mode may block storage. */ }
      return workspace;
    },
    analyzeVideo,
    produceVideo: renderSegments,
    produceEditedVideo: renderSegments,
    async restoreVideo(outputPath) {
      const render = renders.get(outputPath);
      return render ? { url: render.url, duration: render.duration } : null;
    },
    async exportApprovedVideo(options = {}) {
      const render = renders.get(options.outputPath);
      if (!render) throw new Error("Render the approved cut again in this browser session.");
      const safeName = String(options.projectName || "grayfox-cut").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "grayfox-cut";
      downloadBlob(render.blob, `${safeName}.webm`);
      return { outputPath: `${safeName}.webm`, label: "WebM browser export", format: "webm" };
    },
    async createHandoff(options = {}) {
      const payload = new global.Blob([JSON.stringify({ ...options, generatedBy: "Grayfox web prototype" }, null, 2)], { type: "application/json" });
      const safeName = String(options.projectName || "grayfox-handoff").replace(/[^a-z0-9_-]+/gi, "-");
      downloadBlob(payload, `${safeName}-${options.target || "handoff"}.json`);
      return { message: "Prototype handoff manifest downloaded. Desktop Grayfox creates the native Premiere and After Effects packages." };
    },
    onProductionProgress(callback) {
      progressListeners.add(callback);
      return () => progressListeners.delete(callback);
    },
    versions: Object.freeze({ chrome: "browser", electron: null, app: "web-prototype", build: "bounded-local", channel: "web" }),
  };

  global.GrayfoxWebPrototype = Object.freeze({ buildSegments, removalRule, toneProfile, waitForRange });
  global.grayfoxDesktop = Object.freeze(bridge);
})(typeof window !== "undefined" ? window : null);
