/** Await execution only while the request owns its signal, even if execution ignores it. */
export async function raceWithAbort<T>(signal: AbortSignal, execute: () => Promise<T>): Promise<T> {
	signal.throwIfAborted();
	let onAbort: (() => void) | undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		onAbort = () => reject(signal.reason);
		signal.addEventListener('abort', onAbort, { once: true });
	});
	try {
		// The race observes late rejections, so canceled work cannot create an unhandled rejection.
		return await Promise.race([execute(), aborted]);
	} finally {
		if (onAbort) signal.removeEventListener('abort', onAbort);
	}
}
