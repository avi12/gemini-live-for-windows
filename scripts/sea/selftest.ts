import { PeSubsystem, readSubsystem } from "../../app/src/entry/pe-subsystem.ts";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EXIT_TIMEOUT_MS = 15_000;
const STARTUP_RUNS = 3;
const BYTES_PER_MEGABYTE = 1024 * 1024;

// Runs the built exe against scripts/sea/selftest: it must start, run a Worker with top-level await
// that loads dynwinrt and calls Win32, and exit 0 when stdin closes. Prints size and cold start.
const [exe, dynwinrtEntry] = process.argv.slice(2);
if (exe === undefined || dynwinrtEntry === undefined) {
  throw new Error("Usage: selftest.ts <exe> <dynwinrt win32-unsafe.js>");
}

function runOnce() {
  return new Promise<{
    readyMs: number;
    exitCode: number | null;
    output: string;
  }>((resolve, reject) => {
    const started = performance.now();
    const child = spawn(exe!, [], {
      env: {
        ...process.env,
        SEA_SELFTEST_DYNWINRT: pathToFileURL(dynwinrtEntry!).href
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let output = "";
    let readyMs = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out. Output so far: ${output}`));
    }, EXIT_TIMEOUT_MS);
    child.stdout.on("data", chunk => {
      output += String(chunk);

      if (readyMs === 0 && output.includes("ready")) {
        readyMs = performance.now() - started;
        child.stdin.end();
      }
    });
    child.stderr.on("data", chunk => {
      output += `[stderr] ${String(chunk)}`;
    });
    child.on("error", reject);
    child.on("exit", exitCode => {
      clearTimeout(timer);
      resolve({
        readyMs,
        exitCode,
        output
      });
    });
  });
}

const subsystem = readSubsystem(fs.readFileSync(exe));
if (subsystem !== PeSubsystem.windowsGui) {
  throw new Error(`Subsystem is ${subsystem}, expected GUI (${PeSubsystem.windowsGui})`);
}

const times: number[] = [];
for (let run = 0; run < STARTUP_RUNS; run += 1) {
  const result = await runOnce();
  if (result.exitCode !== 0 || !result.output.includes("worker=tla dynwinrt=ok")) {
    throw new Error(`Self test failed (exit ${result.exitCode}): ${result.output}`);
  }

  times.push(result.readyMs);
}
const megabytes = fs.statSync(exe).size / BYTES_PER_MEGABYTE;
process.stdout.write(`${path.basename(exe)}: GUI subsystem, ${megabytes.toFixed(1)} MB, ready in ${times.map(time => time.toFixed(0)).join(" / ")} ms, exit 0 on stdin close\n`);
