/** TEST ONLY OAuth authorization-code/PKCE provider. No Better Auth endpoints are mocked. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';

export async function startOAuthProvider() {
	const codes = new Map<string, { redirect: string; challenge: string }>();
	const tokens = new Set<string>();
	let callbackURL = '';
	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url ?? '/', origin);
			if (url.pathname === '/authorize') {
				const redirect = url.searchParams.get('redirect_uri');
				const state = url.searchParams.get('state');
				const challenge = url.searchParams.get('code_challenge');
				if (
					redirect !== callbackURL ||
					!state ||
					!challenge ||
					url.searchParams.get('code_challenge_method') !== 'S256' ||
					url.searchParams.get('client_id') !== 'afd-local-client'
				) {
					response.writeHead(400).end('Invalid test authorization request');
					return;
				}
				if (!url.searchParams.has('decision')) {
					// Forms preserve OAuth fields; no identity-provider account/credential is used.
					const action = '/authorize';
					const fields = [...url.searchParams]
						.map(
							([name, value]) =>
								`<input type="hidden" name="${escapeHTML(name)}" value="${escapeHTML(value)}">`
						)
						.join('');
					response
						.writeHead(200, { 'content-type': 'text/html' })
						.end(
							`<title>TEST ONLY OAuth provider</title><h1>Test OAuth authorization</h1><form action="${action}">${fields}<button name="decision" value="allow" id="allow">Authorize synthetic test user</button><button name="decision" value="deny" id="deny">Deny</button></form>`
						);
					return;
				}
				const destination = new URL(redirect);
				destination.searchParams.set('state', state);
				if (url.searchParams.get('decision') === 'deny')
					destination.searchParams.set('error', 'access_denied');
				else {
					const code = randomBytes(24).toString('base64url');
					codes.set(code, { redirect, challenge });
					destination.searchParams.set('code', code);
				}
				response.writeHead(302, { location: destination.href }).end();
				return;
			}
			if (url.pathname === '/token' && request.method === 'POST') {
				let body = '';
				for await (const chunk of request) {
					body += chunk;
					if (body.length > 8192) throw new Error('Oversize');
				}
				const form = new URLSearchParams(body);
				const code = form.get('code') ?? '';
				const saved = codes.get(code);
				codes.delete(code);
				const hash = createHash('sha256')
					.update(form.get('code_verifier') ?? '')
					.digest('base64url');
				const credentials =
					request.headers.authorization ===
						`Basic ${Buffer.from('afd-local-client:afd-local-secret').toString('base64')}` ||
					(form.get('client_id') === 'afd-local-client' &&
						form.get('client_secret') === 'afd-local-secret');
				if (
					!saved ||
					form.get('grant_type') !== 'authorization_code' ||
					saved.redirect !== form.get('redirect_uri') ||
					hash.length !== saved.challenge.length ||
					!timingSafeEqual(Buffer.from(hash), Buffer.from(saved.challenge)) ||
					!credentials
				) {
					response
						.writeHead(400, { 'content-type': 'application/json' })
						.end('{"error":"invalid_grant"}');
					return;
				}
				const token = randomBytes(24).toString('base64url');
				tokens.add(token);
				response
					.writeHead(200, { 'content-type': 'application/json' })
					.end(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 300 }));
				return;
			}
			if (
				url.pathname === '/userinfo' &&
				tokens.has((request.headers.authorization ?? '').replace(/^Bearer /, ''))
			) {
				response.writeHead(200, { 'content-type': 'application/json' }).end(
					JSON.stringify({
						id: 'afd-local-synthetic',
						email: 'oauth@example.test',
						email_verified: true,
						name: 'AFD OAuth Fixture',
					})
				);
				return;
			}
			response.writeHead(401).end();
		} catch {
			response.writeHead(500).end('Test provider failure');
		}
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening', { signal: AbortSignal.timeout(5000) });
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Missing test provider address');
	const origin = `http://127.0.0.1:${address.port}`;
	return {
		origin,
		registerCallback(url: string) {
			callbackURL = url;
		},
		async close() {
			codes.clear();
			tokens.clear();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
function escapeHTML(value: string) {
	return value.replace(
		/[&<>"']/g,
		(char) =>
			({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char
	);
}
