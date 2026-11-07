import { isInstanceRunning } from "@/core/instance/instance.ts";
import { writeFileAtomic } from "@/lib/atomic-file.ts";
import { dataDir } from "@/lib/paths.ts";
import { type LinkInfo, linkInfoSchema } from "@gemini-live/protocol/link";
import fs from "node:fs/promises";
import path from "node:path";

const LINK_FILE = "link.json";

function linkFilePath() {
  return path.join(dataDir(), LINK_FILE);
}

// Where this run of the app publishes its session link for the native host to hand the extension
export function writeLinkFile({ link, filePath = linkFilePath() }: {
  link: LinkInfo;
  filePath?: string;
}) {
  return writeFileAtomic({
    filePath,
    content: JSON.stringify(link)
  });
}

async function readLinkText(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

// The running app's link; undefined when it isn't running or left no readable file
export async function readLinkFile({
  filePath = linkFilePath(),
  isRunning = isInstanceRunning
}: {
  filePath?: string;
  isRunning?: () => Promise<boolean>;
} = {}) {
  if (!await isRunning()) {
    return undefined;
  }

  const text = await readLinkText(filePath);
  const isMissing = text === undefined;
  if (isMissing) {
    return undefined;
  }

  try {
    const parsed = linkInfoSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
