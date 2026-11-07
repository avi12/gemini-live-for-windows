import path from "node:path";
import type { Plugin } from "vite";

const ALIAS_PREFIX = "@/";
const SRC_DIRECTORY = path.join(import.meta.dirname, "src");
const PILL_DIRECTORY = path.join(import.meta.dirname, "..", "pill");
const PILL_SRC_DIRECTORY = path.join(PILL_DIRECTORY, "src");

function isUnder({ file, directory }: {
  file: string;
  directory: string;
}) {
  const relative = path.relative(directory, file);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function resolveAliasTarget({ source, importer }: {
  source: string;
  importer: string | undefined;
}) {
  const isAliased = source.startsWith(ALIAS_PREFIX);
  if (!isAliased) {
    return null;
  }

  const isPillImporter = importer !== undefined && isUnder({
    file: path.normalize(importer),
    directory: PILL_DIRECTORY
  });
  const base = isPillImporter ? PILL_SRC_DIRECTORY : SRC_DIRECTORY;
  return path.join(base, source.slice(ALIAS_PREFIX.length));
}

export function aliasPlugin() {
  return {
    name: "gemini-live-alias",
    enforce: "pre",
    resolveId(source, importer) {
      const target = resolveAliasTarget({
        source,
        importer
      });
      const isUnaliased = target === null;
      if (isUnaliased) {
        return null;
      }

      return this.resolve(target, importer, { skipSelf: true });
    }
  } satisfies Plugin;
}
