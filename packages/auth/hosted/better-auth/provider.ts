/** Disposable, deployable Better Auth application. Never use a production database. */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer as httpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { DatabaseSync } from 'node:sqlite';
import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { toNodeHandler } from 'better-auth/node';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';

export interface FixtureConfig {
	origin: string;
	host: string;
	port: number;
	databasePath: string;
	secret: string;
	controlKey: string;
	providerId: string;
	expectedEmail: string;
	revision: string;
	assetPath: string;
	clientId: string;
	clientSecret: string;
	discoveryURL?: string;
	issuer?: string;
	localOAuthOrigin?: string;
	certificatePath?: string;
	privateKeyPath?: string;
	expiresIn: number;
	updateAge: number;
}
export async function startFixture(config: FixtureConfig) {
	if (config.secret.length < 32 || config.controlKey.length < 32)
		throw new Error('Fixture secrets need at least 32 characters');
	const script = await readFile(config.assetPath);
	const providerVersion = JSON.parse(
		await readFile(new URL('../package.json', import.meta.resolve('better-auth')), 'utf8')
	).version as string;
	const database = new DatabaseSync(config.databasePath);
	database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
	const options: BetterAuthOptions = {
		baseURL: config.origin,
		secret: config.secret,
		database,
		trustedOrigins: [config.origin],
		session: {
			expiresIn: config.expiresIn,
			updateAge: config.updateAge,
			cookieCache: { enabled: false },
		},
		advanced: { useSecureCookies: true },
		logger: { disabled: true },
		plugins: [
			genericOAuth({
				config: [
					{
						providerId: config.providerId,
						clientId: config.clientId,
						clientSecret: config.clientSecret,
						pkce: true,
						prompt: 'consent',
						scopes: config.localOAuthOrigin ? ['email', 'profile'] : ['openid', 'email', 'profile'],
						...(config.localOAuthOrigin
							? {
									authorizationUrl: `${config.localOAuthOrigin}/authorize`,
									tokenUrl: `${config.localOAuthOrigin}/token`,
									userInfoUrl: `${config.localOAuthOrigin}/userinfo`,
									accountIssuer: config.localOAuthOrigin,
								}
							: { discoveryUrl: config.discoveryURL, requireIdTokenVerification: true }),
					},
				],
			}),
		],
	};
	try {
		await (await getMigrations(options)).runMigrations();
		const auth = betterAuth(options);
		const authHandler = toNodeHandler(auth);
		const instanceId = randomUUID();
		const captures = new Map<
			string,
			{ cookie: string; sessionId: string; userId: string; until: number; timer: NodeJS.Timeout }
		>();
		const MAX_CAPTURES = 4;
		const MAX_BODY_BYTES = 128;
		let cleanupEpoch = 0;
		let closing = false;
		function clearCaptures() {
			for (const capture of captures.values()) clearTimeout(capture.timer);
			captures.clear();
		}
		function sessionCookie(header: string) {
			const cookies = header.split(';').map((part) => part.trim());
			const matches = cookies.filter((part) =>
				/^(__Secure-|__Host-)?better-auth\.session_token=[^\s;]+$/.test(part)
			);
			return matches.length === 1 ? matches[0] : undefined;
		}
		async function body(request: IncomingMessage) {
			let length = 0;
			const chunks: Buffer[] = [];
			for await (const chunk of request) {
				length += chunk.length;
				if (length > MAX_BODY_BYTES) throw new Error('Oversize probe request');
				chunks.push(chunk);
			}
			return Buffer.concat(chunks).toString('utf8');
		}
		const handler = (request: IncomingMessage, response: ServerResponse) => {
			void handle(request, response).catch(() => {
				if (!response.headersSent) response.writeHead(500);
				response.end('Fixture request failed');
			});
		};
		async function handle(request: IncomingMessage, response: ServerResponse) {
			const url = new URL(request.url ?? '/', config.origin);
			if (url.pathname.startsWith('/api/auth/')) {
				await authHandler(request, response);
				return;
			}
			response.setHeader('cache-control', 'no-store');
			const json = (data: unknown) => {
				response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));
			};
			if (url.pathname === '/harness/probe/capture' || url.pathname === '/harness/probe/verify') {
				const reject = (status: number) => response.writeHead(status).end();
				if (
					request.method !== 'POST' ||
					request.headers.origin !== config.origin ||
					url.search ||
					Number(request.headers['content-length'] ?? 0) > MAX_BODY_BYTES
				) {
					reject(403);
					return;
				}
				for (const [key, capture] of captures)
					if (capture.until <= Date.now()) {
						clearTimeout(capture.timer);
						captures.delete(key);
					}
				let input: string;
				try {
					input = await body(request);
				} catch {
					reject(413);
					return;
				}
				if (url.pathname.endsWith('/capture')) {
					if (input || captures.size >= MAX_CAPTURES) {
						reject(400);
						return;
					}
					const cookie = sessionCookie(request.headers.cookie ?? '');
					if (!cookie) {
						reject(403);
						return;
					}
					const epoch = cleanupEpoch;
					const current = await auth.api.getSession({
						headers: new Headers({ cookie }),
						query: { disableCookieCache: true },
					});
					if (
						!current ||
						current.user.email !== config.expectedEmail ||
						epoch !== cleanupEpoch ||
						closing
					) {
						reject(403);
						return;
					}
					// No await between this capacity check and insertion.
					if (captures.size >= MAX_CAPTURES) {
						reject(400);
						return;
					}
					const handle = randomUUID();
					const until = Math.min(
						Date.now() + 315_000,
						current.session.expiresAt.getTime() + 15_000
					);
					if (!Number.isFinite(until) || until <= Date.now()) {
						reject(403);
						return;
					}
					const timer = setTimeout(() => captures.delete(handle), Math.max(0, until - Date.now()));
					timer.unref();
					captures.set(handle, {
						cookie,
						sessionId: current.session.id,
						userId: current.user.id,
						until,
						timer,
					});
					json({ handle });
					return;
				}
				let parsed: unknown;
				try {
					parsed = JSON.parse(input);
				} catch {
					reject(400);
					return;
				}
				if (
					typeof parsed !== 'object' ||
					parsed === null ||
					Object.keys(parsed).length !== 1 ||
					!('handle' in parsed) ||
					typeof parsed.handle !== 'string' ||
					!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.handle)
				) {
					reject(400);
					return;
				}
				const capture = captures.get(parsed.handle);
				captures.delete(parsed.handle);
				if (capture) clearTimeout(capture.timer);
				if (!capture || capture.until <= Date.now()) {
					reject(404);
					return;
				}
				const replayed = await auth.api.getSession({
					headers: new Headers({ cookie: capture.cookie }),
					query: { disableCookieCache: true },
				});
				json({
					rejected: !replayed,
					sameSession:
						replayed?.session.id === capture.sessionId && replayed.user.id === capture.userId,
				});
				return;
			}
			if (url.pathname === '/harness/info') {
				json({
					instanceId,
					providerVersion,
					providerId: config.providerId,
					revision: config.revision,
					expiresIn: config.expiresIn,
					updateAge: config.updateAge,
					topology: 'same-origin',
					persistentStore: 'sqlite',
					providerKind: config.localOAuthOrigin
						? 'test-only-local-oauth-pkce'
						: 'configured-external-oidc',
				});
				return;
			}
			if (url.pathname === '/harness/session') {
				const data = await auth.api.getSession({
					headers: new Headers({ cookie: request.headers.cookie ?? '' }),
					query: { disableCookieCache: true },
				});
				json(
					data
						? {
								id: data.session.id,
								userId: data.user.id,
								email: data.user.email,
								expiresAt: data.session.expiresAt.getTime(),
								expectedIdentityMatch: data.user.email === config.expectedEmail,
							}
						: null
				);
				return;
			}
			if (url.pathname === '/harness/cleanup' && request.method === 'POST') {
				const key = (request.headers.authorization ?? '').replace(/^Bearer /, '');
				if (
					key.length !== config.controlKey.length ||
					!timingSafeEqual(Buffer.from(key), Buffer.from(config.controlKey))
				) {
					response.writeHead(403).end();
					return;
				}
				// An authorized cleanup invalidates all outstanding probes, including
				// captures awaiting asynchronous session validation.
				cleanupEpoch++;
				clearCaptures();
				// Fixture is dedicated. Only the configured synthetic identity is ever removed.
				const user = database
					.prepare('SELECT id FROM user WHERE email = ?')
					.get(config.expectedEmail);
				if (user) {
					database.exec('BEGIN IMMEDIATE');
					try {
						for (const table of ['session', 'account'])
							database.prepare(`DELETE FROM ${table} WHERE userId = ?`).run(String(user.id));
						database.prepare('DELETE FROM user WHERE id = ?').run(String(user.id));
						database.exec('COMMIT');
					} catch {
						database.exec('ROLLBACK');
						throw new Error('Cleanup failed');
					}
				}
				const remaining = database
					.prepare('SELECT COUNT(*) AS count FROM user WHERE email = ?')
					.get(config.expectedEmail);
				json({ removed: Number(remaining?.count) === 0 });
				return;
			}
			if (url.pathname === '/fixture.js') {
				response.writeHead(200, { 'content-type': 'text/javascript' }).end(script);
				return;
			}
			if (url.pathname === '/') {
				response
					.writeHead(200, { 'content-type': 'text/html' })
					.end(
						'<!doctype html><html lang="en"><title>Disposable AFD Better Auth harness</title><h1>Disposable authentication test</h1><button id="oauth">Continue with configured OAuth provider</button><button id="refresh">Refresh session</button><button id="sign-out">Sign out</button><button id="probe-capture">Capture current session for replay</button><button id="probe-verify">Verify captured session</button><output id="probe-status" aria-live="polite"></output><div id="root"></div><script type="module" src="/fixture.js"></script></html>'
					);
				return;
			}
			response.writeHead(404).end();
		}
		const server =
			config.certificatePath && config.privateKeyPath
				? httpsServer(
						{
							cert: await readFile(config.certificatePath),
							key: await readFile(config.privateKeyPath),
						},
						handler
					)
				: httpServer(handler);
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(config.port, config.host, resolve);
		});
		return {
			instanceId,
			async close() {
				closing = true;
				cleanupEpoch++;
				clearCaptures();
				server.closeAllConnections();
				await new Promise<void>((resolve) => server.close(() => resolve()));
				database.close();
			},
		};
	} catch (error) {
		database.close();
		throw error;
	}
}
