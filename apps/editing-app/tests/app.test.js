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

function setDurationRange(document, minimumMinutes, maximumMinutes = minimumMinutes) {
  document.querySelector("#minimum-minutes").value = String(minimumMinutes);
  document.querySelector("#maximum-minutes").value = String(maximumMinutes);
}

afterEach(() => {
  while (openDoms.length) openDoms.pop().window.close();
  vi.restoreAllMocks();
});

describe("Grayfox initial state and routing", () => {
  it("starts in Story Clips and presents it before Video Ops", () => {
    const { document, app } = setup();
    expect(app.state.activeView).toBe("shorts");
    expect(document.querySelector("#shorts").classList.contains("active")).toBe(true);
    expect(document.querySelector("#page-title").textContent).toBe("Story clips");
    expect([...document.querySelectorAll(".nav-item")].map((button) => button.dataset.view))
      .toEqual(["shorts", "video-ops"]);
    expect(document.querySelector("#brief-copy").textContent)
      .toBe("Edit the uploaded video for website / landing page. Duration window incomplete. Enter both minimum and maximum duration.");
  });

  it("replaces the decorative workflow rail with the meme search surface", () => {
    const { document } = setup("https://grayfox.local/?screen=video-ops");
    expect(document.querySelector(".workflow-rail")).toBeNull();
    expect(document.querySelector("#meme-search-form")).not.toBeNull();
    expect(document.querySelector("#meme-search-results").children.length).toBeGreaterThanOrEqual(3);
    expect(document.querySelector("#meme-search-status").textContent).toContain("Local vocabulary");
  });

  it("uses the live red signal without ninja icons", () => {
    const { document } = setup();
    expect(document.querySelector('[data-testid="grayfox-brand"] img')).toBeNull();
    expect(document.querySelector('[data-testid="grayfox-brand"]').classList.contains("brand-art")).toBe(false);
    expect(document.querySelector(".ai-glyph")).toBeNull();
    expect(document.querySelector(".brief-signal.brand-signal")).not.toBeNull();
    expect(document.querySelector('.modal-grayfox-id')).toBeNull();
    expect(document.querySelector('.brand-signal[role="status"]').getAttribute("aria-label"))
      .toBe("Grayfox active");
    expect(document.querySelector(".status-pill").textContent).toContain("Session active");
    expect(document.querySelector("#workspace-avatar-initials").textContent).toBe("GF");
  });
  it("opens Video Ops from an explicit URL route", () => {
    const { document, app } = setup("https://grayfox.local/?screen=video-ops");
    expect(app.state.activeView).toBe("video-ops");
    expect(document.querySelector("#video-ops").classList.contains("active")).toBe(true);
    expect(document.querySelector("#page-title").textContent).toBe("Video ops");
  });

  it("keeps Story Clips as the launch view when a saved project last used Video Ops", async () => {
    const desktop = {
      loadWorkspace: vi.fn().mockResolvedValue({
        userName: "Francesco",
        exportPath: "C:/Exports",
        currentProjectId: "saved-video-ops",
        projects: [{ id: "saved-video-ops", name: "Saved edit", view: "video-ops" }],
      }),
      saveWorkspace: vi.fn(async (workspace) => workspace),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);

    await app.ready;

    expect(app.state.activeView).toBe("shorts");
    expect(document.querySelector("#shorts").classList.contains("active")).toBe(true);
  });

  it("enables the forced mobile capture mode from the URL", () => {
    const { document } = setup("https://grayfox.local/?mobile=1");
    expect(document.body.classList.contains("mobile-capture")).toBe(true);
  });

  it("switches between both navigation integrations", () => {
    const { document, app } = setup();
    document.querySelector('[data-view="video-ops"]').click();
    expect(app.state.activeView).toBe("video-ops");
    expect(document.querySelector("#page-title").textContent).toBe("Video ops");
    document.querySelector('[data-view="shorts"]').click();
    expect(app.state.activeView).toBe("shorts");
    expect(document.querySelector("#section-label").textContent).toBe("VERTICAL CLIP STUDIO");
  });
});

describe("Tone token controls", () => {
  it("normalizes hashes and repeated whitespace", () => {
    const { app } = setup();
    expect(app.normalizeToken("  #calm   and   clear  ")).toBe("calm and clear");
  });

  it("adds, renders, and removes a token", () => {
    const { document, app } = setup();
    expect(document.querySelector("#tone-token-count").textContent).toBe("0 / 6 tags");
    expect(app.addToken("Premium")).toBe(true);
    expect(app.state.tokens).toEqual(["Premium"]);
    expect(document.querySelector(".tone-chip span").textContent).toBe("Premium");
    expect(document.querySelector("#tone-token-count").textContent).toBe("1 / 6 tags");
    document.querySelector('[aria-label="Remove Premium"]').click();
    expect(app.state.tokens).toEqual([]);
    expect(document.querySelectorAll(".tone-chip")).toHaveLength(0);
    expect(document.querySelector("#tone-token-count").textContent).toBe("0 / 6 tags");
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

  it("makes the whole cleaned import surface choose a desktop video", async () => {
    const desktop = {
      chooseVideo: vi.fn().mockResolvedValue({ name: "direct.mp4", path: "C:/Videos/direct.mp4", url: "file:///C:/Videos/direct.mp4", duration: 42 }),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);

    document.querySelector("#empty-state").click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(desktop.chooseVideo).toHaveBeenCalledOnce();
    expect(app.state.source.name).toBe("direct.mp4");
    expect(document.querySelector("#empty-state").style.display).toBe("none");
    expect(document.querySelector(".upload-signal")).not.toBeNull();
  });

  it("uses a gray pulse for an empty recent workflow and a real frame after loading", async () => {
    const { document, window, app } = setup("file:///C:/Grayfox/index.html", null, "", (testWindow) => {
      testWindow.HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() }));
      testWindow.HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/jpeg;base64,grayfoxframe");
    });
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    document.querySelector("#workspace-export-path").value = "C:/Exports";
    await app.createWorkspace();
    await app.saveProject("Draft");
    expect(document.querySelector(".recent-placeholder-signal")).not.toBeNull();

    const preview = document.querySelector("#video-preview");
    Object.defineProperty(preview, "videoWidth", { configurable: true, value: 1920 });
    Object.defineProperty(preview, "videoHeight", { configurable: true, value: 1080 });
    app.loadVideo(videoFile(window, "workflow.mp4"));
    preview.dispatchEvent(new window.Event("loadeddata"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.state.projectThumbnail).toBe("data:image/jpeg;base64,grayfoxframe");
    expect(document.querySelector(".recent-thumb img").src).toBe("data:image/jpeg;base64,grayfoxframe");
    expect(document.querySelector(".recent-placeholder-signal")).toBeNull();
  });

  it("rejects unavailable, failed, and oversized workflow frame captures", () => {
    const { document, app } = setup();
    const preview = document.querySelector("#video-preview");
    expect(app.captureProjectThumbnail()).toBeNull();

    Object.defineProperty(preview, "videoWidth", { configurable: true, value: 1920 });
    Object.defineProperty(preview, "videoHeight", { configurable: true, value: 1080 });
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
      const element = originalCreateElement(tagName, options);
      if (tagName === "canvas") element.getContext = vi.fn(() => null);
      return element;
    });
    expect(app.captureProjectThumbnail()).toBeNull();

    document.createElement.mockImplementation((tagName, options) => {
      const element = originalCreateElement(tagName, options);
      if (tagName === "canvas") {
        element.getContext = vi.fn(() => ({ drawImage: () => { throw new Error("frame blocked"); } }));
      }
      return element;
    });
    expect(app.captureProjectThumbnail()).toBeNull();

    document.createElement.mockImplementation((tagName, options) => {
      const element = originalCreateElement(tagName, options);
      if (tagName === "canvas") {
        element.getContext = vi.fn(() => ({ drawImage: vi.fn() }));
        element.toDataURL = vi.fn(() => `data:image/jpeg;base64,${"x".repeat(300001)}`);
      }
      return element;
    });
    expect(app.captureProjectThumbnail()).toBeNull();
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

  it("shows an actionable message when the selected source cannot be previewed", () => {
    const { document, window, app } = setup();
    app.loadVideo({ name: "moved.mp4", path: "C:/Videos/moved.mp4", url: "file:///C:/Videos/moved.mp4", duration: 60 });

    document.querySelector("#video-preview").dispatchEvent(new window.Event("error"));

    expect(document.querySelector("#video-preview").style.display).toBe("none");
    expect(document.querySelector("#empty-state").style.display).toBe("grid");
    expect(document.querySelector("#empty-state h2").textContent).toContain("Preview unavailable for moved.mp4");
    expect(document.querySelector("#empty-state p").textContent).toContain("Choose Replace video");
    expect(document.querySelector("#toast").textContent).toContain("project data is still safe");
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
      "Edit “launch.mp4” for youtube with a Premium, Direct tone. Direction: Open on the customer result. Duration window incomplete. Enter both minimum and maximum duration."
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

  it("reconnects a remembered source inside Electron before rendering", async () => {
    const desktop = {
      chooseExportPath: vi.fn(),
      chooseVideo: vi.fn().mockResolvedValue({ name: "interview.mp4", path: "C:/Videos/interview.mp4", url: "file:///C:/Videos/interview.mp4", duration: 60 }),
      produceVideo: vi.fn().mockResolvedValue({ outputPath: "C:/Exports/reconnected.mp4", duration: 45 }),
      restoreVideo: vi.fn().mockResolvedValue({ url: "file:///C:/Exports/reconnected.mp4" }),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    document.querySelector("#workspace-export-path").value = "C:/Exports";
    await app.createWorkspace();
    app.loadVideo({ name: "interview.mp4", path: null, url: "file:///remembered/interview.mp4", duration: 60 });
    setDurationRange(document, 0.1, 1);

    const result = await app.createFirstCut();

    expect(desktop.chooseVideo).toHaveBeenCalledOnce();
    expect(desktop.produceVideo).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: "C:/Videos/interview.mp4" }));
    expect(result.outputPath).toBe("C:/Exports/reconnected.mp4");
    expect(document.querySelector("#toast").textContent).not.toContain("browser preview");
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
    setDurationRange(document, 0.1, 0.2);

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
    setDurationRange(document, 0.25, 0.5);

    const result = await app.createFirstCut();

    expect(desktop.analyzeVideo).toHaveBeenCalledWith(expect.objectContaining({
      finalUse: "Paid social campaign",
      tone: "Energetic",
      segmentLength: 6,
      direction: "Open on the product reveal.",
      targetLength: 30,
      minimumDuration: 15,
      maximumDuration: 30,
    }));
    expect(desktop.produceVideo).toHaveBeenCalledWith(expect.objectContaining({ trimStart: 18, trimEnd: 48 }));
    expect(result.analysis.provider).toBe("ollama-vision");
    expect(document.querySelector("#processing-curiosity").textContent).toContain("Visible product reveal");
  });
  it("parses production duration from natural-language directions", () => {
    const { app } = setup();
    expect(app.parseRequestedDurationSeconds("Give me 40 minutes")).toBe(2400);
    expect(app.parseRequestedDurationSeconds("Cut this to 1.5 hours")).toBe(5400);
    expect(app.parseRequestedDurationSeconds("Need a 20 seconds teaser")).toBe(20);
    expect(app.parseRequestedDurationSeconds("try to reach more than 2 minutes")).toBe(0);
    expect(app.parseDurationRequirement("try to reach more than 2 minutes")).toEqual({ seconds: 120, kind: "minimum", strict: true });
    expect(app.parseDurationRequirement("almeno 3 minuti")).toEqual({ seconds: 180, kind: "minimum", strict: false });
    expect(app.parseDurationRequirement("no more than 10 minutes")).toEqual({ seconds: 600, kind: "maximum", strict: false });
  });

  it("never derives the production window from a duration written in directions", async () => {
    const desktop = {
      chooseExportPath: vi.fn(),
      analyzeVideo: vi.fn(),
      produceVideo: vi.fn(),
      produceEditedVideo: vi.fn(),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    document.querySelector("#workspace-export-path").value = "C:/Exports";
    await app.createWorkspace();
    app.loadVideo({ name: "long.mp4", path: "C:/Videos/long.mp4", url: "file:///C:/Videos/long.mp4", duration: 3600 });
    document.querySelector("#direction").value = "Keep the story and try to reach more than 2 minutes";
    document.querySelector("#direction").dispatchEvent(new document.defaultView.Event("input", { bubbles: true }));

    const result = await app.createFirstCut();

    expect(result).toBeNull();
    expect(desktop.analyzeVideo).not.toHaveBeenCalled();
    expect(document.querySelector("#brief-copy").textContent).toContain("Duration window incomplete");
    expect(document.querySelector("#toast").textContent).toContain("both minimum and maximum");
  });

  it("keeps a two-to-thirty-minute window when directions mention more than two", () => {
    const { document, app } = setup();
    setDurationRange(document, 2, 30);
    document.querySelector("#direction").value = "try to reach more than 2 minutes";

    app.updateBrief();

    expect(app.requestedProductionSeconds()).toBe(1800);
    expect(app.productionDurationRange()).toEqual(expect.objectContaining({ minimumSeconds: 120, maximumSeconds: 1800, valid: true }));
    expect(document.querySelector("#brief-copy").textContent).toContain("Duration window: 02:00–30:00");
  });

  it("accepts a ten-minute edit inside a two-to-thirty-minute window", async () => {
    const segments = [{ start: 300, end: 630, role: "hook" }, { start: 900, end: 1227, role: "close" }];
    const desktop = {
      analyzeVideo: vi.fn().mockResolvedValue({
        targetLength: 1800,
        minimumDuration: 120,
        maximumDuration: 1800,
        candidates: [{ start: 300, end: 630, score: 95, title: "Story" }],
        editPlan: { segments, outputDuration: 657, minimumDuration: 120, maximumDuration: 1800 },
      }),
      produceVideo: vi.fn(),
      produceEditedVideo: vi.fn().mockResolvedValue({ outputPath: "C:/Exports/ranged.mp4", duration: 657, segmentCount: 2, skippedSegments: [] }),
      restoreVideo: vi.fn().mockResolvedValue({ url: "file:///C:/Exports/ranged.mp4" }),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    app.state.workspace = { exportPath: "C:/Exports", projects: [] };
    app.loadVideo({ name: "long.mp4", path: "C:/Videos/long.mp4", url: "file:///C:/Videos/long.mp4", duration: 3600 });
    setDurationRange(document, 2, 30);

    const result = await app.createFirstCut();

    expect(desktop.produceEditedVideo).toHaveBeenCalledWith(expect.objectContaining({ minimumDuration: 120, maximumDuration: 1800 }));
    expect(result).toEqual(expect.objectContaining({ duration: 657, meetsTarget: true, minimumDuration: 120, maximumDuration: 1800 }));
    expect(document.querySelector("#processing-title").textContent).toBe("First cut ready to review");
    expect(document.querySelector("#processing-curiosity").textContent).toContain("duration window met");
  });

  it("blocks an inverted duration window before analysis", async () => {
    const desktop = { analyzeVideo: vi.fn(), produceVideo: vi.fn(), onProductionProgress: vi.fn(() => vi.fn()) };
    const { document, app } = setup("https://grayfox.local/", desktop);
    app.state.workspace = { exportPath: "C:/Exports", projects: [] };
    app.loadVideo({ name: "long.mp4", path: "C:/Videos/long.mp4", url: "file:///C:/Videos/long.mp4", duration: 3600 });
    setDurationRange(document, 30, 2);
    app.updateBrief();

    expect(await app.createFirstCut()).toBeNull();
    expect(desktop.analyzeVideo).not.toHaveBeenCalled();
    expect(document.querySelector("#toast").textContent).toContain("Maximum duration must be greater");
    expect(document.querySelector("#maximum-minutes").getAttribute("aria-invalid")).toBe("true");
  });

  it("passes a forty-minute requirement through analysis and rendering", async () => {
    const segments = [
      { start: 0, end: 480, role: "hook" },
      { start: 540, end: 1020, role: "body" },
      { start: 1080, end: 1560, role: "body" },
      { start: 1620, end: 2100, role: "body" },
      { start: 2160, end: 2640, role: "close" },
    ];
    const desktop = {
      chooseExportPath: vi.fn(),
      analyzeVideo: vi.fn().mockResolvedValue({
        targetLength: 2400,
        candidates: [{ start: 0, end: 20, score: 90, title: "Opening" }],
        editPlan: { segments, outputDuration: 2400, requestedDuration: 2400, durationLocked: true },
      }),
      produceEditedVideo: vi.fn().mockResolvedValue({
        outputPath: "C:/Exports/forty-minutes.mp4", duration: 2400, targetDuration: 2400,
        meetsTarget: true, segmentCount: 5, requestedSegmentCount: 5, skippedSegments: [], removedDuration: 300,
      }),
      produceVideo: vi.fn(),
      restoreVideo: vi.fn().mockResolvedValue({ url: "file:///C:/Exports/forty-minutes.mp4" }),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    document.querySelector("#workspace-export-path").value = "C:/Exports";
    await app.createWorkspace();
    app.loadVideo({ name: "long.mp4", path: "C:/Videos/long.mp4", url: "file:///C:/Videos/long.mp4", size: 1000, duration: 2700 });
    setDurationRange(document, 40, 40);

    const result = await app.createFirstCut();

    expect(desktop.analyzeVideo).toHaveBeenCalledWith(expect.objectContaining({ targetLength: 2400 }));
    expect(desktop.produceEditedVideo).toHaveBeenCalledWith(expect.objectContaining({ minimumDuration: 2400, maximumDuration: 2400, segments }));
    expect(result.duration).toBe(2400);
    expect(document.querySelector("#processing-eta").textContent).toBe("40:00 · inside 40:00–40:00");
    expect(document.querySelector("#processing-curiosity").textContent).toContain("duration window met");
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
          toneProfile: { id: "energetic-direct", label: "Energetic / direct", memeThreshold: 68 },
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
    setDurationRange(document, 0.25, 0.25);

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
    expect(document.querySelectorAll(".edit-plan-chip")).toHaveLength(4);
    expect(document.querySelector("#edit-plan-summary").textContent).toContain("Tone · Energetic / direct");
    expect(document.querySelector("#processing-curiosity").textContent).toContain("duration window met");
    expect(document.querySelector("#processing-curiosity").textContent).toContain("Energetic / direct tone profile applied");
    expect(result.segmentCount).toBe(3);
  });

  it("uses the edit renderer for a one-segment plan so visual changes are not dropped", async () => {
    const segment = { start: 5, end: 11, role: "hook", effect: "meme-flash", memeEnabled: true, memeStart: 6, memeEnd: 7.2 };
    const desktop = {
      analyzeVideo: vi.fn().mockResolvedValue({
        targetLength: 6,
        minimumDuration: 6,
        maximumDuration: 6,
        candidates: [{ start: 5, end: 11, score: 95, title: "Reveal" }],
        editPlan: { segments: [segment], outputDuration: 6 },
      }),
      produceEditedVideo: vi.fn().mockResolvedValue({
        outputPath: "C:/Exports/single-edited.mp4", duration: 6, segmentCount: 1, segments: [segment], meetsTarget: true,
      }),
      produceVideo: vi.fn(),
      restoreVideo: vi.fn().mockResolvedValue({ url: "file:///C:/Exports/single-edited.mp4" }),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/?screen=video-ops", desktop);
    app.state.workspace = { exportPath: "C:/Exports", projects: [] };
    app.loadVideo({ name: "source.mp4", path: "C:/Videos/source.mp4", url: "file:///C:/Videos/source.mp4", duration: 30 });
    setDurationRange(document, 0.1, 0.1);

    const result = await app.createFirstCut();

    expect(desktop.produceEditedVideo).toHaveBeenCalledWith(expect.objectContaining({ segments: [expect.objectContaining({ effect: "meme-flash" })] }));
    expect(desktop.produceVideo).not.toHaveBeenCalled();
    expect(result.editPlan.segments[0].effect).toBe("meme-flash");
    expect(app.state.firstCutStale).toBe(false);
  });

  it("keeps a usable first cut and warns when damaged source sections are skipped", async () => {
    const desktop = {
      chooseExportPath: vi.fn(),
      analyzeVideo: vi.fn().mockResolvedValue({
        candidates: [{ start: 1, end: 3, score: 90, title: "Hook" }],
        editPlan: {
          segments: [
            { start: 1, end: 3, role: "hook" },
            { start: 2226, end: 2230, role: "close" },
          ],
        },
      }),
      produceEditedVideo: vi.fn().mockResolvedValue({
        outputPath: "C:/Exports/recovered.mp4",
        duration: 2,
        segmentCount: 1,
        requestedSegmentCount: 2,
        removedDuration: 2243,
        skippedSegments: [{ start: 2226, end: 2230, reason: "Source section is incomplete or damaged." }],
      }),
      produceVideo: vi.fn(),
      restoreVideo: vi.fn().mockResolvedValue({ url: "file:///C:/Exports/recovered.mp4" }),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    document.querySelector("#workspace-export-path").value = "C:/Exports";
    await app.createWorkspace();
    app.loadVideo({ name: "damaged.mp4", path: "C:/Videos/damaged.mp4", url: "file:///C:/Videos/damaged.mp4", size: 1000, duration: 2245 });
    document.querySelector("#direction").value = "Make a 2 seconds recovery test.";
    setDurationRange(document, 0.02, 0.1);

    const result = await app.createFirstCut();

    expect(result.segmentCount).toBe(1);
    expect(result.skippedSegments).toHaveLength(1);
    expect(document.querySelector("#processing-title").textContent).toBe("First cut ready with a source warning");
    expect(document.querySelector("#processing-eta").textContent).toBe("00:02 rendered");
    expect(document.querySelector("#processing-curiosity").textContent).toContain("1 damaged or incomplete section was skipped");
    expect(document.querySelector("#video-preview").src).toBe("file:///C:/Exports/recovered.mp4");
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
      minimumMinutes: 0,
      maximumMinutes: 0,
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

describe("First cut approval and handoff", () => {
  it("guards review decisions and handoffs until a rendered cut exists", async () => {
    const { document, app } = setup();
    app.updateReviewPanel();
    expect(document.querySelector("#review-panel").hidden).toBe(true);
    expect(app.firstCutCount()).toBe(0);
    expect(app.firstCutCount({ editPlan: { segments: [{}, {}] } })).toBe(2);
    expect(app.firstCutCount({ outputPath: "cut.mp4" })).toBe(1);
    expect(await app.approveFirstCut()).toBe(false);
    expect(app.requestFirstCutChanges()).toBe(false);
    expect(await app.renderRevision()).toBeNull();
    expect(await app.createApprovedHandoff()).toBeNull();
  });

  it("shows cut count, requires approval, records revision feedback, and creates a handoff", async () => {
    const desktop = {
      loadWorkspace: vi.fn().mockResolvedValue(null),
      saveWorkspace: vi.fn(async (workspace) => workspace),
      chooseExportPath: vi.fn(),
      chooseTranscript: vi.fn().mockResolvedValue({ name: "interview.srt", path: "C:/Videos/interview.srt" }),
      analyzeVideo: vi.fn()
        .mockResolvedValueOnce({
          provider: "local-signals",
          dialogueProvider: "embedded-subtitles",
          dialogueCueCount: 4,
          targetLength: 12,
          candidates: [{ start: 2, end: 14, score: 90, title: "Answer" }],
          editPlan: { segments: [{ start: 2, end: 8, role: "hook" }, { start: 10, end: 16, role: "close" }] },
        })
        .mockResolvedValueOnce({
          provider: "local-signals",
          dialogueProvider: "embedded-subtitles",
          dialogueCueCount: 4,
          targetLength: 12,
          candidates: [{ start: 2, end: 14, score: 92, title: "Complete answer" }],
          editPlan: { segments: [{ start: 2, end: 9, role: "hook" }, { start: 12, end: 17, role: "close" }] },
        }),
      produceEditedVideo: vi.fn().mockResolvedValue({ outputPath: "C:/Exports/review.mp4", duration: 12, segmentCount: 2, meetsTarget: true }),
      restoreVideo: vi.fn().mockResolvedValue({ url: "file:///C:/Exports/review.mp4" }),
      createHandoff: vi.fn().mockResolvedValue({ path: "C:/Exports/Edit-Premiere.xml", message: "Premiere XML ready." }),
      onProductionProgress: vi.fn(() => vi.fn()),
      produceVideo: vi.fn(),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    document.querySelector("#workspace-export-path").value = "C:/Exports";
    await app.createWorkspace();
    app.loadVideo({ name: "interview.mp4", path: "C:/Videos/interview.mp4", url: "file:///C:/Videos/interview.mp4", duration: 60 });
    setDurationRange(document, 0.2, 0.2);
    document.querySelector("#choose-transcript").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector("#dialogue-source-status").textContent).toBe("interview.srt");

    await app.createFirstCut();
    expect(document.querySelector("#review-panel").hidden).toBe(false);
    expect(document.querySelector("#cut-count").textContent).toBe("2 cuts");
    expect(document.querySelectorAll(".cut-review-item")).toHaveLength(2);
    document.querySelector("#video-preview").play = vi.fn().mockResolvedValue(undefined);
    document.querySelectorAll("[data-review-cut]")[1].click();
    expect(document.querySelector("#video-preview").currentTime).toBe(6);
    expect(document.querySelector("#toast").textContent).toContain("Previewing cut 2");
    expect(document.querySelector("#review-summary").textContent).toContain("4 cues via embedded-subtitles");
    expect(desktop.analyzeVideo).toHaveBeenCalledWith(expect.objectContaining({ transcriptPath: "C:/Videos/interview.srt" }));
    expect(await app.produceCurrentVideo()).toBeNull();
    expect(document.querySelector("#toast").textContent).toContain("Approve the first cut");

    app.requestFirstCutChanges();
    expect(document.querySelector("#revision-box").hidden).toBe(false);
    document.querySelector("#revision-notes").value = "Keep the complete pricing answer.";
    await app.renderRevision();
    expect(desktop.analyzeVideo).toHaveBeenLastCalledWith(expect.objectContaining({ direction: expect.stringContaining("Revision request: Keep the complete pricing answer") }));

    await app.approveFirstCut();
    expect(document.querySelector("#review-status").textContent).toBe("Approved");
    expect(document.querySelector("#handoff-panel").hidden).toBe(true);
    document.querySelector("#export-button").click();
    expect(document.querySelector("#handoff-panel").hidden).toBe(false);
    expect(document.querySelector("#handoff-secondary").hidden).toBe(true);
    document.querySelector("#toggle-handoff-options").click();
    expect(document.querySelector("#handoff-secondary").hidden).toBe(false);
    expect(document.querySelector("#toggle-handoff-options").getAttribute("aria-expanded")).toBe("true");
    const handoff = await app.createApprovedHandoff();
    expect(handoff.path).toContain("Premiere.xml");
    expect(desktop.createHandoff).toHaveBeenCalledWith(expect.objectContaining({ target: "premiere", outputPath: "C:/Exports/review.mp4" }));
  });

  it("invalidates the previous render as soon as the editing brief changes", async () => {
    const { document, window, app } = setup("https://grayfox.local/?screen=video-ops");
    setDurationRange(document, 0.2, 0.2);
    app.state.firstCut = {
      outputPath: "C:/Exports/approved.mp4",
      duration: 12,
      approval: "approved",
      editPlan: { segments: [{ start: 2, end: 14, role: "hook" }] },
    };
    app.state.firstCut.renderedBriefSignature = app.currentBriefSignature();
    document.querySelector("#create-cut").closest(".button-with-help").hidden = true;
    app.updateReviewPanel();

    document.querySelector("#direction").value = "Remove the repeated opening.";
    document.querySelector("#direction").dispatchEvent(new window.Event("input", { bubbles: true }));

    expect(app.state.firstCutStale).toBe(true);
    expect(app.state.firstCut.approval).toBe("pending");
    expect(document.querySelector("#create-cut").closest(".button-with-help").hidden).toBe(false);
    expect(document.querySelector("#create-cut").textContent).toContain("Render updated cut");
    expect(document.querySelector("#review-status").textContent).toContain("render required");
    expect(await app.approveFirstCut()).toBe(false);
    expect(app.openSaveOptions()).toBe(false);
  });

  it("stops a revision when analysis returns the unchanged timeline", async () => {
    const desktop = {
      analyzeVideo: vi.fn().mockResolvedValue({
        targetLength: 12,
        minimumDuration: 12,
        maximumDuration: 12,
        candidates: [{ start: 2, end: 14, score: 90, title: "Same answer" }],
        editPlan: { segments: [{ start: 2, end: 14, role: "hook" }] },
      }),
      produceEditedVideo: vi.fn(),
      produceVideo: vi.fn(),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/?screen=video-ops", desktop);
    app.state.workspace = { exportPath: "C:/Exports", projects: [] };
    app.loadVideo({ name: "source.mp4", path: "C:/Videos/source.mp4", url: "file:///C:/Videos/source.mp4", duration: 60 });
    setDurationRange(document, 0.2, 0.2);
    app.state.firstCut = { outputPath: "C:/Exports/old.mp4", duration: 12, approval: "pending", editPlan: { segments: [{ start: 2, end: 14, role: "hook" }] } };
    app.requestFirstCutChanges();
    document.querySelector("#revision-notes").value = "Make this materially different.";

    const result = await app.renderRevision();

    expect(result).toBeNull();
    expect(desktop.produceEditedVideo).not.toHaveBeenCalled();
    expect(desktop.produceVideo).not.toHaveBeenCalled();
    expect(document.querySelector("#processing-curiosity").textContent).toContain("same timeline");
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
  it("saves the exact approved cut in the selected format", async () => {
    let progressCallback;
    const desktop = {
      loadWorkspace: vi.fn().mockResolvedValue({ userName: "Marco", exportPath: "C:\\Exports", projects: [] }),
      saveWorkspace: vi.fn(async (workspace) => workspace),
      chooseExportPath: vi.fn(),
      restoreVideo: vi.fn(),
      exportApprovedVideo: vi.fn().mockResolvedValue({ outputPath: "C:\\Exports\\Final-1.webm", duration: 10, format: "webm", label: "WebM · VP9/Opus" }),
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
    app.state.firstCut = { approval: "approved", outputPath: "C:/Exports/approved.mp4", duration: 10, approvedAt: new Date().toISOString() };
    progressCallback({ percent: 54 });

    const result = await app.produceCurrentVideo("webm");
    expect(result.outputPath).toBe("C:\\Exports\\Final-1.webm");
    expect(desktop.exportApprovedVideo).toHaveBeenCalledWith(expect.objectContaining({
      outputPath: "C:/Exports/approved.mp4",
      format: "webm",
    }));
    expect(document.querySelector("#toast").textContent).toContain("saved in your export folder");
  });

  it("opens Save only after approval and exposes the format chooser", () => {
    const { document, window, app } = setup();
    document.querySelector("#export-button").click();
    expect(document.querySelector("#toast").textContent).toBe("Approve the first cut before saving it.");
    app.loadVideo(videoFile(window));
    app.state.firstCut = { approval: "approved", outputPath: "C:/Exports/approved.mp4", duration: 10 };
    document.querySelector("#export-button").click();
    expect(document.querySelector("#handoff-panel").hidden).toBe(false);
    expect(document.querySelector("#export-format").value).toBe("mp4");
    expect(document.querySelector("#handoff-secondary").hidden).toBe(true);
    expect(document.querySelector("#create-handoff").classList.contains("primary-button")).toBe(false);
    expect(document.querySelector("#toast").textContent).toContain("secondary option");
    document.querySelector("#toggle-handoff-options").click();
    expect(document.querySelector("#handoff-secondary").hidden).toBe(false);
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

  it("restores the saved user and export folder", async () => {
    const desktop = {
      loadWorkspace: vi.fn().mockResolvedValue({ userName: "Old user", exportPath: "C:/Old", projects: [] }),
      saveWorkspace: vi.fn(),
      chooseExportPath: vi.fn(),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    await app.ready;
    expect(document.querySelector("#workspace-modal").hidden).toBe(true);
    expect(document.querySelector("#workspace-user-name").value).toBe("Old user");
    expect(document.querySelector("#workspace-export-path").value).toBe("C:/Old");
    expect(desktop.loadWorkspace).toHaveBeenCalledOnce();
  });

  it("recovers and persists a legacy preview source next to the export folder", async () => {
    const desktop = {
      loadWorkspace: vi.fn().mockResolvedValue({
        userName: "Francesco",
        exportPath: "D:/VODS/00_export",
        currentProjectId: "legacy-preview",
        projects: [{
          id: "legacy-preview",
          name: "Legacy preview",
          status: "Source ready",
          exportPath: "D:/VODS/00_export",
          source: { name: "recovery_01.mp4", path: null, duration: 4685.8 },
          editor: { finalUse: "YouTube", minimumMinutes: 2, maximumMinutes: 30, direction: "Keep the story", tokens: [] },
        }],
      }),
      saveWorkspace: vi.fn(async (workspace) => workspace),
      findRememberedVideo: vi.fn().mockResolvedValue({
        name: "recovery_01.mp4",
        path: "D:/VODS/recovery_01.mp4",
        url: "file:///D:/VODS/recovery_01.mp4",
        size: 23556898281,
        lastModified: 42,
      }),
      restoreVideo: vi.fn(),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);

    await app.ready;

    expect(desktop.findRememberedVideo).toHaveBeenCalledWith({ name: "recovery_01.mp4", exportPath: "D:/VODS/00_export" });
    expect(app.state.source.path).toBe("D:/VODS/recovery_01.mp4");
    expect(document.querySelector("#video-preview").src).toBe("file:///D:/VODS/recovery_01.mp4");
    expect(document.querySelector("#video-preview").style.display).toBe("block");
    expect(desktop.saveWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      projects: expect.arrayContaining([expect.objectContaining({ source: expect.objectContaining({ path: "D:/VODS/recovery_01.mp4" }) })]),
    }));
  });

  it("chooses a folder and persists renamed work", async () => {
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
    expect(desktop.saveWorkspace).toHaveBeenCalled();
    expect(desktop.saveWorkspace.mock.calls.at(-1)[0].projects[0].name).toBe("Launch film");
  });

  it("uses an explicit Downloads target in file preview mode without asking for an address", async () => {
    const { document, window, app } = setup("file:///C:/Grayfox/index.html");
    window.showDirectoryPicker = vi.fn();
    await app.ready;

    expect(document.querySelector("#workspace-export-path").readOnly).toBe(true);
    expect(document.querySelector("#choose-export-path").textContent).toBe("Use browser Downloads");
    expect(document.querySelector("#browser-folder-help").textContent).toContain("no Windows address is needed");
    expect(await app.chooseExportPath()).toBe("Browser Downloads (test mode)");
    expect(window.showDirectoryPicker).not.toHaveBeenCalled();
    expect(document.querySelector("#workspace-export-path").value).toBe("Browser Downloads (test mode)");
    expect(document.querySelector("#selected-export-path").textContent).toBe("Browser Downloads (test mode)");
    expect(document.querySelector("#toast").textContent).toBe("Browser test folder ready. No address required.");
  });

  it("unblocks browser onboarding after the Downloads target is confirmed", async () => {
    const { document, app } = setup("file:///C:/Grayfox/index.html");
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    await app.chooseExportPath();
    await expect(app.createWorkspace()).resolves.toBe(true);
    expect(document.querySelector("#workspace-modal").hidden).toBe(true);
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

  it("restores the user and production options on the next desktop launch", async () => {
    let savedWorkspace = null;
    const desktop = {
      loadWorkspace: vi.fn(async () => savedWorkspace),
      saveWorkspace: vi.fn(async (workspace) => {
        savedWorkspace = JSON.parse(JSON.stringify(workspace));
        return savedWorkspace;
      }),
      chooseExportPath: vi.fn(),
      restoreVideo: vi.fn().mockResolvedValue(null),
    };
    const first = setup("https://grayfox.local/", desktop);
    await first.app.ready;
    first.document.querySelector("#workspace-user-name").value = "Marco";
    first.document.querySelector("#workspace-export-path").value = "C:/Grayfox exports";
    await first.app.createWorkspace();
    first.document.querySelector("#project-name").value = "Long interview";
    setDurationRange(first.document, 20, 40);
    first.document.querySelector("#final-use").value = "YouTube";
    first.document.querySelector("#direction").value = "Keep the full conversation and remove dead air.";
    first.app.addToken("Natural");
    await first.app.saveProject("Production settings");

    const second = setup("https://grayfox.local/", desktop);
    await second.app.ready;
    expect(second.document.querySelector("#workspace-modal").hidden).toBe(true);
    expect(second.document.querySelector("#workspace-user-name").value).toBe("Marco");
    expect(second.document.querySelector("#workspace-export-path").value).toBe("C:/Grayfox exports");
    expect(second.document.querySelector("#minimum-minutes").value).toBe("20");
    expect(second.document.querySelector("#maximum-minutes").value).toBe("40");
    expect(second.document.querySelector("#final-use").value).toBe("YouTube");
    expect(second.document.querySelector("#direction").value).toContain("remove dead air");
    expect(second.app.state.tokens).toEqual(["Natural"]);
  });
  it("persists and removes a profile image", async () => {
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
    expect(desktop.saveWorkspace).toHaveBeenCalled();

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
    expect(speak.mock.calls[0][0].text).toContain("cut density, average shot length, silence trimming");
  });

  it("shows a clear fallback when voice is unavailable", () => {
    const { document } = setup();
    document.querySelector('[aria-label="Explain final use"]').click();
    document.querySelector("#speak-help").click();
    expect(document.querySelector("#toast").textContent).toContain("Voice guidance is not available");
  });
});

describe("Source preview duration integrity", () => {
  it("does not replace the source duration with the rendered first cut duration", () => {
    const { document, window, app } = setup();
    const preview = document.querySelector("#video-preview");
    app.loadVideo({ name: "Sequence_02.mp4", path: "D:/VODS/Sequence_02.mp4", url: "file:///D:/VODS/Sequence_02.mp4", duration: 4977.64 });
    Object.defineProperty(preview, "duration", { configurable: true, value: 4977.64 });
    preview.dispatchEvent(new window.Event("loadedmetadata"));
    expect(app.state.source.duration).toBeCloseTo(4977.64, 2);

    app.state.previewRepresentsSource = false;
    Object.defineProperty(preview, "duration", { configurable: true, value: 1800 });
    preview.dispatchEvent(new window.Event("loadedmetadata"));
    expect(app.state.source.duration).toBeCloseTo(4977.64, 2);
  });
});
describe("Mandatory direction audit gate", () => {
  it("refuses to render when removal instructions were not visually verified", async () => {
    const desktop = {
      chooseExportPath: vi.fn(),
      analyzeVideo: vi.fn().mockResolvedValue({
        directionRules: { mustRemove: ["remove the old episode"], mustKeep: [] },
        directionAuditCoverage: 0,
        directionAuditCount: 0,
        excludedRanges: [],
        candidates: [{ start: 0, end: 30, score: 50 }],
      }),
      produceVideo: vi.fn(),
      produceEditedVideo: vi.fn(),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    document.querySelector("#workspace-export-path").value = "C:/Exports";
    await app.createWorkspace();
    app.loadVideo({ name: "source.mp4", path: "C:/Videos/source.mp4", url: "file:///C:/Videos/source.mp4", duration: 5000 });
    document.querySelector("#direction").value = "Remove the old episode";
    setDurationRange(document, 1, 2);

    const result = await app.createFirstCut();

    expect(result).toBeNull();
    expect(desktop.produceVideo).not.toHaveBeenCalled();
    expect(desktop.produceEditedVideo).not.toHaveBeenCalled();
    expect(document.querySelector("#processing-title").textContent).toBe("First cut failed");
    expect(document.querySelector("#processing-curiosity").textContent).toContain("could not verify enough of the timeline");
  });
});
describe("Editable meme beats", () => {
  it("shows, moves, rerenders and gates approval for AI meme decisions", async () => {
    const desktop = {
      chooseExportPath: vi.fn(),
      saveWorkspace: vi.fn(async (workspace) => workspace),
      produceEditedVideo: vi.fn().mockResolvedValue({ outputPath: "C:/Exports/meme-revision.mp4", duration: 20, segmentCount: 2 }),
      restoreVideo: vi.fn().mockResolvedValue({ url: "file:///C:/Exports/meme-revision.mp4" }),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    document.querySelector("#workspace-export-path").value = "C:/Exports";
    await app.createWorkspace();
    app.loadVideo({ name: "source.mp4", path: "C:/Videos/source.mp4", url: "file:///C:/Videos/source.mp4", duration: 60 });
    app.state.firstCut = {
      outputPath: "C:/Exports/first.mp4",
      duration: 20,
      targetDuration: 20,
      approval: "pending",
      editPlan: {
        outputDuration: 20,
        segments: [
          { start: 10, end: 20, role: "hook", effect: "meme-punch", memeEnabled: true, memeStart: 12, memeEnd: 13.2, memeReason: "visible reaction" },
          { start: 30, end: 40, role: "close" },
        ],
      },
      analysis: { memeBeatCount: 1 },
    };
    app.renderMemeEditor();
    app.updateReviewPanel();

    expect(document.querySelector("#meme-editor").hidden).toBe(false);
    expect(document.querySelector("#meme-editor-count").textContent).toContain("1 inserted");
    document.querySelector('[data-meme-action="later"]').click();
    expect(app.state.firstCut.editPlan.segments[0].memeStart).toBe(13);
    expect(await app.approveFirstCut()).toBe(false);
    expect(document.querySelector("#toast").textContent).toContain("Apply or restore");

    const result = await app.applyMemeChanges();
    expect(result.outputPath).toBe("C:/Exports/meme-revision.mp4");
    expect(desktop.produceEditedVideo).toHaveBeenCalledWith(expect.objectContaining({
      segments: expect.arrayContaining([expect.objectContaining({ memeStart: 13, memeEnabled: true })]),
    }));
    expect(app.state.memeEditsDirty).toBe(false);
    expect(await app.approveFirstCut()).toBe(true);
  });

  it("searches the bilingual meme language and inserts a result at the playhead", () => {
    const { document, app } = setup();
    app.state.firstCut = {
      outputPath: "cut.mp4",
      duration: 20,
      approval: "pending",
      editPlan: { segments: [{ start: 10, end: 20, role: "hook" }, { start: 30, end: 40, role: "body" }] },
      analysis: { memeBeatCount: 0 },
    };
    Object.defineProperty(document.querySelector("#video-preview"), "currentTime", { configurable: true, value: 3 });
    app.renderMemeEditor();

    const results = app.searchMemeCatalog("momento imbarazzante e silenzio");
    expect(results[0].id).toBe("awkward-silence");
    app.renderMemeSearchResults(results);
    document.querySelector('[data-meme-result="awkward-silence"]').click();
    expect(app.state.firstCut.editPlan.segments[0]).toEqual(expect.objectContaining({
      effect: "meme-monochrome",
      memeEnabled: true,
      memeStart: 13,
      memeSuggested: false,
      memeId: "awkward-silence",
      memeLabel: "Awkward silence",
    }));
    expect(document.querySelector("#meme-beat-list").textContent).toContain("Awkward silence");
    expect(app.state.memeEditsDirty).toBe(true);
  });

  it("uses LM Studio only to rerank known overlays and keeps local fallback", async () => {
    const desktop = {
      searchMemes: vi.fn().mockResolvedValue({ provider: "lm-studio", results: [{ id: "big-reveal", reason: "Matches the reveal" }] }),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/?screen=video-ops", desktop);

    const results = await app.performMemeSearch("una rivelazione importante");

    expect(desktop.searchMemes).toHaveBeenCalledWith(expect.objectContaining({ query: "una rivelazione importante" }));
    expect(results[0].id).toBe("big-reveal");
    expect(document.querySelector("[data-meme-result]").dataset.memeResult).toBe("big-reveal");
    expect(document.querySelector("#meme-search-status").textContent).toContain("LM Studio semantic order");
  });
  it("renders a manual meme on a one-segment cut", async () => {
    const desktop = {
      chooseExportPath: vi.fn(),
      saveWorkspace: vi.fn(async (workspace) => workspace),
      produceEditedVideo: vi.fn().mockResolvedValue({ outputPath: "C:/Exports/one-segment-meme.mp4", duration: 8, segmentCount: 1 }),
      restoreVideo: vi.fn().mockResolvedValue({ url: "file:///C:/Exports/one-segment-meme.mp4" }),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    await app.ready;
    document.querySelector("#workspace-user-name").value = "Marco";
    document.querySelector("#workspace-export-path").value = "C:/Exports";
    await app.createWorkspace();
    app.loadVideo({ name: "source.mp4", path: "C:/Videos/source.mp4", url: "file:///C:/Videos/source.mp4", duration: 30 });
    app.state.firstCut = { outputPath: "C:/Exports/first.mp4", duration: 8, targetDuration: 8, approval: "pending", editPlan: { outputDuration: 8, segments: [{ start: 5, end: 13, role: "hook" }] } };
    Object.defineProperty(document.querySelector("#video-preview"), "currentTime", { configurable: true, value: 2 });
    expect(app.addMemePreset("flash")).toBe(true);

    const result = await app.applyMemeChanges();

    expect(result.outputPath).toBe("C:/Exports/one-segment-meme.mp4");
    expect(desktop.produceEditedVideo).toHaveBeenCalledWith(expect.objectContaining({ segments: [expect.objectContaining({ effect: "meme-flash" })] }));
  });
  it("can remove and restore a suggested meme without deleting its position", () => {
    const { document, app } = setup();
    app.state.firstCut = {
      outputPath: "cut.mp4",
      duration: 10,
      approval: "pending",
      editPlan: { segments: [{ start: 1, end: 9, effect: "meme-punch", memeEnabled: true, memeStart: 3, memeEnd: 4.2 }] },
      analysis: { memeBeatCount: 1 },
    };
    app.renderMemeEditor();
    document.querySelector('[data-meme-action="toggle"]').click();
    expect(app.state.firstCut.editPlan.segments[0]).toEqual(expect.objectContaining({ memeEnabled: false, memeStart: 3 }));
    document.querySelector('[data-meme-action="toggle"]').click();
    expect(app.state.firstCut.editPlan.segments[0].memeEnabled).toBe(true);
  });
});
describe("Persisted meme review", () => {
  it("restores meme positions, approval state and rendered preview with the project", async () => {
    const desktop = {
      restoreVideo: vi.fn(async (filePath) => ({ url: filePath.includes("approved") ? "file:///C:/Exports/approved.mp4" : "file:///C:/Videos/source.mp4" })),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    const project = {
      id: "persisted-memes",
      name: "Persisted memes",
      status: "Approved",
      view: "video-ops",
      source: { name: "source.mp4", path: "C:/Videos/source.mp4", duration: 120 },
      editor: { finalUse: "YouTube", targetMinutes: 1, direction: "Keep the story", tokens: ["Direct"] },
      editReview: {
        outputPath: "C:/Exports/approved.mp4",
        duration: 60,
        targetDuration: 60,
        approval: "approved",
        approvedAt: "2026-08-02T20:00:00.000Z",
        segments: [
          { start: 0, end: 30, role: "hook", effect: "meme-punch", memeEnabled: true, memeStart: 5.5, memeEnd: 6.7 },
          { start: 60, end: 90, role: "close" },
        ],
      },
    };

    await app.restoreProject(project);

    expect(app.state.firstCut.approval).toBe("approved");
    expect(document.querySelector("#minimum-minutes").value).toBe("1");
    expect(document.querySelector("#maximum-minutes").value).toBe("1");
    expect(app.state.firstCut.editPlan.segments[0]).toEqual(expect.objectContaining({ memeStart: 5.5, memeEnabled: true }));
    expect(document.querySelector("#video-preview").src).toBe("file:///C:/Exports/approved.mp4");
    expect(document.querySelector("#meme-editor").hidden).toBe(false);
    expect(document.querySelector("#review-status").textContent).toBe("Approved");
  });

  it("marks a saved cut stale when its duration cannot match the restored brief", async () => {
    const desktop = {
      restoreVideo: vi.fn(async (filePath) => ({ url: `file:///${filePath.replace(/\\/g, "/")}` })),
      onProductionProgress: vi.fn(() => vi.fn()),
    };
    const { document, app } = setup("https://grayfox.local/", desktop);
    const project = {
      id: "legacy-short-cut",
      name: "Long story",
      status: "Approved",
      view: "video-ops",
      source: { name: "source.mp4", path: "C:/Videos/source.mp4", duration: 4685 },
      editor: { finalUse: "YouTube", minimumMinutes: 10, maximumMinutes: 30, direction: "Keep the story", tokens: ["Direct"] },
      editReview: { outputPath: "C:/Exports/old.mp4", duration: 6, targetDuration: 1800, approval: "approved", segments: [] },
    };

    await app.restoreProject(project);

    expect(app.state.firstCutStale).toBe(true);
    expect(app.state.firstCut.approval).toBe("pending");
    expect(document.querySelector("#processing-title").textContent).toBe("Changes not rendered");
    expect(document.querySelector("#processing-curiosity").textContent).toContain("does not match the current brief or duration window");
    expect(document.querySelector("#create-cut").textContent).toContain("Render updated cut");
  });
});
