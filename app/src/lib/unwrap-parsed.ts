// The data of a successful zod parse, or its error thrown: for a message handler, whose throw the
// sender gets back as the answer's error
export function unwrapParsed<T>(result: {
  success: true;
  data: T;
} | {
  success: false;
  error: Error;
}) {
  if (!result.success) {
    throw new Error(result.error.message);
  }

  return result.data;
}
