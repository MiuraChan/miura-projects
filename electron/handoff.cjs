"use strict";

const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");

function escapeXml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function safeName(value) {
  return String(value || "Grayfox edit").trim().slice(0, 80).replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/[. ]+$/g, "") || "Grayfox edit";
}

function normalizedSegments(payload) {
  const sourceSegments = Array.isArray(payload?.segments) && payload.segments.length
    ? payload.segments
    : [{ start: 0, end: Number(payload?.duration) || 0, role: "approved-cut" }];
  return sourceSegments.map((segment) => ({
    start: Math.max(0, Number(segment.start) || 0),
    end: Math.max(Number(segment.end) || 0, Number(segment.start) || 0),
    role: String(segment.role || "body"),
  })).filter((segment) => segment.end - segment.start > 0.04);
}

function premiereXml({ sourcePath, projectName, segments, fps = 30 }) {
  const fileUrl = pathToFileURL(sourcePath).href;
  let timelineFrame = 0;
  const entries = normalizedSegments({ segments }).map((segment) => {
    const inFrame = Math.round(segment.start * fps);
    const durationFrames = Math.max(1, Math.round((segment.end - segment.start) * fps));
    const startFrame = timelineFrame;
    timelineFrame += durationFrames;
    return { segment, inFrame, durationFrames, startFrame, endFrame: timelineFrame };
  });
  const fullFile = `<file id="source-1"><name>${escapeXml(path.basename(sourcePath))}</name><pathurl>${escapeXml(fileUrl)}</pathurl><rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate></file>`;
  const renderTrack = (prefix, mediaType) => entries.map((entry, index) => {
    const sourceTrack = mediaType === "audio" ? "<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>" : "";
    const file = prefix === "v" && index === 0 ? fullFile : '<file id="source-1"/>';
    return `<clipitem id="${prefix}-clip-${index + 1}"><name>${escapeXml(`${projectName} ${entry.segment.role}`)}</name><start>${entry.startFrame}</start><end>${entry.endFrame}</end><in>${entry.inFrame}</in><out>${entry.inFrame + entry.durationFrames}</out>${file}${sourceTrack}</clipitem>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE xmeml><xmeml version="4"><sequence><name>${escapeXml(projectName)}</name><duration>${timelineFrame}</duration><rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate><media><video><track>${renderTrack("v", "video")}</track></video><audio><track>${renderTrack("a", "audio")}</track></audio></media></sequence></xmeml>`;
}

function afterEffectsScript({ sourcePath, projectName, segments, fps = 30 }) {
  const safePath = String(sourcePath).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const safeProject = String(projectName).replace(/"/g, '\\"');
  const items = normalizedSegments({ segments });
  const duration = items.reduce((total, segment) => total + segment.end - segment.start, 0);
  const layerLines = [];
  let cursor = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const segment = items[index];
    const length = segment.end - segment.start;
    const start = items.slice(0, index).reduce((total, item) => total + item.end - item.start, 0);
    layerLines.push(`var layer${index} = comp.layers.add(footage); layer${index}.startTime = ${start.toFixed(3)} - ${segment.start.toFixed(3)}; layer${index}.inPoint = ${start.toFixed(3)}; layer${index}.outPoint = ${(start + length).toFixed(3)}; layer${index}.name = "Cut ${index + 1} - ${String(segment.role).replace(/"/g, "")}";`);
    cursor += length;
  }
  return `app.beginUndoGroup("Grayfox approved cut");\nif (!app.project) app.newProject();\nvar sourceFile = new File("${safePath}");\nvar footage = app.project.importFile(new ImportOptions(sourceFile));\nvar comp = app.project.items.addComp("${safeProject}", footage.width, footage.height, 1, ${Math.max(duration, cursor).toFixed(3)}, ${fps});\n${layerLines.join("\n")}\napp.endUndoGroup();\n`;
}

function createHandoff({ shell }) {
  return async function handoff(_event, payload) {
    const target = String(payload?.target || "");
    const sourcePath = path.normalize(String(payload?.sourcePath || ""));
    const outputPath = path.normalize(String(payload?.outputPath || ""));
    const exportPath = path.normalize(String(payload?.exportPath || ""));
    if (!path.isAbsolute(outputPath) || !path.isAbsolute(exportPath)) throw new Error("An approved rendered file and export folder are required.");
    await fs.access(outputPath);
    await fs.mkdir(exportPath, { recursive: true });
    const projectName = safeName(payload?.projectName);
    const segments = normalizedSegments(payload);

    if (target === "premiere") {
      if (!path.isAbsolute(sourcePath)) throw new Error("Reconnect the original source before creating a Premiere timeline.");
      const output = path.join(exportPath, `${projectName}-Premiere.xml`);
      await fs.writeFile(output, premiereXml({ sourcePath, projectName, segments }), "utf8");
      shell.showItemInFolder(output);
      return { path: output, target, message: "Premiere XML ready. Import it into Adobe Premiere Pro." };
    }
    if (target === "after-effects") {
      if (!path.isAbsolute(sourcePath)) throw new Error("Reconnect the original source before creating an After Effects composition.");
      const output = path.join(exportPath, `${projectName}-After-Effects.jsx`);
      await fs.writeFile(output, afterEffectsScript({ sourcePath, projectName, segments }), "utf8");
      shell.showItemInFolder(output);
      return { path: output, target, message: "After Effects script ready. Run it from File > Scripts > Run Script File." };
    }

    const platformUrls = {
      youtube: "https://studio.youtube.com/",
      tiktok: "https://www.tiktok.com/upload",
      instagram: "https://www.instagram.com/",
    };
    if (!platformUrls[target]) throw new Error("Unsupported handoff target.");
    const folder = path.join(exportPath, `${projectName}-${target}`);
    await fs.mkdir(folder, { recursive: true });
    const videoPath = path.join(folder, `${projectName}.mp4`);
    await fs.copyFile(outputPath, videoPath);
    const manifest = {
      platform: target,
      approvedAt: payload?.approvedAt || new Date().toISOString(),
      duration: Number(payload?.duration) || 0,
      cuts: segments.length,
      direction: String(payload?.direction || ""),
      tone: Array.isArray(payload?.tone) ? payload.tone : [],
      video: path.basename(videoPath),
      status: "ready-for-user-confirmed-upload",
    };
    await fs.writeFile(path.join(folder, "publishing.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await fs.writeFile(path.join(folder, "README.txt"), `Grayfox approved social package\r\nPlatform: ${target}\r\nVideo: ${path.basename(videoPath)}\r\nCuts: ${segments.length}\r\n\r\nReview title, caption, rights, privacy, and audience settings before publishing.\r\n`, "utf8");
    shell.showItemInFolder(videoPath);
    await shell.openExternal(platformUrls[target]);
    return { path: folder, videoPath, target, message: `${target} package ready. The publisher is open for your final confirmation.` };
  };
}

module.exports = { afterEffectsScript, createHandoff, escapeXml, normalizedSegments, premiereXml, safeName };
