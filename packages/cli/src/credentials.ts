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

/**
 * RFC 9110 field-value characters: tab, visible ASCII and space, and obs-text
 * (0x80-0xFF). Anything else is refused before the request, with a message that
 * does not repeat it. (Undici refuses some such values itself, and its errors for
 * CR, LF and NUL repeat the value; it accepts others, such as a vertical tab.)
 */
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;

/** HTTP's optional whitespace (RFC 9110 OWS): only space and tab are trimmed. */
function trimOws(text: string): string {
	return text.replace(/^[ \t]+|[ \t]+$/g, '');
}

/** Query/fragment parameter names whose values are redacted when a URL is printed. */
const SENSITIVE_PARAM =
	/^(?:code|assertion|jwt)$|token|key|secret|auth|pass(word)?|signature|credential|code_verifier/i;

/** OAuth-specific query/fragment parameters that must never be persisted to config.json (M9.5). */
const OAUTH_URL_PARAM =
	/^(?:code|code_verifier|access_token|refresh_token|id_token|client_secret|assertion|jwt)$/i;

/** Request/response header names whose values are redacted when printed or logged. */
const SENSITIVE_HEADER = /token|secret|auth|key|cookie|credential/i;

const REDACTED = '***';
const HEADER_REDACTED = '[redacted]';

/**
 * Parse one `Name: value` header. Throws an `Error` whose message explains the
 * expected form when the name is not a valid HTTP token, or the value holds a
 * character HTTP does not allow (a line break or another control character).
 * The message never repeats any of the header: a mistyped one is often a
 * credential (`Authorization Bearer sk-...`).
 */
export function parseHeader(header: string): [name: string, value: string] {
	const colon = header.indexOf(':');
	// Only space and tab are trimmed: String.prototype.trim would also drop a vertical
	// tab or U+2028 before the check, and a no-break space (0xA0) that may be part of
	// the value.
	const name = colon === -1 ? '' : trimOws(header.slice(0, colon));
	if (!name || !HEADER_NAME.test(name)) {
		throw new Error(
			'Invalid header. Use "Name: value" with a name of letters, digits and -, e.g. "Authorization: Bearer <token>". The header is not shown, since it may hold a credential.'
		);
	}
	const value = trimOws(header.slice(colon + 1));
	if (!HEADER_VALUE.test(value)) {
		throw new Error(
			'Invalid header: the value holds a line break or another character HTTP does not allow. The header is not shown, since it may hold a credential.'
		);
	}
	return [name, value];
}

/**
 * Headers for a connection: those from {@link HEADERS_ENV} (one per line), then
 * each `--header` flag. A flag replaces an environment header with the same
 * name (compared case-insensitively). Throws on a malformed header; the message
 * names where it came from (`AFD_HEADERS line 3`, counting blank lines, or
 * `--header 2`) and never repeats it.
 */
export function resolveHeaders(
	flags: readonly string[] = [],
	env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
	const lines = (env[HEADERS_ENV] ?? '').split(/\r?\n/);
	const byName = new Map<string, [string, string]>();
	const sources = [
		// Numbered before blank lines are skipped, so the number is the line's own.
		...lines
			.map((line, index) => [`${HEADERS_ENV} line ${index + 1}`, line] as const)
			// Blank means spaces and tabs only, so a control character is refused, not skipped.
			.filter(([, line]) => trimOws(line) !== ''),
		...flags.map((flag, index) => [`--header ${index + 1}`, flag] as const),
	];
	for (const [source, header] of sources) {
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

/**
 * Strip OAuth-specific query/fragment parameters (`code`, `access_token`, `refresh_token`,
 * `id_token`, `code_verifier`, `client_secret`, `assertion`, `jwt`) from `url` before saving it
 * to `config.json` (`spec/authorization.md`, M9.5).
 */
export function stripOAuthUrlCredentials(url: string): { url: string; stripped: boolean } {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return { url, stripped: false };
	}
	let stripped = false;
	const stripPart = (raw: string): string => {
		if (!raw) return '';
		const kept: string[] = [];
		for (const param of raw.split('&')) {
			if (!param) continue;
			const eq = param.indexOf('=');
			const rawName = eq === -1 ? param : param.slice(0, eq);
			let name = rawName;
			try {
				name = decodeURIComponent(rawName.replace(/\+/g, ' '));
			} catch {
				// Keep rawName if malformed percent-encoding.
			}
			if (OAUTH_URL_PARAM.test(name)) {
				stripped = true;
			} else {
				kept.push(param);
			}
		}
		return kept.join('&');
	};
	const nextSearch = stripPart(parsed.search.slice(1));
	const nextHash = stripPart(parsed.hash.slice(1));
	if (!stripped) return { url, stripped: false };
	parsed.search = nextSearch;
	parsed.hash = nextHash;
	return { url: parsed.toString(), stripped: true };
}

/** Whether `headers` already sets an `Authorization` header (case-insensitively). */
export function hasAuthorizationHeader(headers: Readonly<Record<string, string>>): boolean {
	return Object.keys(headers).some((name) => name.toLowerCase() === 'authorization');
}

/**
 * Redact a single header value when its name looks sensitive (`Authorization`,
 * `Proxy-Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`, etc.).
 */
export function redactHeaderValue(name: string, value: string): string {
	return SENSITIVE_HEADER.test(name) ? HEADER_REDACTED : value;
}

/** Return a copy of `headers` with sensitive header values replaced by `[redacted]`. */
export function redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		result[name] = redactHeaderValue(name, value);
	}
	return result;
}

/** Replace any known secret value occurring inside `text` with `[redacted]`. */
export function redactSecrets(text: string, secrets: readonly (string | undefined)[]): string {
	let output = text;
	for (const secret of secrets) {
		if (!secret || secret.length < 4) continue;
		output = output.split(secret).join(HEADER_REDACTED);
	}
	return output;
}
