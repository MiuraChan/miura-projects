function normalizeExternalNewsUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || url.username || url.password) return "";

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      !hostname ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".home.arpa") ||
      hostname.includes(":") ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
    ) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}

function isSafeExternalNewsUrl(value) {
  return Boolean(normalizeExternalNewsUrl(value));
}

module.exports = { isSafeExternalNewsUrl, normalizeExternalNewsUrl };
