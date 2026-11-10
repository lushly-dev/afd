/**
 * @fileoverview What an adapter may show of a session: a handle in place of its token, and a
 * device label in place of its user agent. Nothing here keeps or returns an IP address.
 */

/**
 * A session's handle: the first 16 hex characters of SHA-256 over its token. The token never
 * leaves the adapter; the handle names the session to the person and to commands.
 */
export async function sessionHandle(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	let hex = '';
	for (const byte of new Uint8Array(digest).subarray(0, 8)) {
		hex += byte.toString(16).padStart(2, '0');
	}
	return hex;
}

// Order matters: Edge and Opera carry "Chrome", Chrome carries "Safari", Android carries "Linux".
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
	[/\bEdg(?:e|A|iOS)?\//, 'Edge'],
	[/\b(?:OPR|Opera)\//, 'Opera'],
	[/\bFirefox\/|\bFxiOS\//, 'Firefox'],
	[/\bChrome\/|\bCriOS\//, 'Chrome'],
	[/\bSafari\//, 'Safari'],
];

const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
	[/\biPhone|\biPad|\biPod/, 'iOS'],
	[/\bAndroid\b/, 'Android'],
	[/\bCrOS\b/, 'ChromeOS'],
	[/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
	[/\bWindows\b/, 'Windows'],
	[/\bLinux\b/, 'Linux'],
];

/**
 * A short label for a user agent, such as `Chrome on macOS`, or `undefined` when nothing in it
 * is recognised. The rest of the user agent is dropped.
 */
export function deviceLabel(userAgent: string | null | undefined): string | undefined {
	if (!userAgent) return undefined;
	const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
	const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
	if (browser && system) return `${browser} on ${system}`;
	return browser ?? system;
}

/** A `Date` from a provider's date, which arrives as a `Date` or as its JSON string. */
export function toDate(value: string | number | Date): Date {
	return value instanceof Date ? value : new Date(value);
}

/** Whether WebAuthn is available in this environment. */
export function hasWebAuthn(): boolean {
	return (
		typeof globalThis.PublicKeyCredential === 'function' &&
		typeof globalThis.navigator?.credentials?.get === 'function'
	);
}

/**
 * Whether the browser can offer passkeys in its autofill (WebAuthn's conditional mediation).
 * Missing or false means a `{ autoFill: true }` ceremony would never be offered.
 */
export async function hasConditionalMediation(): Promise<boolean> {
	const credential = globalThis.PublicKeyCredential as
		| { isConditionalMediationAvailable?: () => Promise<boolean> }
		| undefined;
	try {
		return (await credential?.isConditionalMediationAvailable?.()) === true;
	} catch {
		return false;
	}
}
