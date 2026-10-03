module.exports = {
  appId: "it.miura.mei-codec",
  productName: "MEI Codec",
  asar: true,
  directories: {
    output: "dist",
  },
  files: [
    "brain/**/*.mjs",
    "desktop/**/*",
    "public/**/*",
    "server.mjs",
    "package.json",
    "!**/*.test.mjs",
  ],
  extraResources: [
    {
      from: "packaging/runtime",
      to: "runtime",
      filter: ["**/*", "!README.md"],
    },
  ],
  win: {
    target: ["nsis"],
    artifactName: "MEI-Codec-${version}-${arch}.${ext}",
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "MEI Codec",
  },
};
