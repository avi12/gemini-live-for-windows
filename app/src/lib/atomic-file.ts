import fs from "node:fs/promises";
import path from "node:path";

// Replaces the file whole, so a reader never sees half of it
export async function writeFileAtomic({ filePath, content }: {
  filePath: string;
  content: string;
}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, content);
  await fs.rename(temporary, filePath);
}
