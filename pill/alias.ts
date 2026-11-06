import path from "node:path";

export const SRC_ALIAS = [
  {
    find: /^@\//,
    replacement: `${path.join(import.meta.dirname, "src")}/`
  }
];
