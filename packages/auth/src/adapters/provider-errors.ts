/**
 * @fileoverview Helpers for classifying errors thrown by auth provider clients
 */

/**
 * Collect the readable text of a thrown value: the message, plus the `data`
 * string of a Convex `ConvexError`, which carries the application's message
 * when the deployment hides server error text.
 */
export function describeThrown(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const data =
		typeof error === 'object' && error !== null && 'data' in error && typeof error.data === 'string'
			? error.data
			: undefined;
	return data === undefined || message.includes(data) ? message : `${message} (${data})`;
}

/**
 * Whether a thrown value is a transport failure rather than a provider
 * answer. Matches the fetch failure messages of Chrome, Firefox, Safari,
 * undici and cross-fetch.
 */
export function isKnownNetworkFailure(error: unknown, message: string): boolean {
	if (error instanceof Error && (error.name === 'NetworkError' || error.name === 'TimeoutError')) {
		return true;
	}

	return /failed to fetch|fetch failed|load failed|networkerror when attempting to fetch|network (?:request )?failed|connection (?:refused|reset|closed)|request timed out|internet connection appears to be offline/i.test(
		message
	);
}
