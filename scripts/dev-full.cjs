const { spawn } = require("node:child_process");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [
  spawn(npm, ["--prefix", "server", "run", "start"], { stdio: "inherit" }),
  spawn(npm, ["--prefix", "app", "run", "dev"], { stdio: "inherit" }),
];

let stopping = false;

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop();
    process.exitCode = 1;
  });

  child.on("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      stop();
      process.exitCode = code || (signal ? 1 : 0);
    }
  });
}
