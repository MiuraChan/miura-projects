const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { createGrayfoxApp } = require("../app.js");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const openDoms = [];

function setup(url = "https://grayfox.local/", desktop = null, windowName = "", beforeCreate = null) {
  const dom = new JSDOM(html, {
    url,
    pretendToBeVisual: true,
    runScripts: "outside-only"
  });
  openDoms.push(dom);
  dom.window.URL.createObjectURL = vi.fn(() => "blob:grayfox-video");
  dom.window.URL.revokeObjectURL = vi.fn();
  if (desktop) dom.window.grayfoxDesktop = desktop;
  dom.window.name = windowName;
  if (beforeCreate) beforeCreate(dom.window);
  const app = createGrayfoxApp(dom.window.document, dom.window);
  return { dom, window: dom.window, document: dom.window.document, app };
}

function videoFile(window, name = "interview.mp4") {
  return new window.File(["video"], name, { type: "video/mp4" });
}

afterEach(() => {
  while (openDoms.length) openDoms.pop().window.close();
  vi.restoreAllMocks();
});

describe("Grayfox initial state and routing", () => {
  it("starts in Video Ops with a complete default brief", () => {
    const { document, app } = setup();
    expect(app.state.activeView).toBe("video-ops");
    expect(document.querySelector("#video-ops").classList.contains("active")).toBe(true);
    expect(document.querySelector("#brief-copy").textContent)
      .toBe("Edit the uploaded video for website / landing page.");
  });

  it("uses the live red signal without ninja icons", () => {
    const { document } = setup();
    expect(document.querySelector('[data-testid="grayfox-brand"] img')).toBeNull();
    expect(document.querySelector('[data-testid="grayfox-brand"]').classList.contains("brand-art")).toBe(true);
    expect(document.querySelector('.ai-glyph img')).toBeNull();
    expect(document.querySelector('.modal-grayfox-id')).toBeNull();
    expect(document.querySelector('.brand-signal[role="status"]').getAttribute("aria-label"))
      .toBe("Grayfox active");
    expect(document.querySelector(".status-pill").textContent).toContain("Session active");
    expect(document.querySelector("#workspace-avatar-initials").textContent).toBe("GF");
  });
  it("opens Story Clips from a URL route", () => {
    const { document, app } = setup("https://grayfox.local/?screen=shorts");
    expect(app.state.activeView).toBe("shorts");
    expect(document.querySelector("#shorts").classList.contains("active")).toBe(true);
    expect(document.querySelector("#page-title").textContent).toBe("Story clips");
  });

  it("enables the forced mobile capture mode from the URL", () => {
    const { document } = setup("https://grayfox.local/?mobile=1");
    expect(document.body.classList.contains("mobile-capture")).toBe(true);
  });

  it("switches between both navigation integrations", () => {
    const { document, app } = setup();
    document.querySelector('[data-view="shorts"]').click();
    expect(app.state.activeView).toBe("shorts");
    expect(document.querySelector("#section-label").textContent).toBe("VERTICAL CLIP STUDIO");
    document.querySelector('[data-view="video-ops"]').click();
    expect(app.state.activeView).toBe("video-ops");
    expect(document.querySelector("#page-title").textContent).toBe("Video ops");
  });
});

describe("Tone token controls", () => {
  it("normalizes hashes and repeated whitespace", () => {
    const { app } = setup();
    expect(app.normalizeToken("  #calm   and   clear  ")).toBe("calm and clear");
  });

  it("adds, renders, and removes a token", () => {
    const { document, app } = setup();
    expect(app.addToken("Premium")).toBe(true);
    expect(app.state.tokens).toEqual(["Premium"]);
    expect(document.querySelector(".tone-chip span").textContent).toBe("Premium");
    document.querySelector('[aria-label="Remove Premium"]').click();
    expect(app.state.tokens).toEqual([]);
    expect(document.querySelectorAll(".tone-chip")).toHaveLength(0);
  });

  it("adds suggested tokens through the interface", () => {
    const { document, app } = setup();
    document.querySelector(".token-suggestion").click();
    expect(app.state.tokens).toEqual(["Warm"]);
  });

  it("adds tokens on Enter and comma", () => {
    const { document, window, app } = setup();
    const input = document.querySelector("#tone-token");
    input.value = "Direct";
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.value = "Candid";
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: ",", bubbles: true }));
    expect(app.state.tokens).toEqual(["Direct", "Candid"]);
  });

  it("removes the latest token with Backspace on an empty input", () => {
    const { document, window, app } = setup();
    app.addToken("Warm");
    app.addToken("Direct");
    document.querySelector("#tone-token")
      .dispatchEvent(new window.KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(app.state.tokens).toEqual(["Warm"]);
  });

  it("rejects blank, duplicate, and seventh tokens", () => {
    const { document, app } = setup();
    expect(app.addToken("  ")).toBe(false);
    app.addToken("Warm");
    expect(app.addToken("warm")).toBe(false);
    expect(document.querySelector("#toast").textContent).toContain("already included");
    ["A", "B", "C", "D", "E"].forEach((token) => app.addToken(token));
    expect(app.state.tokens).toHaveLength(6);
    expect(app.addToken("F")).toBe(false);
    expect(document.querySelector("#toast").textContent).toContain("up to 6");
  });
});

describe("Video and AI brief workflow", () => {
  it("rejects missing and non-video files", () => {
    const { document, window, app } = setup();
    expect(app.loadVideo()).toBe(false);
    expect(app.loadVideo(new window.File(["x"], "notes.txt", { type: "text/plain" }))).toBe(false);
    expect(document.querySelector("#toast").textContent).toBe("Please choose a valid video file.");
  });

  it("loads a video and updates preview and brief", () => {
    const { document, window, app } = setup();
    expect(app.loadVideo(videoFile(window))).toBe(true);
    expect(app.state.file.name).toBe("interview.mp4");
    expect(document.querySelector("#video-preview").src).toBe("blob:grayfox-video");
    expect(document.querySelector("#video-preview").style.display).toBe("block");
    expect(document.querySelector("#empty-state").style.display).toBe("none");
    expect(document.querySelector("#brief-copy").textContent).toContain("interview.mp4");
  });

  it("revokes the previous preview URL when loading another video", () => {
    const { window, app } = setup();
    app.loadVideo(videoFile(window, "one.mp4"));
    app.loadVideo(videoFile(window, "two.mp4"));
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:grayfox-video");
  });

  it("builds a full brief from final use, tokens, and direction", () => {
    const { document, window, app } = setup();
    app.loadVideo(videoFile(window, "launch.mp4"));
    app.addToken("Premium");
    app.addToken("Direct");
    document.querySelector("#final-use").value = "YouTube";
    document.querySelector("#direction").value = "Open on the customer result.";
    const brief = app.updateBrief();
    expect(brief).toBe(
      "Edit “launch.mp4” for youtube with a Premium, Direct tone. Direction: Open on the customer result."
    );
  });

  it("reacts to final-use and direction input events", () => {
    const { document, window } = setup();
    const select = document.querySelector("#final-use");
    select.value = "Event highlight";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    const direction = document.querySelector("#direction");
    direction.value = "Keep it energetic.";
    direction.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(document.querySelector("#brief-copy").textContent)
      .toContain("event highlight. Direction: Keep it energetic.");
  });

  it("does not fake a first cut in the browser preview", async () => {
    const { document, window, app } = setup();
    expect(await app.createFirstCut()).toBeNull();
    expect(document.querySelector("#toast").textContent).toContain("Add a video");
    app.loadVideo(videoFile(window));
    expect(await app.createFirstCut()).toBeNull();
    expect(document.querySelector("#toast").textContent).toContain("desktop app");
    expect(document.querySelector("#processing-panel").hidden).toBe(true);
  });

  it("renders a real first cut through the desktop FFmpeg bridge", async () => {
    let progressCallback;
    const desktop = {
      chooseExportPath: vi.fn(),
      produceVideo: vi.fn(async () => {
        progressCallback({ percent: 48 });
        return { outputPath: "C:\\Exports\\Cut-1.mp4", duration: 8 };
      }),
      restoreVideo: vi.fn().mockResolvedValue({ url: "file:///C:/Exports/Cut-1.mp4" }),
      onProductionProgress: vi.fn((callback) => { progressCallback = callback; return vi.fn(); }),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    document.querySelector("#workspace-export-path").value = "C:\\Exports";
    await app.createWorkspace();
    app.loadVideo({ name: "source.mp4", path: "C:\\Videos\\source.mp4", url: "file:///C:/Videos/source.mp4", size: 1000 });
    document.querySelector("#trim-start").value = "2";
    document.querySelector("#trim-end").value = "10";

    const result = await app.createFirstCut();
    expect(result.outputPath).toBe("C:\\Exports\\Cut-1.mp4");
    expect(desktop.produceVideo).toHaveBeenCalledWith(expect.objectContaining({ trimStart: 2, trimEnd: 10 }));
    expect(document.querySelector("#processing-title").textContent).toBe("First cut ready to review");
    expect(document.querySelector("#processing-panel .progress-track").getAttribute("aria-valuenow")).toBe("100");
    expect(document.querySelector("#video-preview").src).toBe("file:///C:/Exports/Cut-1.mp4");
  });

  it("uses local vision analysis, tone and direction to choose the rendered first cut", async () => {
    const desktop = {
      chooseExportPath: vi.fn(),
      analyzeVideo: vi.fn().mockResolvedValue({
        provider: "ollama-vision",
        model: "qwen3-vl:2b-instruct",
        candidates: [{ start: 18, end: 48, score: 92, title: "Visible product reveal", note: "Clear subject and strong hook." }],
      }),
      produceVideo: vi.fn().mockResolvedValue({ outputPath: "C:/Exports/semantic.mp4", duration: 30 }),
      restoreVideo: vi.fn().mockResolvedValue({ url: "file:///C:/Exports/semantic.mp4" }),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    document.querySelector("#workspace-export-path").value = "C:/Exports";
    await app.createWorkspace();
    app.loadVideo({ name: "source.mp4", path: "C:/Videos/source.mp4", url: "file:///C:/Videos/source.mp4", size: 1000, duration: 120 });
    app.addToken("Energetic");
    document.querySelector("#final-use").value = "Paid social campaign";
    document.querySelector("#direction").value = "Open on the product reveal.";

    const result = await app.createFirstCut();

    expect(desktop.analyzeVideo).toHaveBeenCalledWith(expect.objectContaining({
      finalUse: "Paid social campaign",
      tone: "Energetic",
      direction: "Open on the product reveal.",
      targetLength: 30,
    }));
    expect(desktop.produceVideo).toHaveBeenCalledWith(expect.objectContaining({ trimStart: 18, trimEnd: 48 }));
    expect(result.analysis.provider).toBe("ollama-vision");
    expect(document.querySelector("#processing-curiosity").textContent).toContain("Visible product reveal");
  });
  it("renders the AI edit plan as a real multi-segment first cut", async () => {
    const desktop = {
      chooseExportPath: vi.fn(),
      analyzeVideo: vi.fn().mockResolvedValue({
        provider: "ollama-vision",
        model: "qwen3-vl:2b-instruct",
        candidates: [{ start: 20, end: 26, score: 96, title: "Hook" }],
        editPlan: {
          outputDuration: 15,
          removedDuration: 45,
          segments: [
            { start: 20, end: 25, role: "hook" },
            { start: 4, end: 9, role: "body" },
            { start: 50, end: 55, role: "close" },
          ],
        },
      }),
      produceEditedVideo: vi.fn().mockResolvedValue({
        outputPath: "C:/Exports/multicut.mp4",
        duration: 15,
        segmentCount: 3,
        removedDuration: 45,
      }),
      produceVideo: vi.fn(),
      restoreVideo: vi.fn().mockResolvedValue({ url: "file:///C:/Exports/multicut.mp4" }),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    document.querySelector("#workspace-export-path").value = "C:/Exports";
    await app.createWorkspace();
    app.loadVideo({ name: "source.mp4", path: "C:/Videos/source.mp4", url: "file:///C:/Videos/source.mp4", size: 1000, duration: 60 });

    const result = await app.createFirstCut();

    expect(desktop.analyzeVideo).toHaveBeenCalledWith(expect.objectContaining({ mode: "edit" }));
    expect(desktop.produceEditedVideo).toHaveBeenCalledWith(expect.objectContaining({
      segments: [
        expect.objectContaining({ start: 20, end: 25 }),
        expect.objectContaining({ start: 4, end: 9 }),
        expect.objectContaining({ start: 50, end: 55 }),
      ],
    }));
    expect(desktop.produceVideo).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".edit-plan-chip")).toHaveLength(3);
    expect(document.querySelector("#processing-curiosity").textContent).toContain("3 source sections concatenated");
    expect(result.segmentCount).toBe(3);
  });

  it("persists the latest replacement video and every editor field", async () => {
    const { document, window, app } = setup("file:///C:/Grayfox/index.html");
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    document.querySelector("#workspace-export-path").value = "Exports";
    await app.createWorkspace();

    app.loadVideo(videoFile(window, "wrong-first.mp4"));
    app.loadVideo(videoFile(window, "right-final.mp4"));
    document.querySelector("#final-use").value = "YouTube";
    document.querySelector("#direction").value = "Keep the correct final source.";
    app.addToken("Direct");
    document.querySelector("#short-length").value = "45–60 seconds";
    document.querySelector("#short-tone-token").value = "candid";
    document.querySelector("#trim-start").value = "4.5";
    document.querySelector("#trim-end").value = "18";
    [...document.querySelectorAll(".segmented button")].find((button) => button.textContent === "Reels").click();

    const project = await app.saveProject("Ready");
    expect(project.source.name).toBe("right-final.mp4");
    expect(project.editor).toEqual({
      finalUse: "YouTube",
      direction: "Keep the correct final source.",
      tokens: ["Direct"],
    });
    expect(project.shorts).toEqual({ length: "45–60 seconds", platform: "Reels", tone: "candid" });
    expect(project.trim).toEqual({ start: 4.5, end: 18 });
  });

  it("handles drag state and dropped video files", () => {
    const { document, window, app } = setup();
    const stage = document.querySelector("#video-stage");
    stage.dispatchEvent(new window.Event("dragover", { bubbles: true, cancelable: true }));
    expect(stage.style.outline).toContain("#C41E1E");
    const drop = new window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [videoFile(window)] } });
    stage.dispatchEvent(drop);
    expect(stage.style.outline).toBe("");
    expect(app.state.file.name).toBe("interview.mp4");
  });
});

describe("Story Clips and export workflows", () => {
  it("switches the selected publishing platform", () => {
    const { document } = setup();
    const reels = [...document.querySelectorAll(".segmented button")]
      .find((button) => button.textContent === "Reels");
    reels.click();
    expect(reels.classList.contains("active")).toBe(true);
    expect(document.querySelector(".segmented button").classList.contains("active")).toBe(false);
  });

  it("requires a video before finding moments", () => {
    const { document } = setup();
    document.querySelector("#find-moments").click();
    expect(document.querySelector("#toast").textContent).toContain("Upload your long-form video");
  });

  it("builds measurable fallback ranges when desktop vision AI is unavailable", async () => {
    const { document, app } = setup();
    app.loadVideo({ name: "long.mp4", path: null, url: "file:///C:/Videos/long.mp4", size: 1000, duration: 300 });
    document.querySelector("#short-tone-token").value = "bold, candid";
    const candidates = await app.findClipRanges();
    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toEqual(expect.objectContaining({ start: 36, end: 73, score: 1 }));
    expect(document.querySelectorAll(".candidate-list .candidate")).toHaveLength(3);
    expect([...document.querySelectorAll(".candidate-score")].map((node) => node.textContent)).toEqual(["1", "2", "3"]);
    expect(document.querySelector(".candidate p").textContent).toContain("no semantic AI score is claimed");
    expect(document.querySelector("#toast").textContent).toBe("3 moments ranked with measured local signals.");
  });

  it("shows semantic edit and meme scores returned by local vision AI", async () => {
    const desktop = {
      chooseExportPath: vi.fn(),
      analyzeVideo: vi.fn().mockResolvedValue({
        provider: "ollama-vision",
        model: "qwen3-vl:2b-instruct",
        candidates: [
          { start: 10, end: 32, score: 94, memeScore: 88, title: "Surprised reaction", note: "A clear reaction creates an immediate hook.", memeReason: "Strong reaction face with room for a caption." },
          { start: 50, end: 72, score: 82, memeScore: 40, title: "Product detail", note: "The subject is visible.", memeReason: "Limited punchline signal." },
        ],
      }),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    app.loadVideo({ name: "long.mp4", path: "C:/Videos/long.mp4", url: "file:///C:/Videos/long.mp4", size: 1000, duration: 120 });
    document.querySelector("#short-tone-token").value = "funny, candid";

    const candidates = await app.findClipRanges();

    expect(candidates[0]).toEqual(expect.objectContaining({ score: 94, memeScore: 88 }));
    expect(desktop.analyzeVideo).toHaveBeenCalledWith(expect.objectContaining({ tone: "funny, candid" }));
    expect(document.querySelector(".candidate h4").textContent).toBe("Surprised reaction");
    expect(document.querySelector(".meme-signal").textContent).toContain("Meme 88/100");
    expect(document.querySelector("#toast").textContent).toBe("2 moments ranked with local vision AI.");
  });
  it("renders a suggested story range as a real MP4 through the desktop bridge", async () => {
    const desktop = {
      chooseExportPath: vi.fn(),
      produceVideo: vi.fn().mockResolvedValue({ outputPath: "C:/Exports/story-1.mp4", duration: 37 }),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    document.querySelector("#workspace-export-path").value = "C:/Exports";
    await app.createWorkspace();
    app.loadVideo({ name: "long.mp4", path: "C:/Videos/long.mp4", url: "file:///C:/Videos/long.mp4", size: 1000, duration: 300 });
    await app.findClipRanges();

    const result = await app.renderStoryClip(0);
    expect(result.outputPath).toBe("C:/Exports/story-1.mp4");
    expect(desktop.produceVideo).toHaveBeenCalledWith(expect.objectContaining({
      sourcePath: "C:/Videos/long.mp4",
      trimStart: 36,
      trimEnd: 73,
    }));
    expect(document.querySelector(".clip-output").textContent).toBe("C:/Exports/story-1.mp4");
  });
  it("produces the saved latest source through the desktop FFmpeg bridge", async () => {
    let progressCallback;
    const desktop = {
      loadWorkspace: vi.fn().mockResolvedValue({ userName: "Marco", exportPath: "C:\\Exports", projects: [] }),
      saveWorkspace: vi.fn(async (workspace) => workspace),
      chooseExportPath: vi.fn(),
      restoreVideo: vi.fn(),
      produceVideo: vi.fn().mockResolvedValue({ outputPath: "C:\\Exports\\Final-1.mp4", duration: 10 }),
      onProductionProgress: vi.fn((callback) => { progressCallback = callback; return vi.fn(); }),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    document.querySelector("#workspace-export-path").value = "C:/Exports";
    await app.createWorkspace();
    app.loadVideo({ name: "right-final.mp4", path: "C:/Videos/right-final.mp4", url: "file:///C:/Videos/right-final.mp4", size: 1000 });
    document.querySelector("#trim-start").value = "2";
    document.querySelector("#trim-end").value = "12";
    progressCallback({ percent: 54 });
    expect(document.querySelector("#production-percent").textContent).toBe("54%");

    const result = await app.produceCurrentVideo();
    expect(result.outputPath).toBe("C:\\Exports\\Final-1.mp4");
    expect(desktop.produceVideo).toHaveBeenCalledWith(expect.objectContaining({
      sourcePath: "C:/Videos/right-final.mp4",
      trimStart: 2,
      trimEnd: 12,
    }));
    expect(document.querySelector("#production-title").textContent).toBe("Video ready");
  });

  it("validates export before and after a video is loaded", () => {
    const { document, window, app } = setup();
    document.querySelector("#export-button").click();
    expect(document.querySelector("#toast").textContent).toBe("Add a video before exporting.");
    app.loadVideo(videoFile(window));
    document.querySelector("#export-button").click();
    expect(document.querySelector("#toast").textContent)
      .toBe("Open the Grayfox desktop app to render this saved project.");
  });
});

describe("Workspace setup and project history", () => {
  it("asks for a name and export folder when no workspace exists", async () => {
    const desktop = {
      loadWorkspace: vi.fn().mockResolvedValue(null),
      saveWorkspace: vi.fn(),
      chooseExportPath: vi.fn(),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    await app.ready;
    expect(document.querySelector("#workspace-modal").hidden).toBe(false);
    expect(document.querySelector("#workspace-user-name")).not.toBeNull();
    expect(document.querySelector("#workspace-export-path")).not.toBeNull();
  });

  it("always shows fresh onboarding and ignores previous stored workspace data", async () => {
    const desktop = {
      loadWorkspace: vi.fn().mockResolvedValue({ userName: "Old user", exportPath: "C:/Old", projects: [] }),
      saveWorkspace: vi.fn(),
      chooseExportPath: vi.fn(),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    await app.ready;
    expect(document.querySelector("#workspace-modal").hidden).toBe(false);
    expect(document.querySelector("#workspace-user-name").value).toBe("");
    expect(document.querySelector("#workspace-export-path").value).toBe("");
    expect(desktop.loadWorkspace).not.toHaveBeenCalled();
  });
  it("chooses a folder and keeps renamed work in the current session only", async () => {
    const desktop = {
      loadWorkspace: vi.fn().mockResolvedValue(null),
      chooseExportPath: vi.fn().mockResolvedValue("C:\\Users\\Marco\\Videos"),
      saveWorkspace: vi.fn(async (workspace) => workspace),
    };
    const { document, window, app } = setup("https://grayfox.local/", desktop);
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    await app.chooseExportPath();
    expect(document.querySelector("#workspace-export-path").value).toBe("C:\\Users\\Marco\\Videos");
    expect(document.querySelector("#selected-export-path").textContent).toBe("C:\\Users\\Marco\\Videos");
    expect(document.querySelector("#workspace-location").textContent).toBe("C:\\Users\\Marco\\Videos");
    expect(await app.createWorkspace()).toBe(true);
    expect(document.querySelector("#workspace-modal").hidden).toBe(true);

    const projectName = document.querySelector("#project-name");
    projectName.value = "Launch film";
    projectName.dispatchEvent(new window.Event("input", { bubbles: true }));
    projectName.dispatchEvent(new window.Event("change", { bubbles: true }));
    await Promise.resolve();
    expect(app.state.projectName).toBe("Launch film");
    expect(document.querySelector(".recent-item strong").textContent).toBe("Launch film");
    expect(desktop.saveWorkspace).not.toHaveBeenCalled();
  });

  it("uses the real directory picker in file preview mode and shows the selected folder", async () => {
    const { document, window, app } = setup("file:///C:/Grayfox/index.html");
    window.showDirectoryPicker = vi.fn().mockResolvedValue({ name: "Grayfox exports" });
    await app.ready;
    const picker = document.querySelector("#browser-folder-input");
    const clickSpy = vi.spyOn(picker, "click");

    expect(await app.chooseExportPath()).toBe("Grayfox exports");
    expect(clickSpy).not.toHaveBeenCalled();
    expect(document.querySelector("#workspace-export-path").value).toBe("Grayfox exports");
    expect(document.querySelector("#toast").textContent).toBe("Folder “Grayfox exports” selected.");
  });

  it("falls back to a folder upload when the directory picker is unavailable", async () => {
    const { document, window, app } = setup("file:///C:/Grayfox/index.html");
    window.showDirectoryPicker = vi.fn().mockRejectedValue(new Error("Unavailable"));
    await app.ready;
    const picker = document.querySelector("#browser-folder-input");
    const clickSpy = vi.spyOn(picker, "click");

    await app.chooseExportPath();
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it("shows onboarding immediately and does not hang when IndexedDB stalls", async () => {
    const { document, app } = setup(
      "file:///C:/Grayfox/index.html",
      null,
      "",
      (window) => {
        window.indexedDB = { open: vi.fn(() => ({})) };
      },
    );

    expect(document.querySelector("#workspace-modal").hidden).toBe(false);
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    document.querySelector("#workspace-export-path").value = "Grayfox exports";
    await expect(app.createWorkspace()).resolves.toBe(true);
    expect(document.querySelector("#workspace-modal").hidden).toBe(true);
  });

  it("does not retain name, folder, projects, or profile image after reload", async () => {
    const first = setup("file:///C:/Grayfox/index.html");
    await first.app.ready;
    first.document.querySelector("#workspace-user-name").value = "Marco";
    first.document.querySelector("#workspace-export-path").value = "Grayfox exports";
    expect(await first.app.setProfileImage("data:image/png;base64,aGVsbG8=")).toBe(true);
    expect(await first.app.createWorkspace()).toBe(true);
    await first.app.saveProject("Temporary draft");
    expect(first.window.name).toBe("");

    const second = setup("file:///C:/Grayfox/index.html");
    await second.app.ready;
    expect(second.document.querySelector("#workspace-modal").hidden).toBe(false);
    expect(second.document.querySelector("#workspace-user-name").value).toBe("");
    expect(second.document.querySelector("#workspace-export-path").value).toBe("");
    expect(second.document.querySelector("#workspace-avatar").classList.contains("has-image")).toBe(false);
  });
  it("manages and removes a profile image inside the current session", async () => {
    const desktop = {
      loadWorkspace: vi.fn().mockResolvedValue({
        userName: "Marco",
        exportPath: "C:\\Exports",
        profileImage: null,
        projects: [],
      }),
      saveWorkspace: vi.fn(async (workspace) => workspace),
      chooseExportPath: vi.fn(),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    await app.ready;

    document.querySelector("#workspace-user-name").value = "Marco";
    document.querySelector("#workspace-export-path").value = "C:/Exports";
    await app.createWorkspace();

    expect(await app.setProfileImage("data:image/webp;base64,aGVsbG8=")).toBe(true);
    expect(document.querySelector("#workspace-avatar").classList.contains("has-image")).toBe(true);
    expect(document.querySelector("#workspace-avatar-image").hidden).toBe(false);
    expect(document.querySelector("#workspace-avatar-image").getAttribute("src")).toBe("data:image/webp;base64,aGVsbG8=");
    expect(document.querySelector("#profile-image-preview-image").hidden).toBe(false);
    expect(document.querySelector("#remove-profile-image").hidden).toBe(false);
    expect(document.querySelector("#profile-image-status").textContent).toContain("approved");
    expect(desktop.saveWorkspace).not.toHaveBeenCalled();

    document.querySelector("#remove-profile-image").click();
    await Promise.resolve();
    expect(document.querySelector("#workspace-avatar").classList.contains("has-image")).toBe(false);
    expect(app.state.profileImage).toBeNull();
  });

  it("explains why a profile image is rejected", async () => {
    const { document, app } = setup();
    expect(await app.setProfileImage("data:image/gif;base64,aGVsbG8=")).toBe(false);
    expect(document.querySelector("#profile-image-status").textContent).toContain("not approved");
    expect(document.querySelector("#profile-image-status").classList.contains("error")).toBe(true);
  });
});

describe("Contextual Grayfox guidance", () => {
  it("opens a function explanation and reads it aloud", () => {
    const { document, window } = setup();
    const speak = vi.fn();
    const cancel = vi.fn();
    window.speechSynthesis = { speak, cancel };
    window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) {
      this.text = text;
    };
    document.querySelector('[aria-label="Explain tone tokens"]').click();
    expect(document.querySelector("#help-popover").hidden).toBe(false);
    expect(document.querySelector("#help-title").textContent).toBe("Tone tokens");
    document.querySelector("#speak-help").click();
    expect(speak).toHaveBeenCalledOnce();
    expect(speak.mock.calls[0][0].text).toContain("pace, music, captions, and cuts");
  });

  it("shows a clear fallback when voice is unavailable", () => {
    const { document } = setup();
    document.querySelector('[aria-label="Explain final use"]').click();
    document.querySelector("#speak-help").click();
    expect(document.querySelector("#toast").textContent).toContain("Voice guidance is not available");
  });
});
