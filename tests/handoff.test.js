import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import handoff from "../electron/handoff.cjs";

const { afterEffectsScript, createHandoff, premiereXml } = handoff;

describe("Grayfox approved edit handoffs", () => {
  const segments = [
    { start: 4, end: 9, role: "hook", effect: "meme-punch", memeEnabled: true, memeStart: 5.5, memeEnd: 6.7, memeReason: "visible reaction" },
    { start: 20, end: 27, role: "close" },
  ];

  it("creates a Premiere-compatible XML timeline with real source ranges", () => {
    const xml = premiereXml({ sourcePath: "C:/Videos/interview.mp4", projectName: "Launch & pricing", segments, fps: 30 });
    expect(xml).toContain("<xmeml version=\"4\">");
    expect(xml).toContain("Launch &amp; pricing");
    expect(xml).toContain("<in>120</in>");
    expect(xml).toContain("<out>270</out>");
    expect(xml).toContain("interview.mp4");
    expect(xml).toContain("Grayfox Meme Punch");
    expect(xml).toContain("visible reaction");
  });

  it("creates an After Effects script with one layer per approved cut", () => {
    const script = afterEffectsScript({ sourcePath: "C:/Videos/interview.mp4", projectName: "Launch", segments });
    expect(script).toContain("app.project.items.addComp");
    expect(script).toContain("Cut 1 - hook");
    expect(script).toContain("Cut 2 - close");
    expect(script.match(/comp\.layers\.add/g)).toHaveLength(2);
  });

  it("creates a social publishing package and opens the user-confirmed publisher", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "grayfox-social-"));
    const rendered = path.join(root, "approved.mp4");
    fs.writeFileSync(rendered, "rendered-video");
    const shell = { showItemInFolder: vi.fn(), openExternal: vi.fn().mockResolvedValue(undefined) };
    try {
      const run = createHandoff({ shell });
      const result = await run(null, {
        target: "youtube",
        outputPath: rendered,
        exportPath: root,
        projectName: "Approved launch",
        duration: 12,
        segments,
        tone: ["Direct"],
      });
      expect(fs.existsSync(result.videoPath)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(path.join(result.path, "publishing.json"), "utf8"));
      expect(manifest).toEqual(expect.objectContaining({ platform: "youtube", cuts: 2, status: "ready-for-user-confirmed-upload" }));
      expect(manifest.memeBeats).toEqual([expect.objectContaining({ start: 5.5, end: 6.7, effect: "meme-punch" })]);
      expect(shell.showItemInFolder).toHaveBeenCalledWith(result.videoPath);
      expect(shell.openExternal).toHaveBeenCalledWith("https://studio.youtube.com/");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses handoffs without an approved rendered file", async () => {
    const run = createHandoff({ shell: { showItemInFolder: vi.fn(), openExternal: vi.fn() } });
    await expect(run(null, { target: "premiere", outputPath: "", exportPath: "C:/Exports" }))
      .rejects.toThrow("approved rendered file");
  });
});
