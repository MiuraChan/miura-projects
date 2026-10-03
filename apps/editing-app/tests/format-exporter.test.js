const exporter = require("../electron/format-exporter.cjs");

const { EXPORT_FORMATS, exportFormat, safeProjectName } = exporter;

describe("Approved cut format exports", () => {
  it("offers the three explicit delivery formats", () => {
    expect(Object.keys(EXPORT_FORMATS)).toEqual(["mp4", "mov-prores", "webm"]);
    expect(exportFormat("mov-prores")).toEqual(expect.objectContaining({ extension: "mov" }));
    expect(exportFormat("webm").args).toContain("libvpx-vp9");
  });

  it("rejects unknown formats and sanitizes filenames", () => {
    expect(() => exportFormat("avi")).toThrow(/Choose MP4/);
    expect(safeProjectName(' Bad:Name* ')).toBe("Bad-Name-");
  });
});
