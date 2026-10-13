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
						'<!doctype html><html lang="en"><title>Disposable AFD Better Auth harness</title><h1>Disposable authentication test</h1><button id="oauth">Continue with configured OAuth provider</button><div id="root"></div><script type="module" src="/fixture.js"></script></html>'
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
