import { isError } from "./error-guards.ts";

export function errorMessage(error: unknown) {
  return isError(error) ? error.message : String(error);
}
