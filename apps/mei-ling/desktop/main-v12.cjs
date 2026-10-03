const { app, shell } = require("electron");
const { normalizeExternalNewsUrl } = require("./external-link.cjs");

app.on("web-contents-created", (_event, contents) => {
  const registerWindowHandler = contents.setWindowOpenHandler.bind(contents);

  contents.setWindowOpenHandler = (fallbackHandler) => {
    registerWindowHandler((details) => {
      const safeUrl = normalizeExternalNewsUrl(details.url);
      if (safeUrl) {
        void Promise.resolve()
          .then(() => shell.openExternal(safeUrl))
          .catch((error) => console.warn("external-link:", error.message));
        return { action: "deny" };
      }

      try {
        const fallbackResult = fallbackHandler?.(details);
        return fallbackResult && typeof fallbackResult === "object"
          ? fallbackResult
          : { action: "deny" };
      } catch {
        return { action: "deny" };
      }
    });
  };
});

require("./main.cjs");
