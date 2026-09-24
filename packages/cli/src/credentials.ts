/**
 * @fileoverview Request headers and credential redaction.
 *
 * Credentials reach the server as request headers, from `--header` or the
 * `AFD_HEADERS` environment variable. Headers are never written to the config
 * file. Anything that prints a server URL redacts the credentials a URL can
 * carry: userinfo and token-like query parameters.
 */

/** Environment variable holding request headers, one `Name: value` per line. */
export const HEADERS_ENV = 'AFD_HEADERS';

/** RFC 9110 token characters, the only ones allowed in a header name. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Query/fragment parameter names whose values are redacted when a URL is printed. */
const SENSITIVE_PARAM = /token|key|secret|auth|pass(word)?|signature|credential/i;

const REDACTED = '***';

/**
 * Parse one `Name: value` header. Throws an `Error` whose message explains the
 * expected form when the name is not a valid HTTP token or the value contains a
 * line break.
 */
export function parseHeader(header: string): [name: string, value: string] {
	const colon = header.indexOf(':');
	const name = colon === -1 ? '' : header.slice(0, colon).trim();
	if (!name || !HEADER_NAME.test(name)) {
		throw new Error(
			`Invalid header "${header}". Use "Name: value", e.g. "Authorization: Bearer <token>".`
		);
	}
	const value = header.slice(colon + 1).trim();
	if (/[\r\n\0]/.test(value)) {
		throw new Error(`Invalid header "${name}": the value must not contain line breaks.`);
	}
	return [name, value];
}

/**
 * Headers for a connection: those from {@link HEADERS_ENV} (one per line), then
 * each `--header` flag. A flag replaces an environment header with the same
 * name (compared case-insensitively). Throws on a malformed header.
 */
export function resolveHeaders(
	flags: readonly string[] = [],
	env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
	const lines = (env[HEADERS_ENV] ?? '').split(/\r?\n/).filter((line) => line.trim() !== '');
	const byName = new Map<string, [string, string]>();
	for (const [source, header] of [
		...lines.map((line) => [HEADERS_ENV, line] as const),
		...flags.map((flag) => ['--header', flag] as const),
	]) {
		try {
			const [name, value] = parseHeader(header);
			byName.set(name.toLowerCase(), [name, value]);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`${source}: ${reason}`);
		}
	}
	return Object.fromEntries(byName.values());
}

function redactParams(params: string): string {
	return params
		.split('&')
		.map((param) => {
			const equals = param.indexOf('=');
			if (equals === -1) return param;
			const rawName = param.slice(0, equals);
			let name = rawName;
			try {
				name = decodeURIComponent(rawName.replace(/\+/g, ' '));
			} catch {
				// Keep the raw name when it is not valid percent-encoding.
			}
			return SENSITIVE_PARAM.test(name) ? `${rawName}=${REDACTED}` : param;
		})
		.join('&');
}

function redact(url: string): { url: string; redacted: boolean } {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		// Not a URL we can parse; still hide anything shaped like `//user:pass@`.
		const replaced = url.replace(/\/\/[^/?#@]*@/, `//${REDACTED}@`);
		return { url: replaced, redacted: replaced !== url };
	}
	let redacted = false;
	if (parsed.username !== '' || parsed.password !== '') {
		parsed.username = REDACTED;
		parsed.password = '';
		redacted = true;
	}
	for (const part of ['search', 'hash'] as const) {
		const params = parsed[part].slice(1);
		const safe = redactParams(params);
		if (safe !== params) {
			parsed[part] = safe;
			redacted = true;
		}
	}
	return { url: redacted ? parsed.toString() : url, redacted };
}

/**
 * The URL with its credentials replaced by `***`: the userinfo, and the values
 * of query or fragment parameters whose names look like credentials (`token`,
 * `api_key`, `secret`, `auth`, `password`, ...). A URL without credentials is
 * returned unchanged.
 */
export function redactUrl(url: string): string {
	return redact(url).url;
}

/** Whether printing or saving `url` would expose a credential. */
export function urlHasCredentials(url: string): boolean {
	return redact(url).redacted;
}
