const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

const config = getDefaultConfig(__dirname);

config.resolver.blockList = [
  /\/\.local\/.*/,
  /\/\.git\/.*/,
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith("@/")) {
    const relative = moduleName.slice(2);
    const base = path.resolve(__dirname, relative);
    const exts = [".tsx", ".ts", ".jsx", ".js"];

    for (const ext of exts) {
      if (fs.existsSync(base + ext)) {
        return { filePath: base + ext, type: "sourceFile" };
      }
    }
    for (const ext of exts) {
      const idx = path.join(base, "index" + ext);
      if (fs.existsSync(idx)) {
        return { filePath: idx, type: "sourceFile" };
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
