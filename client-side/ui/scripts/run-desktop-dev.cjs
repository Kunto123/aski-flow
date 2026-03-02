const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const viteCliPath = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");
const electronBinPath = require("electron");
const SUPPRESSED_STDERR_PATTERNS = [
  "registration_protocol_win.cc(108)] CreateFile: The system cannot find the file specified. (0x2)",
];

function getArgValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index === process.argv.length - 1) {
    return fallback;
  }
  return process.argv[index + 1];
}

function waitForUrl(url, timeoutMs) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const probe = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });

      req.on("error", () => {
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(probe, 400);
      });

      req.setTimeout(800, () => {
        req.destroy();
      });
    };

    probe();
  });
}

function forwardFilteredStderr(childProcess) {
  if (!childProcess || !childProcess.stderr) return;

  let buffer = "";
  childProcess.stderr.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const shouldSuppress = SUPPRESSED_STDERR_PATTERNS.some((pattern) =>
        line.includes(pattern),
      );
      if (!shouldSuppress && line.trim() !== "") {
        process.stderr.write(`${line}\n`);
      }
    }
  });

  childProcess.stderr.on("end", () => {
    const line = buffer.trim();
    if (!line) return;
    const shouldSuppress = SUPPRESSED_STDERR_PATTERNS.some((pattern) =>
      line.includes(pattern),
    );
    if (!shouldSuppress) {
      process.stderr.write(`${line}\n`);
    }
  });
}

const host = getArgValue("--host", "127.0.0.1");
const parsedPort = parseInt(getArgValue("--port", "5173"), 10);
const port = Number.isNaN(parsedPort) ? 5173 : parsedPort;
const clientUrl = `http://${host}:${port}`;

const runtimeEnv = {
  ...process.env,
  ASKI_CLIENT_URL: clientUrl,
};

delete runtimeEnv.ELECTRON_RUN_AS_NODE;

let viteProcess = null;
let electronProcess = null;
let isShuttingDown = false;

function shutdown(exitCode) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill();
  }
  if (viteProcess && !viteProcess.killed) {
    viteProcess.kill();
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 100);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

viteProcess = spawn(
  process.execPath,
  [viteCliPath, "--host", host, "--port", String(port)],
  {
    cwd: rootDir,
    stdio: "inherit",
    env: runtimeEnv,
  },
);

viteProcess.on("exit", (code) => {
  if (!isShuttingDown) {
    shutdown(code ?? 1);
  }
});

waitForUrl(clientUrl, 90_000)
  .then(() => {
    electronProcess = spawn(electronBinPath, ["."], {
      cwd: rootDir,
      stdio: ["inherit", "inherit", "pipe"],
      env: runtimeEnv,
    });

    forwardFilteredStderr(electronProcess);

    electronProcess.on("exit", (code) => {
      shutdown(code ?? 0);
    });
  })
  .catch((err) => {
    console.error(err.message);
    shutdown(1);
  });
