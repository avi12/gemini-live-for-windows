import { spawn } from "node:child_process";

interface LaunchCommand {
  file: string;
  args: readonly string[];
  env?: NodeJS.ProcessEnv;
}

export type Launch = (command: LaunchCommand) => void;

// Starts a program on its own, the way a shortcut would: no console, not tied to our lifetime
export function launchDetached({ file, args, env = process.env }: Parameters<Launch>[0]) {
  const child = spawn(file, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env
  });
  child.on("error", () => undefined);
  child.unref();
}
