/**
 * @fileoverview A software passkey authenticator for tests (phase 3 specification, 18's E17 and E18): it answers a
 * provider's registration and authentication options as a platform authenticator would, with `none` attestation, an
 * ES256 key made per credential, and the user-presence and user-verification flags the test chooses. It lets a unit
 * drive the passkey plugin's two-request ceremonies by direct requests, as a person's browser would, with no browser.
 * It is not a real authenticator and proves nothing of one; the Chromium scenarios use Chromium's virtual one.
 */

import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from 'node:crypto';

/** A minimal CBOR encoder: unsigned and negative integers, byte and text strings, arrays and maps. */
function cbor(value: unknown): Buffer {
	const head = (major: number, length: number): Buffer => {
		if (length < 24) return Buffer.from([(major << 5) | length]);
		if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
		if (length < 0x10000) {
			const out = Buffer.alloc(3);
			out[0] = (major << 5) | 25;
			out.writeUInt16BE(length, 1);
			return out;
		}
		const out = Buffer.alloc(5);
		out[0] = (major << 5) | 26;
		out.writeUInt32BE(length, 1);
		return out;
	};
	if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
	if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
		const bytes = Buffer.from(value);
		return Buffer.concat([head(2, bytes.length), bytes]);
	}
	if (typeof value === 'string') {
		const bytes = Buffer.from(value, 'utf8');
		return Buffer.concat([head(3, bytes.length), bytes]);
	}
	if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
	if (value instanceof Map) {
		const parts: Buffer[] = [head(5, value.size)];
		for (const [key, item] of value) parts.push(cbor(key), cbor(item));
		return Buffer.concat(parts);
	}
	throw new Error(`cbor: cannot encode ${typeof value}`);
}

const b64url = (bytes: Buffer): string => bytes.toString('base64url');
const sha256 = (data: Buffer | string): Buffer => createHash('sha256').update(data).digest();

/** A credential the authenticator holds: its id, its key, its user handle and its counter. */
export interface SoftCredentialV1 {
	id: Buffer;
	key: KeyObject;
	userHandle: string;
	rpId: string;
	counter: number;
}

export interface SoftAuthenticatorOptions {
	/** The page's origin, which `clientDataJSON` names. */
	origin: string;
	/** Default true: the authenticator verified the person (the UV flag). */
	userVerified?: boolean;
}

interface RegistrationOptionsJSON {
	challenge: string;
	rp: { id?: string; name: string };
	user: { id: string; name: string; displayName: string };
}

interface AuthenticationOptionsJSON {
	challenge: string;
	rpId?: string;
	allowCredentials?: { id: string }[];
}

/** A software authenticator: `create` answers registration options, `get` authentication options. */
export class SoftAuthenticator {
	readonly credentials: SoftCredentialV1[] = [];
	readonly #origin: string;
	userVerified: boolean;

	constructor(options: SoftAuthenticatorOptions) {
		this.#origin = options.origin;
		this.userVerified = options.userVerified ?? true;
	}

	#flags(attested: boolean): number {
		// UP, UV when verified, AT when a credential is attested.
		return 0x01 | (this.userVerified ? 0x04 : 0) | (attested ? 0x40 : 0);
	}

	#clientData(type: string, challenge: string): Buffer {
		return Buffer.from(
			JSON.stringify({ type, challenge, origin: this.#origin, crossOrigin: false }),
			'utf8'
		);
	}

	/** `navigator.credentials.create`'s answer, as `@simplewebauthn/browser` sends it. */
	create(options: RegistrationOptionsJSON) {
		const rpId = options.rp.id ?? new URL(this.#origin).hostname;
		const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
		const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
		const id = randomBytes(32);
		const cose = new Map<number, unknown>([
			[1, 2],
			[3, -7],
			[-1, 1],
			[-2, Buffer.from(jwk.x, 'base64url')],
			[-3, Buffer.from(jwk.y, 'base64url')],
		]);
		const counter = Buffer.alloc(4);
		const length = Buffer.alloc(2);
		length.writeUInt16BE(id.length);
		const authData = Buffer.concat([
			sha256(rpId),
			Buffer.from([this.#flags(true)]),
			counter,
			Buffer.alloc(16),
			length,
			id,
			cbor(cose),
		]);
		const attestationObject = cbor(
			new Map<string, unknown>([
				['fmt', 'none'],
				['attStmt', new Map()],
				['authData', authData],
			])
		);
		this.credentials.push({ id, key: privateKey, userHandle: options.user.id, rpId, counter: 0 });
		return {
			id: b64url(id),
			rawId: b64url(id),
			type: 'public-key',
			authenticatorAttachment: 'platform',
			clientExtensionResults: {},
			response: {
				clientDataJSON: b64url(this.#clientData('webauthn.create', options.challenge)),
				attestationObject: b64url(attestationObject),
				transports: ['internal'],
				publicKeyAlgorithm: -7,
			},
		};
	}

	/** `navigator.credentials.get`'s answer for the credential named, or the one made last. */
	get(options: AuthenticationOptionsJSON, credential?: SoftCredentialV1) {
		const allowed = options.allowCredentials?.map((held) => held.id) ?? [];
		const chosen =
			credential ??
			[...this.credentials]
				.reverse()
				.find((held) => allowed.length === 0 || allowed.includes(b64url(held.id)));
		if (!chosen) throw new Error('The authenticator holds no credential the options allow');
		chosen.counter += 1;
		const counter = Buffer.alloc(4);
		counter.writeUInt32BE(chosen.counter);
		const authData = Buffer.concat([
			sha256(options.rpId ?? chosen.rpId),
			Buffer.from([this.#flags(false)]),
			counter,
		]);
		const clientData = this.#clientData('webauthn.get', options.challenge);
		const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), {
			key: chosen.key,
			dsaEncoding: 'der',
		});
		return {
			id: b64url(chosen.id),
			rawId: b64url(chosen.id),
			type: 'public-key',
			authenticatorAttachment: 'platform',
			clientExtensionResults: {},
			response: {
				clientDataJSON: b64url(clientData),
				authenticatorData: b64url(authData),
				signature: b64url(signature),
				// `user.id` is already base64url of the handle's bytes, as the options carry it.
				userHandle: chosen.userHandle,
			},
		};
	}
}
