export const PUBLIC_USER_NAME_KEY = "mei-ling-public-user-name-v1";
export const PRIVATE_USER_NAME = "Miura";

export function sanitizePublicUserName(value, { maxLength = 28 } = {}) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replace(/[^\p{L}\p{M}\p{N} ._'’\-]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
}

export function isMiuraUserName(value) {
  return sanitizePublicUserName(value).toLocaleLowerCase("it-IT") === "miura";
}

export function createPublicUserProfile(value) {
  const name = sanitizePublicUserName(value);
  if (!name) return null;
  const miura = isMiuraUserName(name);
  const displayName = miura ? PRIVATE_USER_NAME : name;
  return Object.freeze({
    name: displayName,
    label: displayName.toLocaleUpperCase("it-IT"),
    isMiura: miura,
    avatar: miura ? "./figma-miura-manga-approved.png" : "./operative-avatar-masked-v1.png",
  });
}

export function readPublicUserProfile(storage = globalThis.sessionStorage) {
  try {
    return createPublicUserProfile(storage?.getItem(PUBLIC_USER_NAME_KEY));
  } catch {
    return null;
  }
}

export function storePublicUserProfile(profile, storage = globalThis.sessionStorage) {
  if (!profile?.name) return false;
  try {
    storage?.setItem(PUBLIC_USER_NAME_KEY, profile.name);
    return true;
  } catch {
    return false;
  }
}
