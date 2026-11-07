import { spawn } from "node:child_process";

export type Launch = (command: {
  file: string;
  args: readonly string[];
}) => void;

// Starts a program on its own, the way a shortcut would: no console, not tied to our lifetime
export function launchDetached({ file, args }: Parameters<Launch>[0]) {
  const child = spawn(file, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.on("error", () => undefined);
  child.unref();
}
