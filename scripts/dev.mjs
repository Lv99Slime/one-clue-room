import { spawn } from "node:child_process";

const commands = [
  ["server", process.execPath, ["node_modules/tsx/dist/cli.mjs", "watch", "server/index.ts"]],
  ["client", process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"]]
];

const children = commands.map(([label, command, args]) => {
  const child = spawn(command, args, {
    stdio: ["inherit", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  child.on("exit", (code) => {
    if (code && !shuttingDown) {
      console.error(`[${label}] exited with code ${code}`);
      shutdown(code);
    }
  });

  return child;
});

let shuttingDown = false;

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function shutdown(code) {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}
