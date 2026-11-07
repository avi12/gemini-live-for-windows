import { DEFAULT_CLOSE_REASON } from "@/live/api/constants.ts";

export function closeReason(reason: string) {
  return reason.length > 0 ? reason : DEFAULT_CLOSE_REASON;
}
