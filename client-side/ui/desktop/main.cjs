const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, shell } = require("electron");

const DEFAULT_URL = "http://127.0.0.1:5173";

function getClientTarget() {
  const runtimeUrl = (process.env.ASKI_CLIENT_URL || "").trim();
  if (runtimeUrl) {
    return { type: "url", value: runtimeUrl };
  }

  const localBuildIndex = path.join(__dirname, "..", "build", "index.html");
  if (fs.existsSync(localBuildIndex)) {
    return { type: "file", value: localBuildIndex };
  }

  return { type: "url", value: DEFAULT_URL };
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.removeMenu();

  const target = getClientTarget();
  if (target.type === "file") {
    mainWindow.loadFile(target.value);
  } else {
    mainWindow.loadURL(target.value);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
