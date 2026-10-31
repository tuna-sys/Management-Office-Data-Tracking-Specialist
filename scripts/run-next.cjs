const { spawn } = require("node:child_process");
const path = require("node:path");
const mode = process.argv[2];
if (!["dev", "build", "start"].includes(mode))
  throw new Error("Invalid Next.js mode");
const args = [
  "--max-old-space-size=8192",
  // Trust the Windows certificate store while retaining HTTPS verification.
  ...(process.platform === "win32" && process.allowedNodeEnvironmentFlags.has("--use-system-ca")
    ? ["--use-system-ca"]
    : []),
  path.resolve("node_modules/next/dist/bin/next"),
  mode,
  ...(mode === "build"
    ? []
    : ["-H", "127.0.0.1", "-p", process.env.LOCAL_APP_PORT || "3000"]),
];
const child = spawn(process.execPath, args, {
  env: {
    ...process.env,
    LOCAL_BUILD_DIR: mode === "dev" ? ".next-local" : ".next-evolution",
  },
  stdio: "inherit",
});
child.on("exit", (code) => {
  process.exitCode = code || 0;
});
child.on("error", () => {
  console.error("Không thể khởi động Next.js");
  process.exitCode = 1;
});
