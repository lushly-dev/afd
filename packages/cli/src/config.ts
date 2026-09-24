/**
 * @fileoverview CLI configuration management
 */

import { chmodSync, statSync } from 'node:fs';
import Conf from 'conf';

/** Transports the CLI can use. */
export type CliTransport = 'sse' | 'http';

/**
 * Stored configuration.
 *
 * Request headers (`--header`, `AFD_HEADERS`) are deliberately not part of it:
 * credentials are never written to disk by the CLI.
 */
export interface StoredConfig {
	/** Last connected server URL */
	serverUrl?: string;
	/** Transport selected by the last successful connection */
	transport?: CliTransport;
	/** Whether `afd shell` reconnects the saved connection automatically */
	autoReconnect?: boolean;
	/** Default timeout in ms */
	timeout?: number;
	/** Output format */
	format?: 'json' | 'text' | 'table';
	/** Debug mode */
	debug?: boolean;
}

/** Everything needed to reopen a connection in a later process. */
export interface SavedConnection {
	url: string;
	transport: CliTransport;
	timeout: number;
	autoReconnect: boolean;
}

/** Owner read/write only: the saved URL may carry a token. */
export const CONFIG_FILE_MODE = 0o600;

/**
 * Config store using Conf.
 */
const store = new Conf<StoredConfig>({
	projectName: 'afd-cli',
	configFileMode: CONFIG_FILE_MODE,
	defaults: {
		timeout: 30000,
		format: 'text',
		debug: false,
	},
});

/**
 * Restrict a config file written by an older CLI (Conf's default mode is
 * 0o666, so it was usually 0o644). Conf only applies `configFileMode` when it
 * writes, and reading the config never writes it.
 */
export function restrictConfigFile(path: string): void {
	try {
		if ((statSync(path).mode & 0o077) !== 0) chmodSync(path, CONFIG_FILE_MODE);
	} catch {
		// No config file yet, or a filesystem without POSIX modes.
	}
}

restrictConfigFile(store.path);

/**
 * Get the configuration store.
 */
export function getConfig(): StoredConfig {
	return {
		serverUrl: store.get('serverUrl'),
		transport: store.get('transport'),
		autoReconnect: store.get('autoReconnect'),
		timeout: store.get('timeout'),
		format: store.get('format'),
		debug: store.get('debug'),
	};
}

/**
 * Set a configuration value.
 */
export function setConfig<K extends keyof StoredConfig>(key: K, value: StoredConfig[K]): void {
	store.set(key, value);
}

/**
 * Save a connection's URL, transport, timeout and reconnect choice in one
 * write, so a saved URL is never paired with another connection's transport.
 */
export function saveConnection(connection: SavedConnection): void {
	store.set({
		serverUrl: connection.url,
		transport: connection.transport,
		timeout: connection.timeout,
		autoReconnect: connection.autoReconnect,
	});
}

/** Remove a stored configuration value. */
export function deleteConfig(key: keyof StoredConfig): void {
	store.delete(key);
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
