import { spawn } from "node:child_process";

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", "test/map-volume-compile.integration.test.ts"],
  {
    cwd: process.cwd(),
    env: { ...process.env, DOTA2_MCP_COMPILE_INTEGRATION: "1" },
    stdio: "inherit",
    windowsHide: true,
  },
);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
