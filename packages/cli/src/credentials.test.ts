import { describe, expect, it } from 'vitest';
import {
	HEADERS_ENV,
	parseHeader,
	redactUrl,
	resolveHeaders,
	urlHasCredentials,
} from './credentials.js';

describe('parseHeader', () => {
	it('splits "Name: value" on the first colon and trims both sides', () => {
		expect(parseHeader('Authorization: Bearer abc:def')).toEqual([
			'Authorization',
			'Bearer abc:def',
		]);
		expect(parseHeader('  X-Api-Key :k ')).toEqual(['X-Api-Key', 'k']);
		expect(parseHeader('X-Empty:')).toEqual(['X-Empty', '']);
	});

	it('rejects a missing colon, an invalid name, or a line break in the value', () => {
		expect(() => parseHeader('Authorization Bearer abc')).toThrow('Use "Name: value"');
		expect(() => parseHeader(': value')).toThrow('Use "Name: value"');
		expect(() => parseHeader('Bad Name: value')).toThrow('Use "Name: value"');
		expect(() => parseHeader('X-Test: a\r\nInjected: b')).toThrow('holds a line break');
	});
});

describe('resolveHeaders', () => {
	it('reads one header per line from AFD_HEADERS', () => {
		const env = { [HEADERS_ENV]: 'Authorization: Bearer env\r\n\n  X-Tenant: acme  \n' };
		expect(resolveHeaders([], env)).toEqual({ Authorization: 'Bearer env', 'X-Tenant': 'acme' });
	});

	it('lets --header replace an environment header of the same name, in any case', () => {
		const env = { [HEADERS_ENV]: 'authorization: Bearer env' };
		expect(resolveHeaders(['Authorization: Bearer flag', 'X-One: 1'], env)).toEqual({
			Authorization: 'Bearer flag',
			'X-One': '1',
		});
	});

	it('returns no headers by default and names the source of a malformed one', () => {
		expect(resolveHeaders(undefined, {})).toEqual({});
		expect(() => resolveHeaders([], { [HEADERS_ENV]: 'nonsense' })).toThrow(
			/^AFD_HEADERS line 1: Invalid header/
		);
		expect(() => resolveHeaders(['nonsense'], {})).toThrow(/^--header 1: Invalid header/);
	});
});

describe('redactUrl', () => {
	it('returns a URL without credentials unchanged', () => {
		for (const url of [
			'http://localhost:3100/sse',
			'http://HOST:3100/message?page=2&sort=name%20asc',
			'https://example.com/#section',
		]) {
			expect(redactUrl(url)).toBe(url);
			expect(urlHasCredentials(url)).toBe(false);
		}
	});

	it('redacts userinfo', () => {
		expect(redactUrl('https://alice:s3cret@example.com/sse')).toBe('https://***@example.com/sse');
		expect(redactUrl('https://tokenonly@example.com/sse')).toBe('https://***@example.com/sse');
		expect(urlHasCredentials('https://alice:s3cret@example.com/sse')).toBe(true);
	});

	it('redacts token-like query and fragment parameters, whatever their case', () => {
		expect(
			redactUrl('http://h/sse?token=abc&page=2&API_KEY=k1&client_secret=s&auth=a&Password=p')
		).toBe('http://h/sse?token=***&page=2&API_KEY=***&client_secret=***&auth=***&Password=***');
		expect(redactUrl('http://h/cb#access_token=abc&state=1')).toBe(
			'http://h/cb#access_token=***&state=1'
		);
		expect(redactUrl('http://h/sse?access%5Ftoken=abc&flag')).toBe(
			'http://h/sse?access%5Ftoken=***&flag'
		);
		expect(redactUrl('http://h/sse?%E0%A4%A=1')).toBe('http://h/sse?%E0%A4%A=1');
	});

	it('still hides userinfo in text that is not a parseable URL', () => {
		expect(redactUrl('//alice:pw@host/path')).toBe('//***@host/path');
		expect(redactUrl('not a url')).toBe('not a url');
		expect(urlHasCredentials('not a url')).toBe(false);
	});
});

describe('a malformed header is never repeated (#1836)', () => {
	const SECRET = 'sk-SECRET';
	it.each([
		[['Authorization Bearer sk-SECRET'], '', '--header 1'],
		[['X-Ok: 1', 'Bad Name: sk-SECRET'], '', '--header 2'],
		[[], 'X-Ok: 1\n\nAuthorisation Bearer sk-SECRET', 'AFD_HEADERS line 3'],
		[['Authorization: Bearer sk-\vSECRET'], '', '--header 1'],
		[['Authorization: Bearer sk-SECRET\rX: y'], '', '--header 1'],
		[['sk-SECRET: a\u0000b'], '', '--header 1'],
		[['X: sk-\u2028SECRET'], '', '--header 1'],
		[[], 'Authorization: Bearer sk-\vSECRET', 'AFD_HEADERS line 1'],
	])('%j with AFD_HEADERS %j names %s only', (flags, env, source) => {
		let message = '';
		try {
			resolveHeaders(flags, { [HEADERS_ENV]: env });
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message.startsWith(`${source}: Invalid header`)).toBe(true);
		expect(message).not.toContain(SECRET);
		expect(message).not.toContain('SECRET');
	});

	it('accepts tabs and Latin-1 in a value', () => {
		expect(parseHeader('X-Note: a\tb caf\u00e9')).toEqual(['X-Note', 'a\tb caf\u00e9']);
	});

	it.each([
		['\u007f', false],
		['\u0080', true],
		['\u00ff', true],
		['\u0100', false],
		['\u{1f600}', false],
		['\ud800', false],
	])('a value holding %j is accepted: %s', (char, accepted) => {
		const parse = () => parseHeader(`X: a${char}b`);
		if (accepted) expect(parse()).toEqual(['X', `a${char}b`]);
		else expect(parse).toThrow('holds a line break or another character');
	});

	it('trims only spaces and tabs, so a trailing control character is refused, not dropped', () => {
		expect(parseHeader(' \tX-Key \t:  \t v \t ')).toEqual(['X-Key', 'v']);
		expect(() => parseHeader('X: secret\v')).toThrow('holds a line break');
		expect(() => parseHeader('X: secret\u2028')).toThrow('holds a line break');
		expect(() => parseHeader('\vX: v')).toThrow('Use "Name: value"');
		expect(parseHeader('X: tok\u00a0')).toEqual(['X', 'tok\u00a0']);
		expect(() => parseHeader('X: secret\n')).toThrow('holds a line break');
		expect(() => parseHeader('X\n: v')).toThrow('Use "Name: value"');
	});

	it('reports an AFD_HEADERS line holding only a control character by its number', () => {
		expect(() => resolveHeaders([], { [HEADERS_ENV]: 'X: 1\n\u000b' })).toThrow(
			/^AFD_HEADERS line 2: Invalid header/
		);
	});
});
