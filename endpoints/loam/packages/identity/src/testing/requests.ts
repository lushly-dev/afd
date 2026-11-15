/**
 * @fileoverview Direct requests to a provider as one browser makes them (phase 3 specification, 18's E17 and E18):
 * the deployment's origin on every request, a cookie jar, and the passkey ceremonies driven by a software
 * authenticator. A unit calls the provider's own handler through it, around Loam's commands, as a person could.
 */

import type { SoftAuthenticator } from './webauthn.js';

export interface Answer {
	status: number;
	body: Record<string, unknown> | null;
	headers: Headers;
}

type Handler = (request: Request) => Promise<Response>;

/** One browser: its cookies, at one origin. */
export class TestBrowser {
	readonly jar = new Map<string, string>();
	readonly #handler: Handler;
	readonly #origin: string;
	readonly #base: string;

	/** `base` is the provider's path under `origin`, such as `/api/auth`. */
	constructor(handler: Handler, origin: string, base = '/api/auth') {
		this.#handler = handler;
		this.#origin = origin;
		this.#base = base;
	}

	get cookie(): string {
		return [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
	}

	/** The session cookie's value, or undefined signed out. */
	get session(): string | undefined {
		return [...this.jar].find(([name]) => name.endsWith('session_token'))?.[1];
	}

	#keep(response: Response): void {
		for (const line of response.headers.getSetCookie()) {
			const [pair = '', ...attributes] = line.split(';');
			const at = pair.indexOf('=');
			const name = pair.slice(0, at).trim();
			const value = pair.slice(at + 1).trim();
			const gone =
				value === '' || attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
			if (gone) this.jar.delete(name);
			else this.jar.set(name, value);
		}
	}

	/** A request to `<base><path>`: `GET` with no body, else `POST` with JSON. */
	async call(
		path: string,
		options: {
			body?: unknown;
			method?: string;
			origin?: string;
			headers?: Record<string, string>;
		} = {}
	): Promise<Answer> {
		const url = path.startsWith('http') ? path : `${this.#origin}${this.#base}${path}`;
		return this.fetch(url, options);
	}

	/** Any URL, with this browser's cookies when it is the provider's origin. */
	async fetch(
		url: string,
		options: {
			body?: unknown;
			method?: string;
			origin?: string;
			headers?: Record<string, string>;
		} = {}
	): Promise<Answer> {
		const response = await this.#handler(
			new Request(url, {
				method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
				redirect: 'manual',
				headers: {
					origin: options.origin ?? this.#origin,
					...(this.jar.size ? { cookie: this.cookie } : {}),
					...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
					...options.headers,
				},
				...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
			})
		);
		this.#keep(response);
		const text = await response.text();
		const json = response.headers.get('content-type')?.includes('json');
		return {
			status: response.status,
			body: text && json ? (JSON.parse(text) as Record<string, unknown>) : null,
			headers: response.headers,
		};
	}

	/** Sign in with a password. */
	signIn(email: string, password: string): Promise<Answer> {
		return this.call('/sign-in/email', { body: { email, password } });
	}

	/** Register a passkey: options, with `context` when given, then verification. */
	async registerPasskey(
		authenticator: SoftAuthenticator,
		options: { context?: string; createSession?: boolean; name?: string } = {}
	): Promise<{ options: Answer; verified?: Answer }> {
		const query = options.context ? `?context=${encodeURIComponent(options.context)}` : '';
		const made = await this.call(`/passkey/generate-register-options${query}`);
		if (made.status !== 200) return { options: made };
		const response = authenticator.create(made.body as never);
		const verified = await this.call('/passkey/verify-registration', {
			body: {
				response,
				...(options.createSession !== undefined ? { createSession: options.createSession } : {}),
				...(options.name ? { name: options.name } : {}),
			},
		});
		return { options: made, verified };
	}

	/** Sign in with a passkey the authenticator holds. */
	async signInWithPasskey(authenticator: SoftAuthenticator): Promise<Answer> {
		const made = await this.call('/passkey/generate-authenticate-options');
		if (made.status !== 200) return made;
		return this.call('/passkey/verify-authentication', {
			body: { response: authenticator.get(made.body as never) },
		});
	}
}

/** A link's query, read from the mail the provider sent. */
export function linkIn(text: string): URL {
	const found = /https?:\/\/\S+/.exec(text);
	if (!found) throw new Error('No link in the message');
	return new URL(found[0]);
}
