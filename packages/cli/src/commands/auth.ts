/**
 * @fileoverview `afd auth` commands: OAuth 2.1 login, status, refresh and logout
 * (`spec/authorization.md`, M9).
 */

import chalk from 'chalk';
import type { Command } from 'commander';
import ora from 'ora';
import { getConfig } from '../config.js';
import { redactUrl } from '../credentials.js';
import {
	DEFAULT_LOGIN_TIMEOUT_MS,
	loginWithOAuth,
	OAUTH_CLIENT_ID_ENV,
	OAUTH_CLIENT_SECRET_ENV,
	OAUTH_ISSUER_ENV,
	OAuthFlowError,
	resolveOAuthBearerToken,
} from '../oauth-client.js';
import { canonicalResourceUri, EXPIRY_SKEW_SECONDS, isTokenExpiring } from '../oauth-protocol.js';
import { type OutputFormat, printError, printInfo, printSuccess, printWarning } from '../output.js';
import { terminalText } from '../terminal.js';
import {
	clearStoredTokens,
	deleteStoredToken,
	getTokenStorePath,
	listStoredTokens,
	type StoredOAuthTokenSummary,
	TokenStoreError,
} from '../token-store.js';

interface AuthLoginOptions {
	clientId?: string;
	clientSecretFile?: string;
	scope?: string;
	issuer?: string;
	redirectPort?: string;
	browser: boolean;
	offline: boolean;
	timeout: string;
	format: OutputFormat;
}

interface AuthStatusOptions {
	format: OutputFormat;
}

interface AuthLogoutOptions {
	all?: boolean;
}

interface AuthRefreshOptions {
	clientSecretFile?: string;
	issuer?: string;
	format: OutputFormat;
}

function resolveTargetUrl(urlArg: string | undefined): string {
	const url = urlArg ?? getConfig().serverUrl;
	if (!url) {
		printError('Server URL required. Pass <url> or run "afd connect <url>" first.');
		return process.exit(1);
	}
	return url;
}

function printOAuthFailure(prefix: string, error: unknown): void {
	if (error instanceof OAuthFlowError || error instanceof TokenStoreError) {
		printError(`${prefix}: ${error.message}`);
		if (error.suggestion) {
			console.error(chalk.dim('Suggestion:'), terminalText(error.suggestion));
		}
		return;
	}
	printError(prefix, error instanceof Error ? error : new Error(String(error)));
}

function tokenState(
	expiresAt: number | undefined,
	nowSeconds = Math.floor(Date.now() / 1000)
): 'valid' | 'expiring' | 'expired' | 'no-expiry' {
	if (expiresAt === undefined) return 'no-expiry';
	if (nowSeconds >= expiresAt) return 'expired';
	if (isTokenExpiring(expiresAt, nowSeconds, EXPIRY_SKEW_SECONDS)) return 'expiring';
	return 'valid';
}

function printSummaryText(summary: StoredOAuthTokenSummary): void {
	const state = tokenState(summary.expiresAt);
	const stateLabel =
		state === 'valid'
			? chalk.green('valid')
			: state === 'expiring'
				? chalk.yellow('expiring soon')
				: state === 'expired'
					? chalk.red('expired')
					: chalk.dim('no expiry');

	console.log(`  ${chalk.bold(terminalText(redactUrl(summary.resource)))} (${stateLabel})`);
	console.log(`    ${chalk.dim('Issuer:')}        ${terminalText(redactUrl(summary.issuer))}`);
	console.log(`    ${chalk.dim('Client ID:')}     ${terminalText(redactUrl(summary.clientId))}`);
	if (summary.scope) {
		console.log(`    ${chalk.dim('Scopes:')}        ${terminalText(summary.scope)}`);
	}
	if (summary.expiresAt !== undefined) {
		console.log(
			`    ${chalk.dim('Expires:')}       ${terminalText(new Date(summary.expiresAt * 1000).toISOString())}`
		);
	}
	console.log(`    ${chalk.dim('Refresh token:')} ${summary.hasRefreshToken ? 'yes' : 'no'}`);
}

/** Register the `afd auth` command group (`login`, `status`, `refresh`, `logout`). */
export function registerAuthCommand(program: Command): void {
	const authCmd = program
		.command('auth')
		.description('Authenticate with OAuth 2.1 MCP servers (PKCE S256)');

	authCmd
		.command('login')
		.description('Sign in to a protected MCP server via OAuth 2.1 authorization code + PKCE (S256)')
		.argument('[url]', 'MCP server URL (default: the saved connection)')
		.option(
			'--client-id <id>',
			`OAuth client ID or Client ID Metadata Document HTTPS URL (also read from ${OAUTH_CLIENT_ID_ENV})`
		)
		.option(
			'--client-secret-file <path>',
			`Owner-only file holding a pre-registered client secret (or set ${OAUTH_CLIENT_SECRET_ENV})`
		)
		.option('--scope <scopes>', 'Space-separated OAuth scopes to request')
		.option(
			'--issuer <url>',
			`Authorization server issuer (required when using a client secret; also read from ${OAUTH_ISSUER_ENV})`
		)
		.option(
			'--redirect-port <port>',
			'Loopback callback port on 127.0.0.1 (default: ephemeral port)'
		)
		.option('--no-browser', 'Print the authorization URL without opening a browser')
		.option('--no-offline', 'Do not automatically request offline_access when advertised')
		.option(
			'--timeout <ms>',
			'Maximum time to wait for browser authorization in milliseconds',
			String(DEFAULT_LOGIN_TIMEOUT_MS)
		)
		.option('-f, --format <format>', 'Output format (json, text)', 'text')
		.action(async (urlArg: string | undefined, options: AuthLoginOptions) => {
			const targetUrl = resolveTargetUrl(urlArg);
			const loginTimeoutMs = Number.parseInt(options.timeout, 10);
			if (!Number.isFinite(loginTimeoutMs) || loginTimeoutMs <= 0) {
				printError('Invalid --timeout: must be a positive integer in milliseconds.');
				return process.exit(1);
			}
			let redirectPort: number | undefined;
			if (options.redirectPort !== undefined) {
				redirectPort = Number.parseInt(options.redirectPort, 10);
				if (!Number.isInteger(redirectPort) || redirectPort < 1 || redirectPort > 65535) {
					printError('Invalid --redirect-port: must be an integer between 1 and 65535.');
					return process.exit(1);
				}
			}

			const controller = new AbortController();
			const onSignal = () => controller.abort();
			process.on('SIGINT', onSignal);
			process.on('SIGTERM', onSignal);

			const spinner =
				options.format === 'text' ? ora('Discovering OAuth metadata...').start() : null;

			try {
				const result = await loginWithOAuth({
					serverUrl: targetUrl,
					clientId: options.clientId,
					clientSecretFile: options.clientSecretFile,
					scope: options.scope,
					issuer: options.issuer,
					redirectPort,
					noBrowser: options.browser === false || !process.stdin.isTTY || !process.stdout.isTTY,
					offline: options.offline !== false,
					loginTimeoutMs,
					signal: controller.signal,
					onAuthorizationUrl: (authUrl) => {
						spinner?.stop();
						if (options.format === 'json') {
							// Keep stdout clean JSON; print the interactive URL to stderr.
							console.error(
								`Open this URL in your browser to authorize:\n${terminalText(authUrl)}`
							);
						} else {
							printInfo('Open this URL in your browser to authorize:');
							console.log(`  ${terminalText(authUrl)}`);
							console.log();
							spinner?.start('Waiting for browser authorization...');
						}
					},
				});

				spinner?.succeed('Authorized');

				if (options.format === 'json') {
					console.log(
						JSON.stringify(
							{
								success: true,
								registrationMode: result.registrationMode,
								tokenStore: getTokenStorePath(),
								...result.summary,
							},
							null,
							2
						)
					);
				} else {
					console.log();
					printSummaryText(result.summary);
					console.log();
					printInfo(`Tokens stored separately from config in ${getTokenStorePath()}.`);
				}
			} catch (error) {
				spinner?.fail('Authorization failed');
				printOAuthFailure('OAuth login failed', error);
				process.exit(1);
			} finally {
				process.off('SIGINT', onSignal);
				process.off('SIGTERM', onSignal);
			}
		});

	authCmd
		.command('status')
		.description('Show stored OAuth sessions (never prints token values)')
		.argument('[url]', 'Show status for a specific MCP server URL')
		.option('-f, --format <format>', 'Output format (json, text)', 'text')
		.action((urlArg: string | undefined, options: AuthStatusOptions) => {
			try {
				const all = listStoredTokens();
				const entries = urlArg
					? all.filter((entry) => {
							try {
								return entry.resource === canonicalResourceUri(urlArg);
							} catch {
								return entry.resource === urlArg;
							}
						})
					: all;

				if (options.format === 'json') {
					const now = Math.floor(Date.now() / 1000);
					console.log(
						JSON.stringify(
							{
								tokenStore: getTokenStorePath(),
								sessions: entries.map((entry) => ({
									...entry,
									state: tokenState(entry.expiresAt, now),
								})),
							},
							null,
							2
						)
					);
					return;
				}

				if (entries.length === 0) {
					printInfo(
						urlArg
							? `No stored OAuth session for ${redactUrl(urlArg)}.`
							: 'No stored OAuth sessions.'
					);
					return;
				}

				console.log(chalk.bold(`Stored OAuth Sessions (${entries.length}):`));
				console.log();
				for (const entry of entries) {
					printSummaryText(entry);
					console.log();
				}
			} catch (error) {
				printOAuthFailure('Could not read OAuth status', error);
				process.exit(1);
			}
		});

	authCmd
		.command('refresh')
		.description('Refresh the stored OAuth access token for an MCP server')
		.argument('[url]', 'MCP server URL (default: the saved connection)')
		.option(
			'--client-secret-file <path>',
			`Owner-only file holding a pre-registered client secret (or set ${OAUTH_CLIENT_SECRET_ENV})`
		)
		.option(
			'--issuer <url>',
			`Expected authorization server issuer (required for confidential clients; also read from ${OAUTH_ISSUER_ENV})`
		)
		.option('-f, --format <format>', 'Output format (json, text)', 'text')
		.action(async (urlArg: string | undefined, options: AuthRefreshOptions) => {
			const targetUrl = resolveTargetUrl(urlArg);
			const spinner = options.format === 'text' ? ora('Refreshing OAuth token...').start() : null;
			try {
				const resolved = await resolveOAuthBearerToken(targetUrl, {
					forceRefresh: true,
					clientSecretFile: options.clientSecretFile,
					issuer: options.issuer,
				});
				if (!resolved) {
					spinner?.fail('No stored session');
					printError(`No stored OAuth session for ${redactUrl(targetUrl)}.`);
					printInfo(`Run "afd auth login ${redactUrl(targetUrl)}" first.`);
					return process.exit(1);
				}
				spinner?.succeed('Token refreshed');
				const summary: StoredOAuthTokenSummary = {
					resource: resolved.entry.resource,
					issuer: resolved.entry.issuer,
					clientId: resolved.entry.clientId,
					clientAuthMethod: resolved.entry.clientAuthMethod,
					...(resolved.entry.scope !== undefined ? { scope: resolved.entry.scope } : {}),
					...(resolved.entry.expiresAt !== undefined
						? { expiresAt: resolved.entry.expiresAt }
						: {}),
					hasRefreshToken: Boolean(resolved.entry.refreshToken),
					updatedAt: resolved.entry.updatedAt,
				};
				if (options.format === 'json') {
					console.log(JSON.stringify({ success: true, ...summary }, null, 2));
				} else {
					console.log();
					printSummaryText(summary);
				}
			} catch (error) {
				spinner?.fail('Token refresh failed');
				printOAuthFailure('Could not refresh OAuth token', error);
				process.exit(1);
			}
		});

	authCmd
		.command('logout')
		.description('Remove stored OAuth tokens for a server (or --all)')
		.argument('[url]', 'MCP server URL (default: the saved connection)')
		.option('--all', 'Remove all stored OAuth sessions')
		.action((urlArg: string | undefined, options: AuthLogoutOptions) => {
			try {
				if (options.all) {
					const count = clearStoredTokens();
					if (count === 0) {
						printWarning('No stored OAuth sessions to clear.');
					} else {
						printSuccess(`Cleared ${count} stored OAuth session(s).`);
					}
					return;
				}
				const targetUrl = resolveTargetUrl(urlArg);
				const removed = deleteStoredToken(targetUrl);
				if (removed) {
					printSuccess(`Removed stored OAuth session for ${redactUrl(targetUrl)}.`);
				} else {
					printWarning(`No stored OAuth session found for ${redactUrl(targetUrl)}.`);
				}
			} catch (error) {
				printOAuthFailure('Could not remove OAuth session', error);
				process.exit(1);
			}
		});
}
