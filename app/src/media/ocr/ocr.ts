import type { Language } from "winui-svelte/bindings/windows/globalization/Language";
import type { SoftwareBitmap } from "winui-svelte/bindings/windows/graphics/imaging/SoftwareBitmap";
import { OcrEngine } from "winui-svelte/bindings/windows/media/ocr/OcrEngine";
import type { OcrResult } from "winui-svelte/bindings/windows/media/ocr/OcrResult";

import type { Region } from "@/contracts/monitor.ts";
import { log } from "@/core/log/log.ts";
import { lensModelsDir } from "@/lib/paths.ts";
import { openImage } from "@/media/winrt/decoded-image.ts";
import { releaseNative } from "@/media/winrt/release.ts";

import { readHebrewLines } from "./lens/hebrew-ocr.ts";
import { hebrewRecognizer } from "./lens/model/lens-model.ts";
import { engineTagOrder, mergeLines, NoOcrLanguageError, planScan, sortLines, toSourceBounds } from "./ocr-geometry.ts";
import type { OcrLine } from "./ocr-geometry.ts";

function createEngines() {
  const profile = OcrEngine.tryCreateFromUserProfileLanguages();
  const installed = new Map<string, Language>();
  for (const language of OcrEngine.availableRecognizerLanguages ?? []) {
    installed.set(language.languageTag, language);
  }
  const tags = engineTagOrder({
    profileTag: profile?.recognizerLanguage.languageTag,
    installedTags: [...installed.keys()]
  });
  const engines: OcrEngine[] = [];
  for (const tag of tags) {
    const language = installed.get(tag);
    const engine = language === undefined ? profile : OcrEngine.tryCreateFromLanguage(language);
    const hasEngine = engine !== null;
    if (hasEngine) {
      engines.push(engine);
    }
  }
  return engines;
}

function toLines({
  result,
  origin,
  scale
}: {
  result: OcrResult;
  origin: {
    x: number;
    y: number;
  };
  scale: number;
}) {
  return sortLines(
    [...(result.lines ?? [])].map(line => ({
      words: [...(line.words ?? [])].map(word => ({
        text: word.text,
        bounds: toSourceBounds({
          bounds: word.boundingRect,
          origin,
          scale
        })
      }))
    }))
  );
}

// Every engine reads the picture and their lines are merged, so a page mixing languages is read in all
async function recognize({
  engines,
  bitmap,
  origin,
  scale
}: {
  engines: readonly OcrEngine[];
  bitmap: SoftwareBitmap;
  origin: {
    x: number;
    y: number;
  };
  scale: number;
}) {
  const passes: OcrLine[][] = [];
  for (const engine of engines) {
    passes.push(
      toLines({
        result: await engine.recognizeAsync(bitmap),
        origin,
        scale
      })
    );
  }

  // Hebrew, which Windows has no OCR pack for here: read by Google's own recogniser when it is installed
  const hebrew = await hebrewRecognizer({
    directory: lensModelsDir(),
    log: message => log.write(message)
  });
  if (hebrew !== undefined) {
    const lines = await readHebrewLines({
      bitmap,
      recognizer: hebrew
    });
    passes.push(
      lines.map(line => ({
        words: line.words.map(word => ({
          text: word.text,
          bounds: toSourceBounds({
            bounds: word.bounds,
            origin,
            scale
          })
        }))
      }))
    );
  }

  return mergeLines(passes);
}

// All text lines in `region` (the whole picture when undefined) of an encoded image (JPEG, PNG, BMP),
// top to bottom. Boxes are in the picture's own pixels. Reads with the user-profile languages first, then
// every installed one, and merges what they find.
// @throws NoOcrLanguageError when Windows has no OCR language installed
export async function readLines({ image, region }: { image: Uint8Array; region?: Region | undefined }) {
  const engines = createEngines();
  const isEnginesEmpty = engines.length === 0;
  if (isEnginesEmpty) {
    throw new NoOcrLanguageError();
  }

  const picture = await openImage(image);
  try {
    const plan = planScan({
      image: picture.size,
      region,
      maxDimension: OcrEngine.maxImageDimension
    });
    const isPlanMissing = plan === undefined;
    if (isPlanMissing) {
      return [] satisfies OcrLine[];
    }

    const bitmap = await picture.crop(plan);
    try {
      return await recognize({
        engines,
        bitmap,
        origin: plan.area,
        scale: plan.scale
      });
    } finally {
      bitmap.close();
      releaseNative(bitmap);
    }
  } finally {
    picture.close();
  }
}
