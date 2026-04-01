const domain = process.env.EXPO_PUBLIC_DOMAIN || process.env.APP_DOMAIN;
const origin = domain ? `https://${domain}` : "https://localhost:5000";

module.exports = ({ config }) => ({
  ...config,
  plugins: [
    [
      "expo-router",
      {
        origin,
      },
    ],
    "expo-font",
    "expo-localization",
    "expo-secure-store",
    "expo-web-browser",
  ],
  extra: {
    ...config.extra,
    router: {
      origin,
    },
    apiDomain: domain || "localhost:5000",
  },
});
