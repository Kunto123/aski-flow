const path = require("path");
const { spawn } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const electronBinPath = require("electron");
const runtimeEnv = { ...process.env };
const SUPPRESSED_STDERR_PATTERNS = [
  "registration_protocol_win.cc(108)] CreateFile: The system cannot find the file specified. (0x2)",
];

delete runtimeEnv.ELECTRON_RUN_AS_NODE;

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

const electronProcess = spawn(electronBinPath, ["."], {
  cwd: rootDir,
  stdio: ["inherit", "inherit", "pipe"],
  env: runtimeEnv,
});

forwardFilteredStderr(electronProcess);

electronProcess.on("exit", (code) => {
  process.exit(code ?? 0);
});
