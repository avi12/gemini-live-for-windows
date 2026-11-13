import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ALIAS_PREFIX = "@scripts/";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isAliased = specifier.startsWith(ALIAS_PREFIX);
    if (!isAliased) {
      return nextResolve(specifier, context);
    }

    const target = path.join(import.meta.dirname, specifier.slice(ALIAS_PREFIX.length));
    return nextResolve(pathToFileURL(target).href, context);
  }
});
