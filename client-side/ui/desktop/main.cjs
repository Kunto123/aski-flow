const fs = require("fs");
const http = require("http");
const path = require("path");
const { app, BrowserWindow, shell } = require("electron");

const DEFAULT_URL = "http://127.0.0.1:5173";
let localUiServer = null;
let localUiServerUrl = null;

function isLoopbackHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function isTrustedMediaOrigin(raw) {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol === "file:") return true;
    if ((url.protocol === "http:" || url.protocol === "https:") && isLoopbackHost(url.hostname)) {
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

function installMediaPermissionHandlers(electronSession) {
  if (!electronSession || electronSession.__askiMediaPermissionHandlersInstalled) {
    return;
  }

  electronSession.__askiMediaPermissionHandlersInstalled = true;

  if (typeof electronSession.setPermissionCheckHandler === "function") {
    electronSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      if (permission === "media") {
        const candidate = requestingOrigin || (webContents && webContents.getURL && webContents.getURL());
        return isTrustedMediaOrigin(candidate);
      }
      return false;
    });
  }

  if (typeof electronSession.setPermissionRequestHandler === "function") {
    electronSession.setPermissionRequestHandler(
      (webContents, permission, callback, details) => {
        if (permission === "media") {
          const candidate =
            (details && (details.requestingUrl || details.requestingOrigin)) ||
            (webContents && webContents.getURL && webContents.getURL());
          callback(isTrustedMediaOrigin(candidate));
          return;
        }
        callback(false);
      },
    );
  }
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".map":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function sendStaticFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Internal Server Error");
      return;
    }

    res.writeHead(200, {
      "Content-Type": getContentType(filePath),
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
}

function startLocalBuildServer(buildIndexPath) {
  if (localUiServer && localUiServerUrl) {
    return Promise.resolve(localUiServerUrl);
  }

  const buildRoot = path.dirname(buildIndexPath);
  const buildRootResolved = path.resolve(buildRoot);
  const buildIndexResolved = path.resolve(buildIndexPath);

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
        let pathname = decodeURIComponent(requestUrl.pathname || "/");

        if (pathname === "/" || pathname === "") {
          sendStaticFile(res, buildIndexResolved);
          return;
        }

        const requestedPath = path.resolve(buildRootResolved, "." + pathname);
        const isInsideBuildRoot =
          requestedPath === buildRootResolved ||
          requestedPath.startsWith(buildRootResolved + path.sep);

        if (!isInsideBuildRoot) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Forbidden");
          return;
        }

        if (fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile()) {
          sendStaticFile(res, requestedPath);
          return;
        }

        // SPA fallback for client-side routes.
        sendStaticFile(res, buildIndexResolved);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Internal Server Error");
      }
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        reject(new Error("Failed to determine local UI server address"));
        return;
      }
      localUiServer = server;
      localUiServerUrl = `http://127.0.0.1:${address.port}`;
      resolve(localUiServerUrl);
    });
  });
}

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

async function createWindow() {
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
  installMediaPermissionHandlers(mainWindow.webContents.session);

  const target = getClientTarget();
  if (target.type === "file") {
    const loopbackUrl = await startLocalBuildServer(target.value);
    await mainWindow.loadURL(loopbackUrl);
  } else {
    await mainWindow.loadURL(target.value);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow().catch((error) => {
    console.error("Failed to create Electron window:", error);
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => {
        console.error("Failed to recreate Electron window:", error);
      });
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (localUiServer) {
    try {
      localUiServer.close();
    } catch (e) {
      // ignore
    }
    localUiServer = null;
    localUiServerUrl = null;
  }
});
