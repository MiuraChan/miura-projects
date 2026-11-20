(function installPublicDemo(global) {
  "use strict";
  if (global.grayfoxDesktop?.environment !== "web" || !global.GrayfoxApp) return;
  const app = global.GrayfoxApp, doc = global.document;
  async function startGuest() {
    await app.ready;
    if (!doc.querySelector("#workspace-modal").hidden) {
      doc.querySelector("#workspace-user-name").value ||= "Guest";
      doc.querySelector("#workspace-export-path").value = "Browser Downloads";
      await app.createWorkspace();
    }
  }
  async function loadSample() {
    const buttons = [...doc.querySelectorAll("[data-load-sample]")];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      await startGuest();
      const response = await global.fetch("./sample.mp4");
      if (!response.ok) throw new Error("The demo video could not be loaded. You can still choose your own video.");
      const file = new global.File([await response.blob()], "grayfox-demo.mp4", { type: "video/mp4" });
      const preview = doc.querySelector("#video-preview");
      const loaded = new Promise((resolve, reject) => {
        const timer = global.setTimeout(() => reject(new Error("Demo video decoding timed out. Try Chrome or Edge.")), 15000);
        preview.addEventListener("loadeddata", () => { global.clearTimeout(timer); resolve(); }, { once: true });
        preview.addEventListener("error", () => { global.clearTimeout(timer); reject(new Error("This browser cannot decode the demo video.")); }, { once: true });
      });
      doc.querySelector("#short-length").value = "15–30 seconds";
      app.loadVideo(file);
      await loaded;
      app.showToast("Demo video ready. Export a vertical clip or try Video Ops. Nothing was uploaded.");
    } catch (error) { app.showToast(error.message); }
    finally { buttons.forEach((button) => { button.disabled = false; }); }
  }
  async function initialize() {
    await app.ready;
    const toolbar = doc.createElement("div");
    toolbar.className = "public-demo-toolbar";
    toolbar.innerHTML = '<a href="/">← Mediakit</a><p>Local video editing · WebM exports up to 60 seconds · Keep this tab visible while exporting</p><button type="button" class="secondary-button compact-button" data-load-sample>Try sample video</button>';
    doc.querySelector(".topbar").after(toolbar);
    doc.querySelector("#web-demo-banner span").textContent = "Real browser editing. AI event detection and native integrations run on desktop.";
    const modal = doc.querySelector(".workspace-modal-card");
    modal.querySelector(".eyebrow").textContent = "BROWSER DEMO";
    modal.querySelector(".modal-intro").textContent = "Try a sample or choose your own video. No account needed, and your video stays on your device.";
    doc.querySelector("#workspace-user-name").value ||= "Guest";
    doc.querySelector("#workspace-export-path").value = "Browser Downloads";
    doc.querySelector("#choose-export-path").hidden = true;
    modal.querySelector(".modal-privacy").textContent = "Your settings stay in this browser. Video files are processed on your device and are not uploaded. Exports go to your browser downloads.";
    const sampleButton = doc.createElement("button");
    sampleButton.id = "start-web-sample"; sampleButton.type = "button";
    sampleButton.className = "secondary-button full public-sample-button";
    sampleButton.textContent = "Start with a sample video";
    sampleButton.setAttribute("data-load-sample", "");
    doc.querySelector("#create-workspace").after(sampleButton);
    for (const id of ["direction", "short-direction"]) {
      const input = doc.getElementById(id);
      input.value = ""; input.disabled = true;
      input.placeholder = "AI content instructions are not available in this browser demo. Try real cuts, framing and exports instead.";
    }
    const tone = doc.querySelector("#short-tone-token");
    tone.value = ""; tone.disabled = true; tone.placeholder = "AI clip ranking is a desktop feature.";
    doc.querySelector("#shorts .eyebrow").textContent = "VERTICAL CLIP PREVIEW";
    doc.querySelector("#shorts .shorts-intro > h2").textContent = "Create vertical clips.";
    doc.querySelector("#shorts .shorts-intro > p").textContent = "Load a video and try vertical framing and real exports. These preview ranges use time positions; AI event selection is a desktop feature.";
    doc.querySelector("#shorts .candidate-header .eyebrow").textContent = "TIME-BASED PREVIEWS";
    doc.querySelector("#shorts .candidate-header h3").textContent = "Review ranges";
    doc.querySelector("#shorts .score-key").textContent = "Range";
    const help = {
      "Clip directions": "AI content recognition, dialogue understanding and death detection are desktop features. The web demo creates actual cuts using duration and timeline positions; it does not claim to understand the content.",
      "Best moments": "Choose a video and a target length. This browser demo saves real time-based preview ranges as vertical WebM files. It does not rank moments using AI.",
      "Platform": "TikTok, Reels and Shorts all use the 1080 × 1920 vertical output in this demo. Captions and direct social publishing are not provided here.",
      "Story clip tone": "AI content ranking is not available in the browser. Tone tags in Video Ops change the pacing of its rule-based preview edit.",
    };
    for (const button of doc.querySelectorAll("[data-help-title]")) if (help[button.dataset.helpTitle]) button.dataset.help = help[button.dataset.helpTitle];
    doc.querySelector("#story-selection-status").textContent = "Demo clips use timeline position, not AI event detection. Each export is a real video file.";
    doc.querySelectorAll("[data-load-sample]").forEach((button) => button.addEventListener("click", loadSample));
    app.updateBrief();
    // Public-facing name only. Keep internal storage keys and API identifiers stable.
    const brand = doc.querySelector(".brand > span:not(.brand-signal)");
    if (brand) brand.textContent = "GRAY FOX";
    return true;
  }
  const ready = initialize();
  global.GrayfoxWebDemo = Object.freeze({ ready, loadSample, startGuest });
})(window);
