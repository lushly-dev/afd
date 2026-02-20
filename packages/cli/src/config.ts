/**
 * @fileoverview CLI configuration management
 */

import Conf from 'conf';

/**
 * Stored configuration.
 */
export interface StoredConfig {
	/** Last connected server URL */
	serverUrl?: string;
	/** Default timeout in ms */
	timeout?: number;
	/** Output format */
	format?: 'json' | 'text' | 'table';
	/** Debug mode */
	debug?: boolean;
}

/**
 * Config store using Conf.
 */
const store = new Conf<StoredConfig>({
	projectName: 'afd-cli',
	defaults: {
		timeout: 30000,
		format: 'text',
		debug: false,
	},
});

/**
 * Get the configuration store.
 */
export function getConfig(): StoredConfig {
	return {
		serverUrl: store.get('serverUrl'),
		timeout: store.get('timeout'),
		format: store.get('format'),
		debug: store.get('debug'),
	};
}

/**
 * Set a configuration value.
 */
export function setConfig<K extends keyof StoredConfig>(
	key: K,
	value: StoredConfig[K]
): void {
	store.set(key, value);
}

/**
 * Clear the configuration.
 */
export function clearConfig(): void {
	store.clear();
}

/**
 * Get the config file path.
 */
export function getConfigPath(): string {
	return store.path;
}
