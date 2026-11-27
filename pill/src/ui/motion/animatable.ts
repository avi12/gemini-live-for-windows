import { z } from "@gemini-live/protocol/zod";
import { createGuard, VOID_METHOD_SCHEMA } from "@gemini-live/protocol/zod-guard";

export const isAnimatable = createGuard(
  z.looseObject({
    animate: z.function({
      input: [z.array(z.looseObject({})), z.looseObject({})],
      output: z.looseObject({ cancel: VOID_METHOD_SCHEMA })
    })
  })
);
