/**
 * Deduplicate concurrent asynchronous starts for the same object key.
 *
 * The MHTML hook receives both DOMContentLoaded and load events. Without this
 * gate, those events can race before pageState is populated and create two
 * recorders/directories for the same page.
 */
export function createAsyncStartGate() {
  const inFlightStarts = new WeakMap();

  return async function runOnceWhileStarting(key, startOperation) {
    const existingStart = inFlightStarts.get(key);
    if (existingStart) return existingStart;

    const startPromise = Promise.resolve().then(startOperation);
    inFlightStarts.set(key, startPromise);

    try {
      return await startPromise;
    } finally {
      if (inFlightStarts.get(key) === startPromise) {
        inFlightStarts.delete(key);
      }
    }
  };
}
