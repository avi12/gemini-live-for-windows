import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TEXT_VARIABLE = "GEMINI_LIVE_CLIPBOARD_TEXT";

export type CopyText = (text: string) => Promise<void>;

// The text travels in the environment, never in the command line, so no quoting can change it
export async function copyTextWithPowerShell(text: string) {
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Set-Clipboard -Value $env:${TEXT_VARIABLE}`
  ], {
    windowsHide: true,
    env: {
      ...process.env,
      [TEXT_VARIABLE]: text
    }
  });
}
