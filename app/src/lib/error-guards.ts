import { z } from "@gemini-live/protocol/zod";
import { createGuard } from "@gemini-live/protocol/zod-guard";

export const isError = createGuard(z.instanceof(Error));

/** The file system's error for a path that does not exist */
export const isMissingFileError = createGuard(
  z.instanceof(Error).refine(createGuard(z.looseObject({ code: z.literal("ENOENT") })))
);
