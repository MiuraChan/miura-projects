function createGrayfoxApp(doc, win) {
  const desktop = win.grayfoxDesktop || null;
  const curiosities = [
    "Cuts feel faster when motion continues naturally across an edit.",
    "A strong hook usually earns attention in the first three seconds.",
    "Two short caption lines are easier to read than one crowded line.",
    "Removing a pause works best when the speaker’s expression still flows.",
  ];
  const state = {
    file: null,
    source: null,
    tokens: [],
    activeView: "shorts",
    workspace: null,
    projectId: `project-${Date.now()}`,
    projectName: "Untitled edit",
    profileImage: null,
    projectStatus: "Draft",
    lastExportPath: null,
    autosaveTimer: null,
    processing: null,
    analysis: null,
    firstCut: null,
    revisionFeedback: "",
    transcript: null,
    projectThumbnail: null,
    thumbnailCaptureHandler: null,
    previewRepresentsSource: false,
    memeEditsDirty: false,
    memeSearchResults: [],
    firstCutStale: false,
    reviewCutEnd: null,
  };

  const urlParams = new win.URLSearchParams(win.location.search);
  const initialView = urlParams.get("screen") === "video-ops" ? "video-ops" : "shorts";
  if (urlParams.get("mobile") === "1") doc.body.classList.add("mobile-capture");

  const elements = {
    input: doc.querySelector("#video-input"),
    choose: doc.querySelector("#empty-state"),
    stage: doc.querySelector("#video-stage"),
    preview: doc.querySelector("#video-preview"),
    empty: doc.querySelector("#empty-state"),
    toneInput: doc.querySelector("#tone-token"),
    tokenList: doc.querySelector("#token-list"),
    toneTokenCount: doc.querySelector("#tone-token-count"),
    direction: doc.querySelector("#direction"),
    finalUse: doc.querySelector("#final-use"),
    minimumMinutes: doc.querySelector("#minimum-minutes"),
    maximumMinutes: doc.querySelector("#maximum-minutes"),
    durationRangeHelp: doc.querySelector("#duration-range-help"),
    brief: doc.querySelector("#brief-copy"),
    toast: doc.querySelector("#toast"),
    projectName: doc.querySelector("#project-name"),
    recentProjects: doc.querySelector("#recent-projects"),
    workspaceModal: doc.querySelector("#workspace-modal"),
    workspaceUserName: doc.querySelector("#workspace-user-name"),
    workspaceExportPath: doc.querySelector("#workspace-export-path"),
    chooseExportPathButton: doc.querySelector("#choose-export-path"),
    browserFolderHelp: doc.querySelector("#browser-folder-help"),
    workspaceError: doc.querySelector("#workspace-error"),
    workspaceName: doc.querySelector("#workspace-name"),
    workspaceLocation: doc.querySelector("#workspace-location"),
    workspaceAvatar: doc.querySelector("#workspace-avatar"),
    workspaceAvatarImage: doc.querySelector("#workspace-avatar-image"),
    workspaceAvatarInitials: doc.querySelector("#workspace-avatar-initials"),
    profileImagePreview: doc.querySelector("#profile-image-preview"),
    profileImagePreviewImage: doc.querySelector("#profile-image-preview-image"),
    profilePreviewInitials: doc.querySelector("#profile-preview-initials"),
    profileImageInput: doc.querySelector("#profile-image-input"),
    chooseProfileImage: doc.querySelector("#choose-profile-image"),
    removeProfileImage: doc.querySelector("#remove-profile-image"),
    profileImageStatus: doc.querySelector("#profile-image-status"),
    selectedExportPath: doc.querySelector("#selected-export-path"),
    workspaceClose: doc.querySelector("#workspace-close"),
    createWorkspaceButton: doc.querySelector("#create-workspace"),
    createCut: doc.querySelector("#create-cut"),
    processingPanel: doc.querySelector("#processing-panel"),
    processingTitle: doc.querySelector("#processing-title"),
    processingEta: doc.querySelector("#processing-eta"),
    processingBar: doc.querySelector("#processing-bar"),
    processingCuriosity: doc.querySelector("#processing-curiosity"),
    editPlanSummary: doc.querySelector("#edit-plan-summary"),
    memeEditor: doc.querySelector("#meme-editor"),
    memeBeatList: doc.querySelector("#meme-beat-list"),
    memeEditorCount: doc.querySelector("#meme-editor-count"),
    applyMemeEdits: doc.querySelector("#apply-meme-edits"),
    memeSearchForm: doc.querySelector("#meme-search-form"),
    memeSearchInput: doc.querySelector("#meme-search-input"),
    memeSearchButton: doc.querySelector("#meme-search-button"),
    memeSearchResults: doc.querySelector("#meme-search-results"),
    memeSearchStatus: doc.querySelector("#meme-search-status"),
    replaceVideo: doc.querySelector("#replace-video"),
    trimStart: doc.querySelector("#trim-start"),
    trimEnd: doc.querySelector("#trim-end"),
    shortLength: doc.querySelector("#short-length"),
    shortTone: doc.querySelector("#short-tone-token"),
    productionStatus: doc.querySelector("#production-status"),
    productionTitle: doc.querySelector("#production-title"),
    productionPercent: doc.querySelector("#production-percent"),
    productionBar: doc.querySelector("#production-bar"),
    productionCopy: doc.querySelector("#production-copy"),
    exportButton: doc.querySelector("#export-button"),
    reviewPanel: doc.querySelector("#review-panel"),
    reviewStatus: doc.querySelector("#review-status"),
    reviewSummary: doc.querySelector("#review-summary"),
    cutCount: doc.querySelector("#cut-count"),
    approveCut: doc.querySelector("#approve-cut"),
    requestChanges: doc.querySelector("#request-changes"),
    revisionBox: doc.querySelector("#revision-box"),
    revisionNotes: doc.querySelector("#revision-notes"),
    renderRevision: doc.querySelector("#render-revision"),
    handoffPanel: doc.querySelector("#handoff-panel"),
    handoffSecondary: doc.querySelector("#handoff-secondary"),
    toggleHandoffOptions: doc.querySelector("#toggle-handoff-options"),
    handoffTarget: doc.querySelector("#handoff-target"),
    createHandoff: doc.querySelector("#create-handoff"),
    handoffStatus: doc.querySelector("#handoff-status"),
    cutReviewList: doc.querySelector("#cut-review-list"),
    exportFormat: doc.querySelector("#export-format"),
    saveApprovedFormat: doc.querySelector("#save-approved-format"),
    formatExportStatus: doc.querySelector("#format-export-status"),
    helpPopover: doc.querySelector("#help-popover"),
    helpTitle: doc.querySelector("#help-title"),
    helpCopy: doc.querySelector("#help-copy"),
    chooseTranscript: doc.querySelector("#choose-transcript"),
    dialogueSourceStatus: doc.querySelector("#dialogue-source-status"),
  };

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    win.clearTimeout(showToast.timer);
    showToast.timer = win.setTimeout(() => elements.toast.classList.remove("show"), 2300);
  }

  function getInitials(name) {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "GF";
  }

  function showExportPath(folderPath) {
    const value = String(folderPath || "").trim();
    elements.workspaceExportPath.title = value;
    elements.selectedExportPath.textContent = value;
    elements.selectedExportPath.hidden = !value;
    if (value) {
      elements.workspaceLocation.textContent = value;
      elements.workspaceLocation.title = value;
    }
  }

  function normalizeProfileImage(value) {
    return typeof value === "string"
      && /^data:image\/(png|jpeg|webp);base64,/i.test(value)
      && value.length <= 3000000
      ? value
      : null;
  }

  const workspaceStorageKey = "grayfox.workspace.v3";

  async function readBrowserWorkspace() {
    try {
      const saved = win.localStorage?.getItem(workspaceStorageKey);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }

  async function persistWorkspace() {
    if (!state.workspace) return null;
    if (desktop?.saveWorkspace) return desktop.saveWorkspace(state.workspace);
    try {
      win.localStorage?.setItem(workspaceStorageKey, JSON.stringify(state.workspace));
    } catch { /* File previews can have an opaque origin. */ }
    return state.workspace;
  }

  function renderRecentProjects() {
    elements.recentProjects.innerHTML = "";
    const projects = state.workspace?.projects || [];
    if (!projects.length) {
      const empty = doc.createElement("p");
      empty.className = "recent-empty";
      empty.textContent = "Your saved work will appear here.";
      elements.recentProjects.appendChild(empty);
      return;
    }

    projects
      .slice()
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 5)
      .forEach((project, index) => {
        const button = doc.createElement("button");
        button.className = "recent-item";
        button.type = "button";
        const thumb = doc.createElement("span");
        thumb.className = "recent-thumb";
        if (/^data:image\/jpeg;base64,/i.test(project.thumbnail || "")) {
          const image = doc.createElement("img");
          image.src = project.thumbnail;
          image.alt = "";
          thumb.appendChild(image);
        } else {
          const signal = doc.createElement("span");
          signal.className = "recent-placeholder-signal";
          signal.setAttribute("aria-hidden", "true");
          thumb.appendChild(signal);
        }
        const copy = doc.createElement("span");
        const title = doc.createElement("strong");
        title.textContent = project.name;
        const status = doc.createElement("small");
        status.textContent = project.status || "Draft";
        copy.append(title, status);
        button.append(thumb, copy);
        button.addEventListener("click", async () => {
          await restoreProject(project);
          showToast(`Opened “${project.name}” with its saved settings.`);
        });
        elements.recentProjects.appendChild(button);
      });
  }

  function applyWorkspace(workspace) {
    state.workspace = {
      userName: workspace.userName.trim(),
      exportPath: workspace.exportPath.trim(),
      profileImage: normalizeProfileImage(workspace.profileImage),
      currentProjectId: workspace.currentProjectId || state.projectId,
      projects: Array.isArray(workspace.projects) ? workspace.projects.map((project) => ({
        ...project,
        source: project.source || (project.sourceName ? { name: project.sourceName, path: null, size: 0, lastModified: 0, duration: 0 } : null),
        editor: (() => {
          const editor = project.editor || { finalUse: "Website / landing page", direction: "", tokens: [] };
          const legacyTarget = Math.max(0, Number(editor.targetMinutes) || 0);
          return {
            ...editor,
            minimumMinutes: Math.max(0, Number(editor.minimumMinutes) || legacyTarget),
            maximumMinutes: Math.max(0, Number(editor.maximumMinutes) || legacyTarget),
          };
        })(),
        shorts: project.shorts || { length: "30–45 seconds", platform: "TikTok", tone: "" },
        trim: project.trim || { start: 0, end: 0 },
      })) : [],
    };
    state.profileImage = state.workspace.profileImage;
    elements.workspaceUserName.value = state.workspace.userName;
    elements.workspaceExportPath.value = state.workspace.exportPath;
    elements.workspaceName.textContent = `${state.workspace.userName}'s workspace`;
    showExportPath(state.workspace.exportPath);
    const initials = getInitials(state.workspace.userName);
    elements.workspaceAvatarInitials.textContent = initials;
    elements.profilePreviewInitials.textContent = initials;
    renderProfileImage();
    elements.workspaceClose.hidden = false;
    elements.workspaceModal.hidden = true;
    renderRecentProjects();
  }

  async function initializeWorkspace() {
    if (!desktop) {
      elements.workspaceExportPath.readOnly = true;
      elements.workspaceExportPath.placeholder = "Browser Downloads (test mode)";
      elements.chooseExportPathButton.textContent = "Use browser Downloads";
      elements.browserFolderHelp.textContent = "Browser test: no Windows address is needed. Exports use your browser Downloads; open Grayfox desktop to choose a real folder.";
      elements.browserFolderHelp.hidden = false;
      // Never leave the file preview blank while a browser storage API is pending.
      elements.workspaceModal.hidden = false;
    }
    let savedWorkspace = null;
    try {
      savedWorkspace = desktop?.loadWorkspace ? await desktop.loadWorkspace() : await readBrowserWorkspace();
    } catch { /* Invalid or unavailable saved settings fall back to onboarding. */ }
    if (savedWorkspace?.userName && savedWorkspace?.exportPath) {
      applyWorkspace(savedWorkspace);
      const currentProject = state.workspace.projects.find((project) => project.id === state.workspace.currentProjectId) || state.workspace.projects[0];
      if (currentProject) await restoreProject(currentProject);
      activateView(initialView);
      showToast(`Welcome back, ${state.workspace.userName}. Your production settings are ready.`);
      return savedWorkspace;
    }
    elements.workspaceModal.hidden = false;
    return null;
  }

  async function chooseExportPath() {
    elements.workspaceError.textContent = "";
    if (desktop && typeof desktop.chooseExportPath === "function") {
      const selectedPath = await desktop.chooseExportPath();
      if (selectedPath) {
        elements.workspaceExportPath.value = selectedPath;
        showExportPath(selectedPath);
      }
      return selectedPath;
    }

    const browserTarget = "Browser Downloads (test mode)";
    elements.workspaceExportPath.value = browserTarget;
    showExportPath(browserTarget);
    elements.workspaceError.textContent = "";
    showToast("Browser test folder ready. No address required.");
    return browserTarget;
  }

  function renderProfileImage() {
    const image = normalizeProfileImage(state.profileImage);
    [
      [elements.workspaceAvatar, elements.workspaceAvatarImage],
      [elements.profileImagePreview, elements.profileImagePreviewImage],
    ].forEach(([container, imageElement]) => {
      container.classList.toggle("has-image", Boolean(image));
      imageElement.hidden = !image;
      if (image) imageElement.src = image;
      else imageElement.removeAttribute("src");
    });
    elements.removeProfileImage.hidden = !image;
  }

  function setProfileImageStatus(message, isError = false) {
    elements.profileImageStatus.textContent = message;
    elements.profileImageStatus.classList.toggle("error", isError);
  }

  async function setProfileImage(dataUrl) {
    const image = normalizeProfileImage(dataUrl);
    if (dataUrl && !image) {
      const message = "Image not approved. Use a JPG, PNG, or WebP file up to 2 MB.";
      setProfileImageStatus(message, true);
      showToast(message);
      return false;
    }
    state.profileImage = image;
    renderProfileImage();
    if (state.workspace) {
      state.workspace.profileImage = image;
      await persistWorkspace();
    }
    const message = image ? "Profile image approved and ready." : "Profile image removed.";
    setProfileImageStatus(message);
    showToast(message);
    return true;
  }

  elements.chooseProfileImage.addEventListener("click", () => elements.profileImageInput.click());
  elements.profileImageInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
      const message = `“${file.name}” was not approved. Use JPG, PNG, or WebP.`;
      setProfileImageStatus(message, true);
      showToast(message);
      event.target.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      const size = (file.size / (1024 * 1024)).toFixed(1);
      const message = `“${file.name}” was not approved (${size} MB). Maximum size is 2 MB.`;
      setProfileImageStatus(message, true);
      showToast(message);
      event.target.value = "";
      return;
    }
    setProfileImageStatus(`Checking “${file.name}”…`);
    const reader = new win.FileReader();
    reader.onload = () => {
      const image = new win.Image();
      image.onload = async () => {
        await setProfileImage(reader.result);
        event.target.value = "";
      };
      image.onerror = () => {
        const message = `“${file.name}” was not approved because the image could not be decoded.`;
        setProfileImageStatus(message, true);
        showToast(message);
        event.target.value = "";
      };
      image.src = reader.result;
    };
    reader.onerror = () => {
      const message = `“${file.name}” was not approved because Grayfox could not read the file.`;
      setProfileImageStatus(message, true);
      showToast(message);
      event.target.value = "";
    };
    reader.readAsDataURL(file);
  });
  elements.removeProfileImage.addEventListener("click", () => setProfileImage(null));

  async function createWorkspace() {
    const userName = elements.workspaceUserName.value.trim();
    const exportPath = elements.workspaceExportPath.value.trim();
    if (!userName || !exportPath) {
      elements.workspaceError.textContent = desktop
        ? "Add your name and choose an export folder."
        : "Add your name and confirm the browser test folder.";
      return false;
    }
    const previousProjects = state.workspace?.projects || [];
    elements.createWorkspaceButton.disabled = true;
    elements.createWorkspaceButton.textContent = "Starting session…";
    applyWorkspace({ userName, exportPath, profileImage: state.profileImage, currentProjectId: state.projectId, projects: previousProjects });
    try {
      await persistWorkspace();
      showToast("Workspace ready. Your name, folder and production options will be remembered on this PC.");
      return true;
    } catch (error) {
      elements.workspaceModal.hidden = false;
      elements.workspaceError.textContent = error?.message || "Grayfox could not save this workspace.";
      return false;
    } finally {
      elements.createWorkspaceButton.disabled = false;
      elements.createWorkspaceButton.textContent = "Start session";
    }
  }

  function selectedPlatform() {
    return doc.querySelector(".segmented button.active")?.textContent || "TikTok";
  }

  async function saveProject(status) {
    if (!state.workspace) return null;
    if (status) state.projectStatus = status;
    const project = {
      id: state.projectId,
      name: state.projectName,
      status: state.projectStatus,
      view: state.activeView,
      exportPath: state.workspace.exportPath,
      source: state.source ? { ...state.source } : null,
      editor: {
        finalUse: elements.finalUse.value,
        minimumMinutes: Math.max(0, Number(elements.minimumMinutes.value) || 0),
        maximumMinutes: Math.max(0, Number(elements.maximumMinutes.value) || 0),
        direction: elements.direction.value,
        tokens: [...state.tokens],
      },
      shorts: {
        length: elements.shortLength.value,
        platform: selectedPlatform(),
        tone: elements.shortTone.value,
      },
      trim: {
        start: Math.max(0, Number(elements.trimStart.value) || 0),
        end: Math.max(0, Number(elements.trimEnd.value) || 0),
      },
      editReview: state.firstCut?.outputPath ? {
        outputPath: state.firstCut.outputPath,
        duration: Number(state.firstCut.duration) || 0,
        targetDuration: Number(state.firstCut.targetDuration) || 0,
        minimumDuration: Number(state.firstCut.minimumDuration) || 0,
        maximumDuration: Number(state.firstCut.maximumDuration) || 0,
        approval: state.firstCut.approval || "pending",
        approvedAt: state.firstCut.approvedAt || null,
        briefSignature: state.firstCut.renderedBriefSignature || null,
        toneProfile: state.firstCut.editPlan?.toneProfile || state.firstCut.analysis?.toneProfile || null,
        segments: (state.firstCut.editPlan?.segments || state.firstCut.segments || []).map((segment) => ({ ...segment })),
      } : null,
      lastExportPath: state.lastExportPath,
      thumbnail: state.projectThumbnail,
      updatedAt: new Date().toISOString(),
    };
    state.workspace.currentProjectId = project.id;
    const index = state.workspace.projects.findIndex((item) => item.id === project.id);
    if (index >= 0) state.workspace.projects[index] = project;
    else state.workspace.projects.push(project);
    renderRecentProjects();
    await persistWorkspace();
    return project;
  }

  function scheduleSave() {
    win.clearTimeout(state.autosaveTimer);
    state.autosaveTimer = win.setTimeout(() => saveProject(), 250);
  }

  async function restoreProject(project) {
    let recoveredLegacySource = false;
    state.projectId = project.id;
    state.projectName = project.name || "Untitled edit";
    state.projectStatus = project.status || "Draft";
    state.lastExportPath = project.lastExportPath || null;
    state.projectThumbnail = /^data:image\/jpeg;base64,/i.test(project.thumbnail || "") ? project.thumbnail : null;
    state.tokens = Array.isArray(project.editor?.tokens) ? [...project.editor.tokens] : [];
    elements.projectName.value = state.projectName;
    elements.finalUse.value = project.editor?.finalUse || "Website / landing page";
    const legacyTargetMinutes = Math.max(0, Number(project.editor?.targetMinutes) || 0);
    const savedMinimumMinutes = Math.max(0, Number(project.editor?.minimumMinutes) || legacyTargetMinutes);
    const savedMaximumMinutes = Math.max(0, Number(project.editor?.maximumMinutes) || legacyTargetMinutes);
    elements.minimumMinutes.value = savedMinimumMinutes || "";
    elements.maximumMinutes.value = savedMaximumMinutes || "";
    elements.direction.value = project.editor?.direction || "";
    elements.shortLength.value = project.shorts?.length || "30–45 seconds";
    elements.shortTone.value = project.shorts?.tone || "";
    elements.trimStart.value = project.trim?.start || 0;
    elements.trimEnd.value = project.trim?.end || "";
    doc.querySelectorAll(".segmented button").forEach((button) => button.classList.toggle("active", button.textContent === (project.shorts?.platform || "TikTok")));
    renderTokens();
    state.source = project.source || null;
    state.file = state.source;
    if (state.source?.path && desktop?.restoreVideo) {
      const restored = await desktop.restoreVideo(state.source.path);
      if (restored) loadVideo({ ...state.source, ...restored }, { persist: false, notify: false });
      else showToast(`Reconnect “${state.source.name}”; the saved file moved.`);
    } else if (state.source?.name) {
      const recovered = desktop?.findRememberedVideo
        ? await desktop.findRememberedVideo({ name: state.source.name, exportPath: project.exportPath || state.workspace?.exportPath })
        : null;
      if (recovered?.path) {
        recoveredLegacySource = true;
        loadVideo({ ...state.source, ...recovered }, { persist: false, notify: false });
      } else {
        elements.empty.querySelector("h2").textContent = `Reconnect ${state.source.name}`;
        elements.empty.querySelector("p").textContent = "The project data is safe; choose Replace video to reconnect the local source.";
      }
    }
    if (project.editReview?.outputPath) {
      const segments = Array.isArray(project.editReview.segments) ? project.editReview.segments.map((segment) => ({ ...segment })) : [];
      state.firstCut = {
        ...project.editReview,
        renderedBriefSignature: project.editReview.briefSignature || null,
        editPlan: { segments, outputDuration: Number(project.editReview.duration) || 0, toneProfile: project.editReview.toneProfile || null },
        analysis: {
          memeBeatCount: segments.filter((segment) => Object.values(memePresets).some((preset) => preset.effect === segment.effect) && segment.memeEnabled !== false).length,
          toneProfile: project.editReview.toneProfile || null,
        },
      };
      state.memeEditsDirty = false;
      state.firstCutStale = (Boolean(state.firstCut.renderedBriefSignature) && state.firstCut.renderedBriefSignature !== currentBriefSignature())
        || cutViolatesCurrentDuration(state.firstCut);
      if (desktop?.restoreVideo) {
        const restoredCut = await desktop.restoreVideo(project.editReview.outputPath);
        if (restoredCut?.url) {
          state.previewRepresentsSource = false;
          elements.preview.src = restoredCut.url;
        }
      }
      renderMemeEditor();
      updateReviewPanel();
      if (state.firstCutStale) showStaleCutState("The saved cut does not match the current brief or duration window.", { notify: false });
    }
    activateView(project.view || "shorts");
    updateBrief();
    if (recoveredLegacySource) {
      await saveProject(state.projectStatus);
      showToast(`Reconnected ${state.source.name} and restored its preview.`);
    }
  }

  doc.querySelector("#choose-export-path").addEventListener("click", chooseExportPath);
  doc.querySelector("#create-workspace").addEventListener("click", createWorkspace);
  doc.querySelector("#workspace-settings").addEventListener("click", () => { elements.workspaceError.textContent = ""; elements.workspaceModal.hidden = false; });
  elements.workspaceClose.addEventListener("click", () => { if (state.workspace) elements.workspaceModal.hidden = true; });

  elements.projectName.addEventListener("input", () => { state.projectName = elements.projectName.value.trim() || "Untitled edit"; scheduleSave(); });
  elements.projectName.addEventListener("change", () => { elements.projectName.value = state.projectName; saveProject(); showToast(`Project renamed to “${state.projectName}”.`); });

  function loadVideo(file, options = {}) {
    const descriptor = file && typeof file === "object" && (file.path || file.url);
    if (!file || (!descriptor && !file.type?.startsWith("video/"))) {
      showToast("Please choose a valid video file.");
      return false;
    }
    if (elements.preview.src?.startsWith("blob:") && win.URL.revokeObjectURL) win.URL.revokeObjectURL(elements.preview.src);
    state.file = file;
    state.transcript = null;
    state.projectThumbnail = null;
    state.firstCut = null;
    state.firstCutStale = false;
    state.memeEditsDirty = false;
    if (elements.memeEditor) elements.memeEditor.hidden = true;
    if (elements.dialogueSourceStatus) elements.dialogueSourceStatus.textContent = "Auto-detect embedded or matching .srt/.vtt";
    state.source = {
      name: file.name || "Video",
      path: file.path || null,
      size: Number(file.size) || 0,
      lastModified: Number(file.lastModified) || 0,
      duration: Number(file.duration) || 0,
    };
    if (state.thumbnailCaptureHandler) elements.preview.removeEventListener("loadeddata", state.thumbnailCaptureHandler);
    state.thumbnailCaptureHandler = async () => {
      state.thumbnailCaptureHandler = null;
      const thumbnail = captureProjectThumbnail();
      if (!thumbnail) return;
      state.projectThumbnail = thumbnail;
      await saveProject("Source ready");
    };
    elements.preview.addEventListener("loadeddata", state.thumbnailCaptureHandler, { once: true });
    state.previewRepresentsSource = true;
    elements.preview.src = file.url || (win.URL.createObjectURL ? win.URL.createObjectURL(file) : `grayfox-file://${encodeURIComponent(file.name)}`);
    elements.preview.style.display = "block";
    elements.empty.style.display = "none";
    elements.replaceVideo.hidden = false;
    updateBrief();
    if (options.persist !== false) saveProject("Source ready");
    if (options.notify !== false) showToast(`${state.source.name} is ready and saved to this project.`);
    return true;
  }

  elements.preview.addEventListener("error", () => {
    const label = state.previewRepresentsSource ? (state.source?.name || "source video") : "rendered cut";
    elements.empty.querySelector("h2").textContent = `Preview unavailable for ${label}`;
    elements.empty.querySelector("p").textContent = state.previewRepresentsSource
      ? "The file may have moved or use a codec Chromium cannot play. Choose Replace video to reconnect it."
      : "The rendered file may have moved. Render the cut again to create a new preview.";
    elements.preview.style.display = "none";
    elements.empty.style.display = "grid";
    showToast(`Preview unavailable for ${label}. The project data is still safe.`);
  });

  function captureProjectThumbnail() {
    const sourceWidth = Number(elements.preview.videoWidth) || 0;
    const sourceHeight = Number(elements.preview.videoHeight) || 0;
    if (!sourceWidth || !sourceHeight) return null;
    try {
      const canvas = doc.createElement("canvas");
      canvas.width = 160;
      canvas.height = 90;
      const context = canvas.getContext("2d");
      if (!context) return null;
      const scale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);
      const cropWidth = canvas.width / scale;
      const cropHeight = canvas.height / scale;
      context.drawImage(elements.preview, (sourceWidth - cropWidth) / 2, (sourceHeight - cropHeight) / 2, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.68);
      return dataUrl.length <= 300000 ? dataUrl : null;
    } catch {
      return null;
    }
  }

  async function chooseVideoSource() {
    if (desktop?.chooseVideo) {
      const descriptor = await desktop.chooseVideo();
      if (descriptor) {
        loadVideo(descriptor);
        return descriptor;
      }
    } else {
      elements.input.click();
    }
    return null;
  }

  async function ensureRenderableSource(kind = "Video") {
    if (!desktop?.produceVideo) {
      showToast(`${kind} rendering works in the Grayfox desktop app, not the browser preview.`);
      return false;
    }
    if (state.source?.path) return true;
    const previousName = state.source?.name || state.file?.name || "the source video";
    showToast(`Reconnect “${previousName}” to continue rendering.`);
    const descriptor = await chooseVideoSource();
    if (!descriptor?.path) {
      showToast("Rendering paused. Choose the source video when you are ready.");
      return false;
    }
    return true;
  }

  async function chooseDialogueTranscript() {
    if (!desktop?.chooseTranscript) {
      showToast("Attach transcripts in the Grayfox desktop app.");
      return null;
    }
    const transcript = await desktop.chooseTranscript();
    if (!transcript?.path) return null;
    state.transcript = transcript;
    elements.dialogueSourceStatus.textContent = transcript.name || transcript.path;
    elements.dialogueSourceStatus.title = transcript.path;
    showToast(`Dialogue transcript attached: ${transcript.name || "transcript"}.`);
    return transcript;
  }

  elements.choose.addEventListener("click", chooseVideoSource);
  elements.replaceVideo.addEventListener("click", chooseVideoSource);
  if (elements.chooseTranscript) elements.chooseTranscript.addEventListener("click", chooseDialogueTranscript);
  elements.input.addEventListener("change", (event) => loadVideo(event.target.files[0]));
  elements.preview.addEventListener("loadedmetadata", () => {
    const duration = Number(elements.preview.duration) || state.source?.duration || 0;
    if (state.source && state.previewRepresentsSource) state.source.duration = duration;
    if (duration) {
      elements.trimStart.max = String(duration);
      elements.trimEnd.max = String(duration);
      if (!elements.trimEnd.value || Number(elements.trimEnd.value) > duration) elements.trimEnd.value = duration.toFixed(1);
      scheduleSave();
    }
  });

  ["dragenter", "dragover"].forEach((name) => {
    elements.stage.addEventListener(name, (event) => {
      event.preventDefault();
      elements.stage.style.outline = "2px solid #C41E1E";
    });
  });

  ["dragleave", "drop"].forEach((name) => {
    elements.stage.addEventListener(name, (event) => {
      event.preventDefault();
      elements.stage.style.outline = "";
    });
  });

  elements.stage.addEventListener("drop", (event) => loadVideo(event.dataTransfer.files[0]));

  function normalizeToken(value) {
    return value.trim().replace(/^#/, "").replace(/\s+/g, " ");
  }

  function addToken(rawValue) {
    const value = normalizeToken(rawValue);
    if (!value) return false;
    if (state.tokens.some((token) => token.toLowerCase() === value.toLowerCase())) {
      showToast(`“${value}” is already included.`);
      return false;
    }
    if (state.tokens.length >= 6) {
      showToast("Use up to 6 focused tone tokens.");
      return false;
    }
    state.tokens.push(value);
    elements.toneInput.value = "";
    renderTokens();
    handleEditBriefChange();
    return true;
  }

  function renderTokens() {
    elements.tokenList.innerHTML = "";
    state.tokens.forEach((token) => {
      const chip = doc.createElement("span");
      chip.className = "tone-chip";
      const text = doc.createElement("span");
      text.textContent = token;
      const remove = doc.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${token}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        state.tokens = state.tokens.filter((item) => item !== token);
        renderTokens();
        handleEditBriefChange();
      });
      chip.append(text, remove);
      elements.tokenList.appendChild(chip);
    });
    if (elements.toneTokenCount) elements.toneTokenCount.textContent = `${state.tokens.length} / 6 tags`;
  }

  function toneSignalSegmentLength() {
    const normalized = state.tokens.join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, " ");
    if (/(energetic|energy|fast|punchy|direct|irreverent|bold|dynamic|energico|energia|rapido|incalzante|diretto|irriverente|audace|dinamico)/i.test(normalized)) return 6;
    if (/(calm|slow|natural|warm|reflective|intimate|measured|calmo|lento|naturale|caldo|riflessivo|intimo|misurato)/i.test(normalized)) return 14;
    return 10;
  }

  elements.toneInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addToken(elements.toneInput.value);
    }
    if (event.key === "Backspace" && !elements.toneInput.value && state.tokens.length) {
      state.tokens.pop();
      renderTokens();
      handleEditBriefChange();
    }
  });

  doc.querySelectorAll(".token-suggestion").forEach((button) => {
    button.addEventListener("click", () => addToken(button.textContent));
  });

  function parseDurationRequirement(value) {
    const normalized = String(value || "").replace(",", ".");
    const match = normalized.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|ore?|ora|minutes?|mins?|min|m|minuti?|minuto|seconds?|secs?|sec|s|secondi?|secondo)\b/i);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const unit = match[2].toLowerCase();
    const seconds = /^(?:h|hr|hrs|hour|or|ora|ore)/.test(unit)
      ? amount * 3600
      : (/^(?:s|sec|secs|second)/.test(unit) ? amount : amount * 60);
    const context = normalized.slice(Math.max(0, match.index - 48), match.index).toLowerCase();
    const maximum = /(no more than|not more than|at most|less than|under|up to|massimo|al massimo|meno di|non oltre|entro)\s*$/i.test(context);
    const strictMinimum = /(more than|longer than|over|pi[uù] di|oltre|superiore a)\s*$/i.test(context);
    const inclusiveMinimum = /(at least|minimum of|minimum|minimo di|minimo|almeno|non meno di)\s*$/i.test(context);
    return {
      seconds,
      kind: maximum ? "maximum" : ((strictMinimum || inclusiveMinimum) ? "minimum" : "exact"),
      strict: maximum
        ? /(?:less than|under|meno di)\s*$/i.test(context)
        : strictMinimum,
    };
  }

  function parseRequestedDurationSeconds(value) {
    const requirement = parseDurationRequirement(value);
    return requirement?.kind === "exact" ? requirement.seconds : 0;
  }

  function productionDurationRange() {
    const minimumMinutes = Number(elements.minimumMinutes.value);
    const maximumMinutes = Number(elements.maximumMinutes.value);
    const hasMinimum = Number.isFinite(minimumMinutes) && minimumMinutes > 0;
    const hasMaximum = Number.isFinite(maximumMinutes) && maximumMinutes > 0;
    const valid = hasMinimum && hasMaximum && maximumMinutes >= minimumMinutes;
    return {
      minimumMinutes: hasMinimum ? minimumMinutes : 0,
      maximumMinutes: hasMaximum ? maximumMinutes : 0,
      minimumSeconds: hasMinimum ? minimumMinutes * 60 : 0,
      maximumSeconds: hasMaximum ? maximumMinutes * 60 : 0,
      valid,
      reason: !hasMinimum || !hasMaximum
        ? "Enter both minimum and maximum duration."
        : (maximumMinutes < minimumMinutes ? "Maximum duration must be greater than or equal to minimum duration." : ""),
    };
  }

  function requestedProductionSeconds() {
    const range = productionDurationRange();
    return range.valid ? range.maximumSeconds : 0;
  }

  function shortStableHash(value) {
    let hash = 2166136261;
    for (const character of String(value || "")) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `gf-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function currentBriefSignature() {
    return shortStableHash(JSON.stringify({
      source: state.source ? [state.source.path || state.source.name, Number(state.source.size) || 0, Number(state.source.lastModified) || 0] : null,
      finalUse: elements.finalUse.value,
      minimumMinutes: Math.max(0, Number(elements.minimumMinutes.value) || 0),
      maximumMinutes: Math.max(0, Number(elements.maximumMinutes.value) || 0),
      direction: elements.direction.value.trim(),
      tokens: [...state.tokens],
    }));
  }

  function cutViolatesCurrentDuration(firstCut = state.firstCut) {
    if (!firstCut?.outputPath) return false;
    const range = productionDurationRange();
    const duration = Number(firstCut.duration) || 0;
    if (!range.valid || !duration) return false;
    const minimumTolerance = Math.max(2, range.minimumSeconds * 0.03);
    const maximumTolerance = Math.max(2, range.maximumSeconds * 0.03);
    return duration < range.minimumSeconds - minimumTolerance || duration > range.maximumSeconds + maximumTolerance;
  }

  function editPlanFingerprint(editPlan) {
    const segments = editPlan?.segments || [];
    return shortStableHash(JSON.stringify(segments.map((segment) => ({
      start: Number(Number(segment.start).toFixed(3)),
      end: Number(Number(segment.end).toFixed(3)),
      role: segment.role || "body",
      effect: segment.effect || null,
      memeEnabled: segment.memeEnabled !== false,
      memeStart: Number.isFinite(Number(segment.memeStart)) ? Number(Number(segment.memeStart).toFixed(3)) : null,
      memeEnd: Number.isFinite(Number(segment.memeEnd)) ? Number(Number(segment.memeEnd).toFixed(3)) : null,
    }))));
  }

  function showStaleCutState(reason = "The editing brief changed.", { notify = true } = {}) {
    if (!state.firstCut?.outputPath) return false;
    const wasStale = state.firstCutStale;
    state.firstCutStale = true;
    state.firstCut.approval = "pending";
    state.firstCut.approvedAt = null;
    state.projectStatus = "Needs render";
    const actionShell = elements.createCut.closest(".button-with-help");
    if (actionShell) actionShell.hidden = false;
    elements.createCut.innerHTML = "<span>✦</span> Render updated cut";
    elements.processingPanel.hidden = false;
    elements.processingPanel.classList.remove("ready");
    elements.processingTitle.textContent = "Changes not rendered";
    elements.processingEta.textContent = "Preview shows the previous cut";
    elements.processingCuriosity.textContent = `${reason} Render an updated cut before approval or export.`;
    updateReviewPanel();
    if (notify && !wasStale) showToast("Brief changed. Render the updated cut to apply it to the video.");
    return true;
  }

  function handleEditBriefChange() {
    updateBrief();
    showStaleCutState("The current controls no longer match the rendered file.");
    scheduleSave();
  }

  function updateBrief() {
    const filePart = state.file ? `Edit “${state.file.name}”` : "Edit the uploaded video";
    const usePart = `for ${elements.finalUse.value.toLowerCase()}`;
    const tokenPart = state.tokens.length ? ` with a ${state.tokens.join(", ")} tone` : "";
    const directionPart = elements.direction.value.trim()
      ? `. Direction: ${elements.direction.value.trim()}`
      : ".";
    const range = productionDurationRange();
    const targetPart = range.valid
      ? ` Duration window: ${formatClipTime(range.minimumSeconds)}–${formatClipTime(range.maximumSeconds)}.`
      : ` Duration window incomplete. ${range.reason}`;
    elements.minimumMinutes.setAttribute("aria-invalid", String(Boolean(range.minimumMinutes && range.maximumMinutes && !range.valid)));
    elements.maximumMinutes.setAttribute("aria-invalid", String(Boolean(range.minimumMinutes && range.maximumMinutes && !range.valid)));
    elements.durationRangeHelp.textContent = range.valid
      ? `Grayfox may finish anywhere from ${formatClipTime(range.minimumSeconds)} to ${formatClipTime(range.maximumSeconds)}. Written directions cannot override it.`
      : range.reason;
    elements.brief.textContent = `${filePart} ${usePart}${tokenPart}${directionPart}${targetPart}`;
    return elements.brief.textContent;
  }

  elements.direction.addEventListener("input", handleEditBriefChange);
  elements.finalUse.addEventListener("change", handleEditBriefChange);
  elements.minimumMinutes.addEventListener("input", handleEditBriefChange);
  elements.maximumMinutes.addEventListener("input", handleEditBriefChange);

  function activateView(view) {
    state.activeView = view;
    doc.querySelectorAll(".nav-item, .view").forEach((element) => element.classList.remove("active"));
    doc.querySelector(`.nav-item[data-view="${view}"]`).classList.add("active");
    doc.querySelector(`#${view}`).classList.add("active");
    doc.querySelector("#page-title").textContent = view === "video-ops" ? "Video ops" : "Story clips";
    doc.querySelector("#section-label").textContent =
      view === "video-ops" ? "AI EDITING WORKSPACE" : "VERTICAL CLIP STUDIO";
  }

  doc.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => activateView(button.dataset.view));
  });

  activateView(initialView);

  doc.querySelectorAll(".segmented button").forEach((button) => {
    button.addEventListener("click", () => {
      doc.querySelectorAll(".segmented button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
    });
  });

  [elements.shortLength, elements.shortTone, elements.trimStart, elements.trimEnd].forEach((input) => {
    input.addEventListener("input", scheduleSave);
    input.addEventListener("change", scheduleSave);
  });

  function estimateFirstCutSeconds(file) {
    const sizeMb = (Number(file?.size) || 0) / (1024 * 1024);
    return Math.max(5, Math.min(90, Math.round(5 + sizeMb * 0.35)));
  }

  function advanceFirstCut(percent) {
    if (!state.processing) return false;
    const progress = Math.max(0, Math.min(99, Number(percent) || 0));
    state.processing.progress = progress;
    elements.processingBar.style.width = `${progress}%`;
    elements.processingPanel.querySelector(".progress-track").setAttribute("aria-valuenow", String(progress));
    elements.processingEta.textContent = progress ? `${progress}% rendered` : "Starting FFmpeg…";
    elements.processingCuriosity.textContent = curiosities[Math.min(curiosities.length - 1, Math.floor((progress / 100) * curiosities.length))];
    return true;
  }

  function renderEditPlanSummary(editPlan) {
    if (!elements.editPlanSummary) return;
    const segments = editPlan?.segments || [];
    elements.editPlanSummary.hidden = !segments.length;
    const visibleSegments = segments.slice(0, 12);
    const toneChip = editPlan?.toneProfile?.label
      ? `<span class="edit-plan-chip">Tone · ${escapeHtml(editPlan.toneProfile.label)}</span>`
      : "";
    elements.editPlanSummary.innerHTML = toneChip + visibleSegments.map((segment, index) =>
      `<span class="edit-plan-chip">${index + 1} · ${formatClipTime(segment.start)}–${formatClipTime(segment.end)} · ${escapeHtml(segment.role || "body")}</span>`
    ).join("") + (segments.length > visibleSegments.length
      ? `<span class="edit-plan-chip">+${segments.length - visibleSegments.length} more cuts</span>`
      : "");
  }

  const memePresets = Object.freeze({
    punch: { effect: "meme-punch", label: "Punch zoom", reason: "User-selected punch zoom" },
    monochrome: { effect: "meme-monochrome", label: "Monochrome sting", reason: "User-selected monochrome sting" },
    flash: { effect: "meme-flash", label: "Impact flash", reason: "User-selected impact flash" },
  });

  const memeCatalog = Object.freeze([
    { id: "dramatic-zoom", presetId: "punch", label: "Dramatic zoom", description: "Shock, emphasis or plot twist", glyph: "+", previewClass: "preview-punch", keywords: ["shock", "reaction", "reveal", "plot twist", "emphasis", "sorpresa", "reazione", "colpo di scena"] },
    { id: "side-eye", presetId: "punch", label: "Side eye", description: "Doubt, suspicion or disbelief", glyph: "?", previewClass: "preview-punch", keywords: ["side eye", "suspicious", "doubt", "lie", "disbelief", "non ci credo", "sospetto", "dubbio", "bugia"] },
    { id: "wait-what", presetId: "punch", label: "Wait, what?", description: "Interrupt a confusing moment", glyph: "?!", previewClass: "preview-punch", keywords: ["wait", "what", "confused", "interruption", "mistake", "aspetta", "cosa", "confusione", "errore"] },
    { id: "awkward-silence", presetId: "monochrome", label: "Awkward silence", description: "Cringe, pause or dry failure", glyph: "…", previewClass: "preview-mono", keywords: ["awkward", "silence", "cringe", "pause", "fail", "dry", "imbarazzo", "silenzio", "pausa", "fallimento"] },
    { id: "record-scratch", presetId: "monochrome", label: "Record scratch", description: "Freeze a wrong turn", glyph: "||", previewClass: "preview-mono", keywords: ["record scratch", "freeze", "mistake", "wrong", "stop", "errore", "sbaglio", "fermo", "aspetta"] },
    { id: "deadpan", presetId: "monochrome", label: "Deadpan", description: "A dry or sarcastic response", glyph: "—", previewClass: "preview-mono", keywords: ["deadpan", "dry", "sarcastic", "irony", "blank", "sarcasmo", "ironico", "secco"] },
    { id: "big-reveal", presetId: "flash", label: "Big reveal", description: "Discovery, surprise or payoff", glyph: "*", previewClass: "preview-flash", keywords: ["big reveal", "discovery", "surprise", "payoff", "plot twist", "rivelazione", "scoperta", "sorpresa", "finale"] },
    { id: "main-character", presetId: "flash", label: "Main character", description: "Victory, confidence or entrance", glyph: "^", previewClass: "preview-flash", keywords: ["main character", "victory", "win", "confidence", "entrance", "epic", "vittoria", "successo", "sicurezza", "entrata", "epico"] },
  ]);

  const memeSearchAliases = Object.freeze({
    imbarazzante: ["awkward", "cringe"], imbarazzo: ["awkward", "cringe"], silenzio: ["silence"], pausa: ["pause"],
    rivelazione: ["reveal", "surprise"], sorpresa: ["surprise", "shock"], sospetto: ["suspicious"], dubbio: ["doubt"],
    vittoria: ["victory", "win"], epico: ["epic"], errore: ["mistake", "wrong"], aspetta: ["wait", "stop"],
    sarcastico: ["sarcastic", "deadpan"], ironico: ["irony", "deadpan"], reazione: ["reaction"],
  });

  function normalizedMemeTokens(value) {
    const tokens = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]+/g) || [];
    return [...new Set(tokens.flatMap((token) => [token, ...(memeSearchAliases[token] || [])]))];
  }

  function searchMemeCatalog(query = "", limit = 6) {
    const tokens = normalizedMemeTokens(query);
    if (!tokens.length) return memeCatalog.slice(0, limit);
    const ranked = memeCatalog.map((entry, index) => {
      const label = `${entry.label} ${entry.description}`.toLowerCase();
      const keywords = entry.keywords.join(" ").toLowerCase();
      const score = tokens.reduce((total, token) => total
        + (label.includes(token) ? 5 : 0)
        + (keywords.includes(token) ? 3 : 0), 0);
      return { entry, index, score };
    }).sort((a, b) => b.score - a.score || a.index - b.index);
    return (ranked.some((item) => item.score > 0) ? ranked : ranked.map((item) => ({ ...item, score: 0 })))
      .slice(0, limit)
      .map((item) => item.entry);
  }

  function renderMemeSearchResults(results = searchMemeCatalog(""), status = "Local vocabulary ready · LM Studio is optional") {
    if (!elements.memeSearchResults) return results;
    state.memeSearchResults = results;
    elements.memeSearchResults.innerHTML = results.length ? results.map((entry) => `
      <button class="meme-search-result" type="button" role="listitem" data-meme-result="${escapeHtml(entry.id)}" title="Insert ${escapeHtml(entry.label)} at the current playhead">
        <span class="meme-library-preview ${escapeHtml(entry.previewClass)}" aria-hidden="true">${escapeHtml(entry.glyph)}</span>
        <strong>${escapeHtml(entry.label)}</strong>
        <small>${escapeHtml(entry.description)}</small>
      </button>`).join("") : `<p class="meme-search-empty">No matching overlay. Try a feeling, reaction or story beat.</p>`;
    if (elements.memeSearchStatus) elements.memeSearchStatus.textContent = status;
    return results;
  }

  async function performMemeSearch(query = elements.memeSearchInput?.value || "") {
    const cleanQuery = String(query || "").trim().slice(0, 180);
    const localResults = searchMemeCatalog(cleanQuery);
    renderMemeSearchResults(localResults, cleanQuery ? "Local matches ready · checking LM Studio…" : "Local vocabulary ready · LM Studio is optional");
    if (!cleanQuery || !desktop?.searchMemes) return localResults;
    if (elements.memeSearchButton) elements.memeSearchButton.disabled = true;
    try {
      const response = await desktop.searchMemes({
        query: cleanQuery,
        candidates: memeCatalog.map(({ id, label, description, keywords }) => ({ id, label, description, keywords })),
      });
      const byId = new Map(memeCatalog.map((entry) => [entry.id, entry]));
      const ranked = response?.provider === "lm-studio"
        ? (response.results || []).map((item) => byId.get(item.id)).filter(Boolean)
        : [];
      const unique = [...new Map([...ranked, ...localResults].map((entry) => [entry.id, entry])).values()].slice(0, 6);
      const provider = response?.provider === "lm-studio" ? "LM Studio semantic order" : "Local vocabulary";
      const fallback = response?.fallbackReason ? " · model unavailable" : "";
      return renderMemeSearchResults(unique, `${provider}${fallback} · click a result to overlay it`);
    } catch {
      return renderMemeSearchResults(localResults, "Local vocabulary · LM Studio unavailable");
    } finally {
      if (elements.memeSearchButton) elements.memeSearchButton.disabled = false;
    }
  }

  function memeEffectLabel(effect, segment = null) {
    return segment?.memeLabel || Object.values(memePresets).find((preset) => preset.effect === effect)?.label || "Meme effect";
  }

  function memeSegments(editPlan = state.firstCut?.editPlan) {
    return (editPlan?.segments || []).map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => Object.values(memePresets).some((preset) => preset.effect === segment.effect));
  }

  function sourceTimeAtPlayhead() {
    const playhead = Math.max(0, Number(elements.preview?.currentTime) || 0);
    if (state.previewRepresentsSource) return playhead;
    let outputCursor = 0;
    for (const segment of state.firstCut?.editPlan?.segments || []) {
      const length = Math.max(0, Number(segment.end) - Number(segment.start));
      if (playhead <= outputCursor + length) return Number(segment.start) + Math.max(0, playhead - outputCursor);
      outputCursor += length;
    }
    return Number(state.firstCut?.editPlan?.segments?.at(-1)?.start) || 0;
  }

  function renderMemeEditor() {
    if (!elements.memeEditor || !elements.memeBeatList) return;
    const hasCut = Boolean(state.firstCut?.editPlan?.segments?.length);
    const beats = memeSegments();
    elements.memeEditor.hidden = !hasCut;
    const activeCount = beats.filter(({ segment }) => segment.memeEnabled !== false).length;
    elements.memeEditorCount.textContent = `${activeCount} inserted`;
    elements.applyMemeEdits.disabled = !state.memeEditsDirty;
    elements.memeBeatList.innerHTML = beats.length ? beats.map(({ segment, index }, beatIndex) => {
      const enabled = segment.memeEnabled !== false;
      const time = Number.isFinite(Number(segment.memeStart)) ? Number(segment.memeStart) : Number(segment.start);
      return `<article class="meme-beat${enabled ? "" : " disabled"}" data-meme-segment="${index}">
        <span class="meme-beat-signal" aria-hidden="true"></span>
        <div class="meme-beat-copy"><strong>${escapeHtml(memeEffectLabel(segment.effect, segment))}${segment.memeSuggested ? " · AI suggestion" : ""}</strong><span class="meme-beat-time">At <input type="number" step="0.5" min="${Number(segment.start).toFixed(1)}" max="${Math.max(segment.start, segment.end - 0.2).toFixed(1)}" value="${time.toFixed(1)}" data-meme-time aria-label="Meme effect ${beatIndex + 1} source time in seconds"> sec</span></div>
        <div class="meme-beat-actions"><button type="button" data-meme-action="earlier" title="Move 1 second earlier">−1</button><button type="button" data-meme-action="later" title="Move 1 second later">+1</button><button type="button" data-meme-action="toggle">${enabled ? "Remove" : "Restore"}</button></div>
      </article>`;
    }).join("") : `<p class="meme-library-empty">No meme effects inserted. Play the cut, pause on a beat and choose one above.</p>`;
  }

  function addMemePreset(presetId, memeId = null) {
    const preset = memePresets[presetId];
    const catalogEntry = memeCatalog.find((entry) => entry.id === memeId && entry.presetId === presetId) || null;
    const segments = state.firstCut?.editPlan?.segments || [];
    if (state.firstCutStale) {
      showToast("Render the updated brief before adding meme overlays.");
      return false;
    }
    if (!preset || !segments.length) {
      showToast("Create the first cut before inserting meme effects.");
      return false;
    }
    const sourceTime = sourceTimeAtPlayhead();
    const segment = segments.find((item) => sourceTime >= Number(item.start) && sourceTime < Number(item.end))
      || segments.find((item) => Number(item.end) - Number(item.start) >= 0.5);
    if (!segment) return false;
    segment.effect = preset.effect;
    segment.memeEnabled = true;
    segment.memeSuggested = false;
    segment.memeStart = Number(Math.min(Math.max(sourceTime, Number(segment.start)), Math.max(Number(segment.start), Number(segment.end) - 0.2)).toFixed(3));
    segment.memeEnd = Number(Math.min(Number(segment.end), segment.memeStart + 1.2).toFixed(3));
    segment.memeId = catalogEntry?.id || presetId;
    segment.memeLabel = catalogEntry?.label || preset.label;
    segment.memeReason = catalogEntry ? `User-selected ${catalogEntry.label} from Grayfox meme search` : preset.reason;
    state.memeEditsDirty = true;
    state.firstCut.approval = "pending";
    renderMemeEditor();
    updateReviewPanel();
    elements.reviewStatus.textContent = "Meme changes not rendered";
    showToast(`${segment.memeLabel} inserted at ${formatClipTime(segment.memeStart)}. Render changes to review it.`);
    return true;
  }
  function updateMemeBeat(segmentIndex, { delta = 0, time = null, toggle = false } = {}) {
    const segment = state.firstCut?.editPlan?.segments?.[Number(segmentIndex)];
    if (!segment || !Object.values(memePresets).some((preset) => preset.effect === segment.effect)) return false;
    if (toggle) segment.memeEnabled = segment.memeEnabled === false;
    if (delta || time != null) {
      const current = Number.isFinite(Number(segment.memeStart)) ? Number(segment.memeStart) : Number(segment.start);
      const requested = time == null ? current + delta : Number(time);
      segment.memeStart = Number(Math.min(Math.max(requested, segment.start), Math.max(segment.start, segment.end - 0.2)).toFixed(3));
      segment.memeEnd = Number(Math.min(segment.end, segment.memeStart + 1.2).toFixed(3));
    }
    state.memeEditsDirty = true;
    if (state.firstCut) state.firstCut.approval = "pending";
    renderMemeEditor();
    updateReviewPanel();
    elements.reviewStatus.textContent = "Meme changes not rendered";
    showToast("Meme beat updated. Apply changes to render it.");
    return true;
  }

  async function applyMemeChanges() {
    const segments = state.firstCut?.editPlan?.segments || [];
    if (state.firstCutStale) {
      showToast("Render the updated brief before applying meme overlays.");
      return null;
    }
    if (!state.memeEditsDirty || !segments.length) return state.firstCut;
    if (!desktop?.produceEditedVideo) {
      showToast("This meme revision needs the Grayfox multi-segment desktop renderer.");
      return null;
    }
    elements.applyMemeEdits.disabled = true;
    elements.processingPanel.hidden = false;
    elements.processingTitle.textContent = "Applying meme decisions";
    elements.processingEta.textContent = "Rendering locally…";
    try {
      const result = await desktop.produceEditedVideo({
        sourcePath: state.source.path,
        exportPath: state.workspace.exportPath,
        projectName: `${state.projectName}-meme-revision`,
        segments,
        minimumDuration: Number(state.firstCut.minimumDuration) || Number(state.firstCut.targetDuration) || Number(state.firstCut.editPlan.outputDuration) || 0,
        maximumDuration: Number(state.firstCut.maximumDuration) || Number(state.firstCut.targetDuration) || Number(state.firstCut.editPlan.outputDuration) || 0,
      });
      state.firstCut = { ...state.firstCut, ...result, approval: "pending" };
      state.memeEditsDirty = false;
      if (desktop.restoreVideo) {
        const rendered = await desktop.restoreVideo(result.outputPath);
        if (rendered?.url) {
          state.previewRepresentsSource = false;
          elements.preview.src = rendered.url;
        }
      }
      completeFirstCut(result);
      renderMemeEditor();
      updateReviewPanel();
      showToast("Meme changes rendered. Review the cut before approval.");
      return state.firstCut;
    } catch (error) {
      elements.processingTitle.textContent = "Meme revision failed";
      elements.processingCuriosity.textContent = error.message || "Grayfox could not render the meme changes.";
      elements.applyMemeEdits.disabled = false;
      showToast(elements.processingCuriosity.textContent);
      return null;
    }
  }
  elements.memeSearchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    performMemeSearch();
  });
  elements.memeSearchResults?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-meme-result]");
    const entry = memeCatalog.find((item) => item.id === button?.dataset.memeResult);
    if (entry) addMemePreset(entry.presetId, entry.id);
  });
  elements.memeBeatList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-meme-action]");
    const card = button?.closest("[data-meme-segment]");
    if (!button || !card) return;
    const action = button.dataset.memeAction;
    updateMemeBeat(card.dataset.memeSegment, {
      delta: action === "earlier" ? -1 : (action === "later" ? 1 : 0),
      toggle: action === "toggle",
    });
  });
  elements.memeBeatList?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-meme-time]");
    const card = input?.closest("[data-meme-segment]");
    if (input && card) updateMemeBeat(card.dataset.memeSegment, { time: input.value });
  });
  elements.applyMemeEdits?.addEventListener("click", applyMemeChanges);
  function startFirstCut() {
    state.processing = { progress: 0, outputPath: null };
    elements.createCut.closest(".button-with-help").hidden = true;
    elements.processingPanel.hidden = false;
    elements.processingPanel.classList.remove("ready");
    renderEditPlanSummary(null);
    elements.processingTitle.textContent = "Rendering a real first cut";
    elements.processingEta.textContent = "Starting FFmpeg…";
    elements.processingBar.style.width = "0%";
    elements.processingPanel.querySelector(".progress-track").setAttribute("aria-valuenow", "0");
    elements.processingCuriosity.textContent = "Grayfox is building a new timeline from the source.";
    showToast("Building and rendering a real multi-segment edit.");
    saveProject("Rendering first cut");
    return true;
  }

  function completeFirstCut(result = null) {
    if (!state.processing) return false;
    state.processing.progress = 100;
    state.processing.outputPath = result?.outputPath || null;
    elements.processingBar.style.width = "100%";
    elements.processingPanel.querySelector(".progress-track").setAttribute("aria-valuenow", "100");
    elements.processingTitle.textContent = "First cut ready to review";
    elements.processingEta.textContent = "100% rendered";
    elements.processingCuriosity.textContent = result?.outputPath
      ? `Saved to ${result.outputPath}`
      : "Your source is untouched. The new draft is ready in this session.";
    elements.processingPanel.classList.add("ready");
    saveProject("First cut ready");
    showToast("Your real first cut is ready.");
    return true;
  }

  function firstCutCount(firstCut = state.firstCut) {
    return Number(firstCut?.segmentCount) || firstCut?.editPlan?.segments?.length || (firstCut?.outputPath ? 1 : 0);
  }

  function updateReviewPanel() {
    if (!elements.reviewPanel) return;
    if (!state.firstCut?.outputPath) {
      elements.reviewPanel.hidden = true;
      return;
    }
    const cuts = firstCutCount();
    const approval = state.firstCut.approval || "pending";
    const stale = state.firstCutStale;
    const dialogueProvider = state.firstCut.analysis?.dialogueProvider || "visual-and-audio-signals";
    const dialogueCount = Number(state.firstCut.analysis?.dialogueCueCount) || 0;
    elements.reviewPanel.hidden = false;
    elements.cutCount.textContent = `${cuts} cut${cuts === 1 ? "" : "s"}`;
    elements.reviewStatus.textContent = stale ? "Previous cut · render required" : (approval === "approved" ? "Approved" : (approval === "changes-requested" ? "Changes requested" : "Decision required"));
    const excludedRanges = state.firstCut.analysis?.excludedRanges || [];
    const excludedSeconds = excludedRanges.reduce((total, range) => total + Math.max(0, range.end - range.start), 0);
    const compliance = excludedRanges.length ? ` · ${excludedRanges.length} required exclusion${excludedRanges.length === 1 ? "" : "s"} enforced (${formatClipTime(excludedSeconds)})` : "";
    const memes = Number(state.firstCut.analysis?.memeBeatCount) ? ` · ${state.firstCut.analysis.memeBeatCount} visual meme beat${state.firstCut.analysis.memeBeatCount === 1 ? "" : "s"}` : "";
    const toneProfile = state.firstCut.editPlan?.toneProfile || state.firstCut.analysis?.toneProfile;
    const appliedTone = toneProfile?.label ? ` · tone tags applied: ${toneProfile.label}` : "";
    const staleWarning = stale ? "This preview predates the current brief. " : "";
    elements.reviewSummary.textContent = `${staleWarning}${formatClipTime(state.firstCut.duration)} rendered · dialogue: ${dialogueCount ? `${dialogueCount} cues via ${dialogueProvider}` : "no transcript available; visual and speech-activity signals used"}${compliance}${memes}${appliedTone}.`;
    elements.revisionBox.hidden = stale || approval !== "changes-requested";
    if (stale || approval !== "approved") elements.handoffPanel.hidden = true;
    elements.approveCut.disabled = stale || approval === "approved";
    renderCutReviewList();
  }

  function renderCutReviewList() {
    if (!elements.cutReviewList) return;
    const segments = state.firstCut?.editPlan?.segments || state.firstCut?.segments || [];
    if (!segments.length) {
      elements.cutReviewList.innerHTML = state.firstCut?.outputPath
        ? `<article class="cut-review-item"><div><strong>Complete rendered cut</strong><small>00:00–${formatClipTime(state.firstCut.duration || 0)} in the approved output</small></div><button class="secondary-button" type="button" data-review-cut="0" data-output-start="0" data-output-end="${Number(state.firstCut.duration) || 0}">Preview</button></article>`
        : "";
      return;
    }
    let cursor = 0;
    elements.cutReviewList.innerHTML = segments.map((segment, index) => {
      const length = Math.max(0, Number(segment.end) - Number(segment.start));
      const outputStart = cursor;
      cursor += length;
      const meme = segment.effect && segment.memeEnabled !== false ? ` · ${memeEffectLabel(segment.effect, segment)}` : "";
      return `<article class="cut-review-item"><div><strong>Cut ${index + 1} · ${escapeHtml(segment.role || "body")}</strong><small>Source ${formatClipTime(segment.start)}–${formatClipTime(segment.end)} · output ${formatClipTime(outputStart)}–${formatClipTime(cursor)}${escapeHtml(meme)}</small></div><button class="secondary-button" type="button" data-review-cut="${index}" data-output-start="${outputStart}" data-output-end="${cursor}">Preview</button></article>`;
    }).join("");
  }

  function previewReviewedCut(button) {
    if (!state.firstCut?.outputPath || !elements.preview) return false;
    const start = Math.max(0, Number(button?.dataset?.outputStart) || 0);
    const end = Math.max(start, Number(button?.dataset?.outputEnd) || Number(state.firstCut.duration) || 0);
    elements.preview.currentTime = start;
    state.reviewCutEnd = end;
    const playback = elements.preview.play?.();
    if (playback?.catch) playback.catch(() => {});
    showToast(`Previewing cut ${Number(button?.dataset?.reviewCut || 0) + 1}.`);
    return true;
  }

  async function approveFirstCut() {
    if (state.memeEditsDirty) {
      showToast("Apply or restore the meme changes before approving this cut.");
      return false;
    }
    if (!state.firstCut?.outputPath) {
      showToast("Render a first cut before approving it.");
      return false;
    }
    if (state.firstCutStale) {
      showToast("Render the updated cut before approving it.");
      return false;
    }
    state.firstCut.approval = "approved";
    state.firstCut.approvedAt = new Date().toISOString();
    state.projectStatus = "Approved";
    updateReviewPanel();
    await saveProject("Approved");
    showToast("Cut approved. Save is ready; other destinations are optional.");
    return true;
  }

  function requestFirstCutChanges() {
    if (!state.firstCut?.outputPath) return false;
    if (state.firstCutStale) {
      showToast("Render the updated cut first; the current preview is from the previous brief.");
      return false;
    }
    state.firstCut.approval = "changes-requested";
    state.projectStatus = "Needs changes";
    updateReviewPanel();
    elements.revisionNotes.focus();
    showToast("Tell Grayfox exactly what should change, then render the revision.");
    return true;
  }

  async function renderRevision() {
    const feedback = elements.revisionNotes.value.trim();
    if (!feedback) {
      showToast("Add revision notes before rendering again.");
      return null;
    }
    state.revisionFeedback = feedback;
    state.firstCut.approval = "changes-requested";
    return createFirstCut();
  }

  async function createApprovedHandoff() {
    if (state.firstCutStale || state.firstCut?.approval !== "approved" || !state.firstCut?.outputPath) {
      showToast("Approve the cut before creating an Adobe or social handoff.");
      return null;
    }
    if (!desktop?.createHandoff) {
      showToast("Handoffs are available in the Grayfox desktop app.");
      return null;
    }
    elements.createHandoff.disabled = true;
    elements.handoffStatus.textContent = "Preparing approved edit…";
    try {
      const target = elements.handoffTarget.value;
      const result = await desktop.createHandoff({
        target,
        sourcePath: state.source?.path,
        outputPath: state.firstCut.outputPath,
        exportPath: state.workspace?.exportPath,
        projectName: state.projectName,
        duration: state.firstCut.duration,
        approvedAt: state.firstCut.approvedAt,
        segments: state.firstCut.editPlan?.segments || state.firstCut.segments || [],
        direction: elements.direction.value.trim(),
        tone: state.tokens,
        memeBeats: memeSegments().map(({ segment, index }) => ({ segmentIndex: index, start: segment.memeStart, end: segment.memeEnd, enabled: segment.memeEnabled !== false, reason: segment.memeReason || "" })),
      });
      elements.handoffStatus.textContent = result.message || `Created ${result.path}`;
      showToast(result.message || "Handoff ready.");
      return result;
    } catch (error) {
      elements.handoffStatus.textContent = error.message || "Could not create the handoff.";
      showToast(elements.handoffStatus.textContent);
      return null;
    } finally {
      elements.createHandoff.disabled = false;
    }
  }

  elements.approveCut?.addEventListener("click", approveFirstCut);
  elements.requestChanges?.addEventListener("click", requestFirstCutChanges);
  elements.renderRevision?.addEventListener("click", renderRevision);
  elements.createHandoff?.addEventListener("click", createApprovedHandoff);
  elements.toggleHandoffOptions?.addEventListener("click", () => {
    const willOpen = elements.handoffSecondary.hidden;
    elements.handoffSecondary.hidden = !willOpen;
    elements.toggleHandoffOptions.setAttribute("aria-expanded", String(willOpen));
    elements.toggleHandoffOptions.querySelector("span").textContent = willOpen ? "−" : "＋";
    if (willOpen) elements.handoffTarget.focus();
  });
  elements.cutReviewList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-cut]");
    if (button) previewReviewedCut(button);
  });
  elements.preview?.addEventListener("timeupdate", () => {
    if (state.reviewCutEnd == null || Number(elements.preview.currentTime) < state.reviewCutEnd) return;
    elements.preview.pause?.();
    state.reviewCutEnd = null;
  });

  async function createFirstCut() {
    if (!state.source) {
      showToast("Add a video before creating the first cut.");
      return null;
    }
    if (!await ensureRenderableSource("First cut")) return null;
    if (!state.workspace?.exportPath) {
      showToast("Choose an export folder in workspace settings first.");
      return null;
    }
    const requestedRange = productionDurationRange();
    if (!requestedRange.valid) {
      showToast(requestedRange.reason);
      return null;
    }
    const previousEditPlan = state.firstCut?.editPlan || (state.firstCut?.segments?.length ? { segments: state.firstCut.segments } : null);
    const previousPlanFingerprint = previousEditPlan?.segments?.length ? editPlanFingerprint(previousEditPlan) : null;
    const requiresChangedRender = Boolean(state.firstCutStale || state.revisionFeedback);
    startFirstCut();
    elements.reviewPanel.hidden = true;
    try {
      const manualStart = Number(elements.trimStart.value) || 0;
      const manualEnd = Number(elements.trimEnd.value) || 0;
      const targetLength = requestedRange.maximumSeconds;
      const effectiveDirection = [elements.direction.value.trim(), state.revisionFeedback ? `Revision request: ${state.revisionFeedback}` : ""].filter(Boolean).join("\n");
      let selectedRange = {
        start: manualStart,
        end: Math.min(manualEnd || state.source.duration || manualStart + targetLength, manualStart + targetLength),
      };
      if (desktop.analyzeVideo) {
        elements.processingTitle.textContent = "Building a multi-segment edit plan";
        elements.processingEta.textContent = "Scenes, pauses and local vision…";
        elements.processingCuriosity.textContent = "Grayfox is selecting a hook, body beats and a closing moment.";
        state.analysis = await desktop.analyzeVideo({
          mode: "edit",
          sourcePath: state.source.path,
          targetLength,
          minimumDuration: requestedRange.minimumSeconds,
          maximumDuration: requestedRange.maximumSeconds,
          segmentLength: toneSignalSegmentLength(),
          finalUse: elements.finalUse.value,
          tone: state.tokens.join(", "),
          direction: effectiveDirection,
          transcriptPath: state.transcript?.path || null,
        });
        if (state.analysis.directionRules?.mustRemove?.length && Number(state.analysis.directionAuditCoverage) < 0.8) {
          throw new Error("Grayfox could not verify enough of the timeline to enforce your removal instructions. No misleading cut was rendered. Check that the local vision engine is running, then try again.");
        }
        const excludedSeconds = (state.analysis.excludedRanges || []).reduce((total, range) => total + Math.max(0, range.end - range.start), 0);
        if (state.analysis.directionAuditCount) {
          elements.processingTitle.textContent = "Direction audit complete";
          elements.processingEta.textContent = `${state.analysis.directionAuditCount} timeline samples checked`;
          const profileLabel = state.analysis.toneProfile?.label || "Balanced";
          elements.processingCuriosity.textContent = `${state.analysis.excludedRanges.length} mandatory exclusion${state.analysis.excludedRanges.length === 1 ? "" : "s"} (${formatClipTime(excludedSeconds)}) · ${state.analysis.memeBeatCount || 0} visual meme beat${state.analysis.memeBeatCount === 1 ? "" : "s"} planned · ${profileLabel} tone profile.`;
        }
        const best = state.analysis.candidates?.[0];
        if (best) selectedRange = { start: best.start, end: best.end };
      }
      const editPlan = state.analysis?.editPlan || null;
      const effectiveMinimumDuration = Number(state.analysis?.minimumDuration) || requestedRange.minimumSeconds;
      const effectiveMaximumDuration = Number(state.analysis?.maximumDuration) || requestedRange.maximumSeconds;
      const effectiveTargetLength = Number(state.analysis?.targetLength) || effectiveMaximumDuration;
      if (editPlan?.segments?.length === 1) {
        selectedRange = { start: editPlan.segments[0].start, end: editPlan.segments[0].end };
      }
      if (requiresChangedRender && previousPlanFingerprint && editPlan?.segments?.length && editPlanFingerprint(editPlan) === previousPlanFingerprint) {
        throw new Error("The revised brief produced the same timeline as the previous cut. Grayfox stopped instead of exporting an unchanged video. Make the instruction more specific or include a timestamp.");
      }
      renderEditPlanSummary(editPlan);
      elements.processingTitle.textContent = editPlan?.segments?.length > 1
        ? `Rendering ${editPlan.segments.length} edited segments`
        : "Rendering the strongest selected range";
      elements.processingEta.textContent = "Starting FFmpeg…";
      const commonPayload = {
        sourcePath: state.source.path,
        exportPath: state.workspace.exportPath,
        projectName: `${state.projectName}-first-cut`,
        minimumDuration: effectiveMinimumDuration,
        maximumDuration: effectiveMaximumDuration,
      };
      const result = editPlan?.segments?.length && desktop.produceEditedVideo
        ? await desktop.produceEditedVideo({ ...commonPayload, segments: editPlan.segments })
        : await desktop.produceVideo({
          ...commonPayload,
          trimStart: selectedRange.start,
          trimEnd: selectedRange.end,
        });
      const minimumTolerance = Math.max(2, effectiveMinimumDuration * 0.03);
      const maximumTolerance = Math.max(2, effectiveMaximumDuration * 0.03);
      result.minimumDuration = Number(result.minimumDuration) || effectiveMinimumDuration;
      result.maximumDuration = Number(result.maximumDuration) || effectiveMaximumDuration;
      result.targetDuration = Number(result.targetDuration) || effectiveMaximumDuration;
      result.meetsTarget = typeof result.meetsTarget === "boolean"
        ? result.meetsTarget
        : Number(result.duration) >= effectiveMinimumDuration - minimumTolerance
          && Number(result.duration) <= effectiveMaximumDuration + maximumTolerance;
      if (!result.meetsTarget && !result.durationWarning) {
        result.durationWarning = `Rendered ${formatClipTime(result.duration)} outside the requested ${formatClipTime(effectiveMinimumDuration)}–${formatClipTime(effectiveMaximumDuration)} window.`;
      }
      const renderedEditPlan = editPlan ? {
        ...editPlan,
        segments: Array.isArray(result.segments) && result.segments.length ? result.segments : editPlan.segments,
        outputDuration: Number(result.duration) || Number(editPlan.outputDuration) || 0,
      } : null;
      state.firstCut = {
        ...result,
        analysis: state.analysis,
        editPlan: renderedEditPlan,
        selectedRange,
        approval: "pending",
        revisionFeedback: state.revisionFeedback,
        renderedBriefSignature: currentBriefSignature(),
      };
      state.firstCutStale = false;
      state.memeEditsDirty = false;
      renderMemeEditor();
      if (desktop.restoreVideo) {
        const rendered = await desktop.restoreVideo(result.outputPath);
        if (rendered?.url) {
          state.previewRepresentsSource = false;
          elements.preview.src = rendered.url;
        }
      }
      completeFirstCut(result);
      updateReviewPanel();
      state.revisionFeedback = "";
      if (editPlan?.segments?.length) {
        const skippedCount = result.skippedSegments?.length || 0;
        if (!result.meetsTarget) {
          elements.processingTitle.textContent = "First cut incomplete — review source";
          elements.processingEta.textContent = `${formatClipTime(result.duration)} · requested ${formatClipTime(result.minimumDuration)}–${formatClipTime(result.maximumDuration)}`;
          elements.processingCuriosity.textContent = `${result.durationWarning} ${skippedCount ? `${skippedCount} damaged section${skippedCount === 1 ? " was" : "s were"} skipped. ` : ""}Saved to ${result.outputPath}`;
          showToast("The file was rendered but did not meet the requested duration window.");
        } else if (skippedCount) {
          elements.processingTitle.textContent = "First cut ready with a source warning";
          elements.processingEta.textContent = `${formatClipTime(result.duration)} rendered`;
          elements.processingCuriosity.textContent = `${result.segmentCount} sections rendered · ${skippedCount} damaged or incomplete section${skippedCount === 1 ? " was" : "s were"} skipped. Saved to ${result.outputPath}`;
          showToast(`First cut ready. ${skippedCount} damaged source section${skippedCount === 1 ? " was" : "s were"} skipped.`);
        } else {
          elements.processingEta.textContent = `${formatClipTime(result.duration)} · inside ${formatClipTime(result.minimumDuration)}–${formatClipTime(result.maximumDuration)}`;
          const profileLabel = renderedEditPlan?.toneProfile?.label || "Balanced";
          elements.processingCuriosity.textContent = `${result.segmentCount || 1} source section${result.segmentCount === 1 ? "" : "s"} rendered · ${profileLabel} tone profile applied · duration window met · saved to ${result.outputPath}`;
        }
      } else if (state.analysis?.candidates?.[0]) {
        const best = state.analysis.candidates[0];
        elements.processingCuriosity.textContent = `${best.title}: ${best.note} Saved to ${result.outputPath}`;
      }
      return state.firstCut;
    } catch (error) {
      state.processing = null;
      elements.processingTitle.textContent = "First cut failed";
      elements.processingEta.textContent = "Not rendered";
      elements.processingCuriosity.textContent = error?.message || "Grayfox could not analyze or render this video.";
      elements.createCut.closest(".button-with-help").hidden = false;
      showToast(error?.message || "Grayfox could not analyze or render this video.");
      return null;
    }
  }

  elements.createCut.addEventListener("click", createFirstCut);

  function openHelp(button) {
    elements.helpTitle.textContent = button.dataset.helpTitle;
    elements.helpCopy.textContent = button.dataset.help;
    elements.helpPopover.hidden = false;
  }

  doc.querySelectorAll(".help-button").forEach((button) => {
    button.addEventListener("click", () => openHelp(button));
  });
  doc.querySelector("#help-close").addEventListener("click", () => {
    elements.helpPopover.hidden = true;
    if (win.speechSynthesis) win.speechSynthesis.cancel();
  });
  doc.querySelector("#speak-help").addEventListener("click", () => {
    if (!win.speechSynthesis || typeof win.SpeechSynthesisUtterance !== "function") {
      showToast("Voice guidance is not available on this device.");
      return;
    }
    win.speechSynthesis.cancel();
    const utterance = new win.SpeechSynthesisUtterance(
      `${elements.helpTitle.textContent}. ${elements.helpCopy.textContent}`
    );
    utterance.rate = 0.96;
    win.speechSynthesis.speak(utterance);
  });

  const clipData = [];

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatClipTime(seconds) {
    const whole = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(whole / 60);
    return `${String(minutes).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
  }

  function targetClipSeconds() {
    const value = elements.shortLength.value;
    if (value.startsWith("15")) return 22;
    if (value.startsWith("45")) return 52;
    return 37;
  }

  function buildClipCandidates(duration, targetLength = targetClipSeconds()) {
    const sourceDuration = Number(duration) || 0;
    if (sourceDuration <= 0) return [];
    const length = Math.min(targetLength, sourceDuration);
    const starts = sourceDuration <= length + 0.1
      ? [0]
      : [0.12, 0.44, 0.76].map((fraction) => Math.min(sourceDuration - length, Math.max(0, sourceDuration * fraction)));
    return starts.map((start, index) => {
      const end = Math.min(sourceDuration, start + length);
      return {
        start: Number(start.toFixed(2)),
        end: Number(end.toFixed(2)),
        time: `${formatClipTime(start)}–${formatClipTime(end)}`,
        title: `Review range ${index + 1}`,
        note: "A real interval from the source. Review it before rendering; no semantic AI score is claimed.",
        score: index + 1,
        outputPath: null,
      };
    });
  }

  function renderClipCandidates(candidates) {
    const shortTokens = elements.shortTone.value.trim();
    const list = doc.querySelector("#candidate-list");
    list.innerHTML = candidates.map((clip, index) => `
      <article class="candidate">
        <div class="candidate-thumb" style="filter: hue-rotate(${index * 35}deg)"><span>${escapeHtml(clip.time)}</span></div>
        <div><h4>${escapeHtml(clip.title)}</h4><p>${escapeHtml(clip.note)}${shortTokens ? ` Tone target: ${escapeHtml(shortTokens)}.` : ""}</p><small class="meme-signal">Meme ${Number(clip.memeScore) || 0}/100 · ${escapeHtml(clip.memeReason || "No meme signal")}</small><small class="clip-output">${escapeHtml(clip.outputPath || "Not rendered yet")}</small></div>
        <div class="candidate-actions"><div class="candidate-score" aria-label="Edit score">${Number(clip.score) || 0}</div><button class="secondary-button compact-button" type="button" data-render-clip="${index}">Render clip</button></div>
      </article>
    `).join("");
  }

  async function findClipRanges() {
    if (!state.source) {
      showToast("Upload your long-form video in Video ops first.");
      return [];
    }
    const duration = Number(state.source.duration) || Number(elements.preview.duration) || 0;
    if (!duration) {
      showToast("Wait for the video duration to load, then try again.");
      return [];
    }
    const button = doc.querySelector("#find-moments");
    button.disabled = true;
    button.textContent = "Analyzing locally…";
    try {
      let candidates;
      if (state.source.path && desktop?.analyzeVideo) {
        state.analysis = await desktop.analyzeVideo({
          sourcePath: state.source.path,
          targetLength: targetClipSeconds(),
          finalUse: `Story clip for ${selectedPlatform()}`,
          tone: elements.shortTone.value.trim(),
          direction: "Find a self-contained hook and separately evaluate meme potential.",
          transcriptPath: state.transcript?.path || null,
        });
        candidates = state.analysis.candidates.map((clip) => ({
          ...clip,
          time: `${formatClipTime(clip.start)}–${formatClipTime(clip.end)}`,
          outputPath: null,
        }));
      } else {
        candidates = buildClipCandidates(duration).map((clip) => ({ ...clip, memeScore: 0, memeReason: "Desktop AI analysis required." }));
      }
      clipData.splice(0, clipData.length, ...candidates);
      renderClipCandidates(clipData);
      saveProject(`${clipData.length} ranked clip candidates`);
      const engine = /vision|lm-studio/.test(state.analysis?.provider || "") ? "local vision AI" : "measured local signals";
      showToast(`${clipData.length} moments ranked with ${engine}.`);
      return clipData;
    } catch (error) {
      showToast(error?.message || "Local analysis failed.");
      return [];
    } finally {
      button.disabled = false;
      button.textContent = "Analyze best moments";
    }
  }


  async function renderStoryClip(index) {
    const clip = clipData[Number(index)];
    if (!clip) return null;
    if (!await ensureRenderableSource("Clip")) return null;
    if (!state.workspace?.exportPath) {
      showToast("Choose an export folder in workspace settings first.");
      return null;
    }
    const button = doc.querySelector(`[data-render-clip="${index}"]`);
    if (button) { button.disabled = true; button.textContent = "Rendering…"; }
    try {
      const result = await desktop.produceVideo({
        sourcePath: state.source.path,
        exportPath: state.workspace.exportPath,
        projectName: `${state.projectName}-story-${Number(index) + 1}`,
        trimStart: clip.start,
        trimEnd: clip.end,
      });
      clip.outputPath = result.outputPath;
      renderClipCandidates(clipData);
      saveProject("Story clip rendered");
      showToast(`Story clip ${Number(index) + 1} rendered as a real MP4.`);
      return result;
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = "Render clip"; }
      showToast(error?.message || "FFmpeg could not render this story clip.");
      return null;
    }
  }

  doc.querySelector("#find-moments").addEventListener("click", findClipRanges);
  doc.querySelector("#candidate-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-render-clip]");
    if (button) renderStoryClip(button.dataset.renderClip);
  });
  function updateProductionProgress(progress) {
    const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
    if (elements.productionStatus) elements.productionStatus.hidden = false;
    if (elements.productionPercent) elements.productionPercent.textContent = `${percent}%`;
    if (elements.productionBar) elements.productionBar.style.width = `${percent}%`;
    if (state.processing && percent < 100) advanceFirstCut(percent);
  }

  if (desktop?.onProductionProgress) desktop.onProductionProgress(updateProductionProgress);

  async function produceCurrentVideo(format = elements.exportFormat?.value || "mp4") {
    if (state.firstCutStale || state.firstCut?.approval !== "approved" || !state.firstCut?.outputPath) {
      showToast("Approve the first cut before saving or publishing it.");
      return null;
    }
    if (!state.workspace?.exportPath) {
      showToast("Choose an export folder in workspace settings first.");
      return null;
    }
    if (!desktop?.exportApprovedVideo) {
      showToast("Saving approved formats works in the Grayfox desktop app, not the browser preview.");
      return null;
    }
    elements.exportButton.disabled = true;
    if (elements.saveApprovedFormat) elements.saveApprovedFormat.disabled = true;
    if (elements.productionStatus) elements.productionStatus.hidden = false;
    if (elements.productionTitle) elements.productionTitle.textContent = "Saving approved video";
    if (elements.productionCopy) elements.productionCopy.textContent = "Converting the reviewed cut locally with FFmpeg…";
    updateProductionProgress({ percent: 0 });
    try {
      const result = await desktop.exportApprovedVideo({
        outputPath: state.firstCut.outputPath,
        exportPath: state.workspace.exportPath,
        projectName: state.projectName,
        format,
      });
      state.lastExportPath = result.outputPath;
      if (elements.productionTitle) elements.productionTitle.textContent = "Video saved";
      if (elements.productionCopy) elements.productionCopy.textContent = result.outputPath;
      if (elements.formatExportStatus) elements.formatExportStatus.textContent = `${result.label || format} saved to ${result.outputPath}`;
      updateProductionProgress({ percent: 100 });
      await saveProject("Exported");
      showToast(`${result.label || "Approved video"} saved in your export folder.`);
      return result;
    } catch (error) {
      if (elements.productionTitle) elements.productionTitle.textContent = "Save failed";
      if (elements.productionCopy) elements.productionCopy.textContent = error.message || "FFmpeg could not save this format.";
      if (elements.formatExportStatus) elements.formatExportStatus.textContent = error.message || "FFmpeg could not save this format.";
      showToast(error.message || "Save failed.");
      return null;
    } finally {
      elements.exportButton.disabled = false;
      if (elements.saveApprovedFormat) elements.saveApprovedFormat.disabled = false;
    }
  }

  function openSaveOptions() {
    if (state.firstCutStale || state.firstCut?.approval !== "approved") {
      showToast("Approve the first cut before saving it.");
      return false;
    }
    elements.handoffPanel.hidden = false;
    elements.handoffSecondary.hidden = true;
    elements.toggleHandoffOptions.setAttribute("aria-expanded", "false");
    elements.toggleHandoffOptions.querySelector("span").textContent = "＋";
    elements.exportFormat?.focus();
    showToast("Choose the final video format. Other destinations are available as a secondary option.");
    return true;
  }

  elements.exportButton.addEventListener("click", openSaveOptions);
  elements.saveApprovedFormat?.addEventListener("click", () => produceCurrentVideo());

  renderMemeSearchResults();
  updateBrief();
  const ready = initializeWorkspace();

  return {
    state,
    elements,
    clipData,
    ready,
    normalizeToken,
    addToken,
    loadVideo,
    updateBrief,
    activateView,
    showToast,
    initializeWorkspace,
    chooseExportPath,
    createWorkspace,
    saveProject,
    renderRecentProjects,
    startFirstCut,
    advanceFirstCut,
    completeFirstCut,
    estimateFirstCutSeconds,
    parseRequestedDurationSeconds,
    parseDurationRequirement,
    productionDurationRange,
    requestedProductionSeconds,
    currentBriefSignature,
    cutViolatesCurrentDuration,
    editPlanFingerprint,
    showStaleCutState,
    handleEditBriefChange,
    ensureRenderableSource,
    setProfileImage,
    readBrowserWorkspace,
    restoreProject,
    produceCurrentVideo,
    openSaveOptions,
    createFirstCut,
    findClipRanges,
    renderStoryClip,
    buildClipCandidates,
    firstCutCount,
    updateReviewPanel,
    approveFirstCut,
    requestFirstCutChanges,
    renderRevision,
    createApprovedHandoff,
    chooseDialogueTranscript,
    captureProjectThumbnail,
    memeSegments,
    renderMemeEditor,
    searchMemeCatalog,
    renderMemeSearchResults,
    performMemeSearch,
    addMemePreset,
    updateMemeBeat,
    applyMemeChanges,
    renderCutReviewList,
    previewReviewedCut,
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.GrayfoxApp = createGrayfoxApp(document, window);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createGrayfoxApp };
}
