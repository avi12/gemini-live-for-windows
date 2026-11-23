import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInThisContext } from "node:vm";

import { errorMessage } from "@/lib/error-message.ts";
import { STRIP_HEIGHT, STRIP_WIDTH } from "@/media/ocr/lens/layout/strips.ts";

import { parseLabelMap } from "./label-map.ts";

const RUNTIME_PACKAGE = "@litertjs/core";
const DIRNAME_GLOBAL = "__dirname";
const FILENAME_GLOBAL = "__filename";
const WASM_FOLDER = "wasm";
const BUNDLED_WASM_FOLDER = "litert";
const DYNAMIC_BATCH = -1;
const BATCH_OF_ONE = 1;
const INT32_BYTES = 4;
const SCORE_RANK = 3;
const MODEL_FILE = "hebr.tflite";
const LABELS_FILE = "hebr_label_map.pb";

export interface LineRecognizer {
  // The recogniser's score for each class at each step across a strip, step by step
  readonly classCount: number;
  readonly stepCount: number;
  readonly labels: ReadonlyMap<number, string>;
  // The label index that means no symbol at this step
  readonly blank: number;
  scores(pixels: Uint8Array): Promise<Uint8Array>;
}

// LiteRT.js loads its WebAssembly with a browser script tag; in Node the same scripts run as plain
// globals, with the CommonJS names they were written against
function installScriptLoader() {
  Object.assign(globalThis, {
    self: globalThis,
    require: createRequire(import.meta.url),
    importScripts(url: string | URL) {
      const file = fileURLToPath(url);
      Object.assign(globalThis, {
        [DIRNAME_GLOBAL]: path.dirname(file),
        [FILENAME_GLOBAL]: file
      });
      runInThisContext(readFileSync(file, "utf8"), { filename: file });
    }
  });
}

// The model's input is declared with a batch of -1, which LiteRT.js refuses to feed: pinned to one
function withBatchOfOne(model: Uint8Array) {
  const pinned = Buffer.from(model);
  const shape = [DYNAMIC_BATCH, STRIP_HEIGHT, STRIP_WIDTH, BATCH_OF_ONE];
  const unpinned = Buffer.alloc(INT32_BYTES * shape.length);
  for (const [index, size] of shape.entries()) {
    unpinned.writeInt32LE(size, INT32_BYTES * index);
  }
  for (let offset = pinned.indexOf(unpinned); offset !== -1; offset = pinned.indexOf(unpinned, offset + INT32_BYTES)) {
    pinned.writeInt32LE(BATCH_OF_ONE, offset);
  }
  return pinned;
}

// Where the WebAssembly files are: beside the bundle in an install (the build copies them there), else
// in the package itself
function wasmDirectory() {
  const beside = path.join(path.dirname(fileURLToPath(import.meta.url)), BUNDLED_WASM_FOLDER);
  if (existsSync(beside)) {
    return beside;
  }

  const packageFile = createRequire(import.meta.url).resolve(`${RUNTIME_PACKAGE}/package.json`);
  return path.join(path.dirname(packageFile), WASM_FOLDER);
}

async function load(directory: string) {
  installScriptLoader();
  const litert = await import("@litertjs/core");
  await litert.loadLiteRt(pathToFileURL(`${wasmDirectory()}${path.sep}`).href, {});
  const model = await litert.loadAndCompile(withBatchOfOne(await readFile(path.join(directory, MODEL_FILE))), {
    accelerator: "wasm"
  });
  const labels = parseLabelMap(await readFile(path.join(directory, LABELS_FILE)));
  const probe = await model.run(
    new litert.Tensor(new Uint8Array(STRIP_HEIGHT * STRIP_WIDTH), [BATCH_OF_ONE, STRIP_HEIGHT, STRIP_WIDTH, 1])
  );
  const shape = probe.map(tensor => tensor.type.layout.dimensions).find(dimensions => dimensions.length === SCORE_RANK);
  const [, stepCount = 0, classCount = 0] = shape ?? [];

  async function scores(pixels: Uint8Array) {
    const input = new litert.Tensor(pixels, [BATCH_OF_ONE, STRIP_HEIGHT, STRIP_WIDTH, 1]);
    const outputs = await model.run(input);
    try {
      const output = outputs.find(tensor => tensor.type.layout.dimensions.length === SCORE_RANK);
      return Uint8Array.from(output?.toTypedArray() ?? [], Number);
    } finally {
      for (const tensor of outputs) {
        tensor.delete();
      }
    }
  }

  for (const tensor of probe) {
    tensor.delete();
  }
  return {
    classCount,
    stepCount,
    labels,
    blank: classCount - 1,
    scores
  } satisfies LineRecognizer;
}

let loading: Promise<LineRecognizer | undefined> | undefined;

// Google's Hebrew line recogniser from the user's own Lens models in `directory`, loaded once.
// Undefined when the models are not there or do not load, so the other readers carry on alone.
export function hebrewRecognizer({ directory, log }: { directory: string; log: (message: string) => void }) {
  loading ??= (async () => {
    const isPresent = existsSync(path.join(directory, MODEL_FILE)) && existsSync(path.join(directory, LABELS_FILE));
    if (!isPresent) {
      return undefined;
    }

    try {
      return await load(directory);
    } catch (error) {
      log(`hebrew text: ${errorMessage(error)}`);
      return undefined;
    }
  })();
  return loading;
}
