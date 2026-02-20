const path = require("path");
const { spawn } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const electronBinPath = require("electron");
const runtimeEnv = { ...process.env };

delete runtimeEnv.ELECTRON_RUN_AS_NODE;

const electronProcess = spawn(electronBinPath, ["."], {
  cwd: rootDir,
  stdio: "inherit",
  env: runtimeEnv,
});

electronProcess.on("exit", (code) => {
  process.exit(code ?? 0);
});
