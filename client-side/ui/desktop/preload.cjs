const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("askiDesktop", {
  isDesktop: true,
  serverHost: (process.env.ASKI_SERVER_HOST || "").trim(),
  serverPort: (process.env.ASKI_SERVER_PORT || "").trim(),
  useHttps: (process.env.ASKI_SERVER_USE_HTTPS || "").trim(),
});
