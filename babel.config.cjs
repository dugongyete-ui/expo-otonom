module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        "babel-preset-expo",
        {
          unstable_transformImportMeta: true,
          reactCompiler: false,
        },
      ],
    ],
    plugins: [
      "react-native-reanimated/plugin",
    ],
  };
};
