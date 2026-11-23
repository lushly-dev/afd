/**
 * Real timers captured at page bootstrap before `pin.clock` can patch `globalThis`, so Specimen's
 * own waits (`settle`, `events`, `expectations`, FCP probe) never freeze under `pin.clock` and
 * never need to unpin `globalThis.setTimeout` for application callbacks.
 */
export const realSetTimeout = globalThis.setTimeout.bind(globalThis);
export const realClearTimeout = globalThis.clearTimeout.bind(globalThis);
export const realDelay = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		realSetTimeout(resolve, ms);
	});
