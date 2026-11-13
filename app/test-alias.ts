import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveAliasTarget } from "./alias.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const importer = context.parentURL?.startsWith("file:") ? fileURLToPath(context.parentURL) : undefined;
    const target = resolveAliasTarget({
      source: specifier,
      importer
    });
    const isUnaliased = target === null;
    if (isUnaliased) {
      return nextResolve(specifier, context);
    }

    return nextResolve(pathToFileURL(target).href, context);
  }
});
