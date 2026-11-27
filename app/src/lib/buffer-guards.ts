import { z } from "@gemini-live/protocol/zod";
import { createGuard } from "@gemini-live/protocol/zod-guard";

export const isArrayBuffer = createGuard(z.instanceof(ArrayBuffer));
