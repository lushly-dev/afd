/**
 * @fileoverview @lushly-dev/afd-cli - Command-line interface for Agent-First Development
 *
 * @packageDocumentation
 */

export { createCli } from './cli.js';
export {
	clearConfig,
	deleteConfig,
	getConfig,
	getConfigPath,
	type StoredConfig,
	setConfig,
} from './config.js';
export {
	hasAuthorizationHeader,
	redactHeaders,
	redactHeaderValue,
	redactSecrets,
	redactUrl,
	stripOAuthUrlCredentials,
	urlHasCredentials,
} from './credentials.js';
export {
	discoverOAuthMetadata,
	loginWithOAuth,
	OAUTH_CLIENT_ID_ENV,
	OAUTH_CLIENT_SECRET_ENV,
	OAUTH_ISSUER_ENV,
	OAuthFlowError,
	resolveOAuthBearerToken,
	sanitizeOAuthErrorCode,
} from './oauth-client.js';
export {
	type OutputFormat,
	type OutputOptions,
	printError,
	printResult,
	printStatus,
	printSuccess,
	printTools,
} from './output.js';
export {
	assertWindowsPrivateAcl,
	clearStoredTokens,
	deleteStoredToken,
	getStoredToken,
	getTokenStorePath,
	listStoredTokens,
	restrictWindowsAcl,
	type StoredOAuthToken,
	type StoredOAuthTokenSummary,
	saveStoredToken,
	TokenStoreError,
} from './token-store.js';
export { CLI_VERSION } from './version.js';
