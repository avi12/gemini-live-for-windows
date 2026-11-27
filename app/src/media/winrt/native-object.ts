import { z } from "@gemini-live/protocol/zod";
import { createGuard } from "@gemini-live/protocol/zod-guard";
import { DynWinRtValue } from "@microsoft/dynwinrt";

const NATIVE_FIELD = "_obj";
const isProjection = createGuard(z.looseObject({ [NATIVE_FIELD]: z.instanceof(DynWinRtValue) }));

// The WinRT object behind a generated binding class, which keeps it in a field the typings do not show
export function nativeOf(projected: object) {
  return isProjection(projected) ? projected[NATIVE_FIELD] : undefined;
}
