import { readFile } from "node:fs/promises";
import path from "node:path";

// The page bridges, built from bridge/*.ts by bridge/build.mjs into plain JS and injected into the
// page at document start
export const BridgeName = {
  GLIC: "glic_bridge.js",
  HOME: "home_bridge.js"
} as const;
export type BridgeName = (typeof BridgeName)[keyof typeof BridgeName];

// Where bridge/build.mjs writes them
function defaultBridgesDir() {
  return path.resolve(import.meta.dirname, "../../../../bridge/dist");
}

export function readBridgeScript({ name, directory = defaultBridgesDir() }: { name: BridgeName; directory?: string }) {
  return readFile(path.join(directory, name), "utf8");
}
