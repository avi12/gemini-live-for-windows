import { z } from "zod";

const HOST_PROCESS_POLL_MILLISECONDS = 1000;

const hostProcessIdSchema = z.coerce.number().int().positive();

function isProcessRunning(processId: number) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    const isDenied = error instanceof Error && "code" in error && error.code === "EPERM";
    return isDenied;
  }
}

export function readHostProcessId(rawValue: string | undefined) {
  const parsed = hostProcessIdSchema.safeParse(rawValue);
  if (!parsed.success) {
    return undefined;
  }

  return parsed.data;
}

export function watchHostProcess({ processId, onGone }: {
  processId: number;
  onGone: () => void;
}) {
  const timer = setInterval(() => {
    if (!isProcessRunning(processId)) {
      onGone();
    }
  }, HOST_PROCESS_POLL_MILLISECONDS);
  return () => clearInterval(timer);
}
