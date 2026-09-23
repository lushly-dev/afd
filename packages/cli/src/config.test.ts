import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ values: new Map<string, unknown>() }));

vi.mock('conf', () => ({
	default: class {
		path = '/private/tmp/afd-cli-test/config.json';

		constructor(options: { defaults: Record<string, unknown> }) {
			state.values = new Map(Object.entries(options.defaults));
		}

		get(key: string): unknown {
			return state.values.get(key);
		}

		set(key: string, value: unknown): void {
			state.values.set(key, value);
		}

		delete(key: string): void {
			state.values.delete(key);
		}

		clear(): void {
			state.values.clear();
		}
	},
}));

import { clearConfig, deleteConfig, getConfig, getConfigPath, setConfig } from './config.js';

describe('CLI configuration', () => {
	beforeEach(() => {
		state.values = new Map<string, unknown>([
			['timeout', 30000],
			['format', 'text'],
			['debug', false],
		]);
	});

	it('reads defaults and persists each connection setting', () => {
		expect(getConfig()).toEqual({
			serverUrl: undefined,
			transport: undefined,
			autoReconnect: undefined,
			timeout: 30000,
			format: 'text',
			debug: false,
		});

		setConfig('serverUrl', 'http://localhost/mcp');
		setConfig('transport', 'http');
		setConfig('autoReconnect', false);
		expect(getConfig()).toMatchObject({
			serverUrl: 'http://localhost/mcp',
			transport: 'http',
			autoReconnect: false,
		});
	});

	it('deletes individual keys and clears all settings', () => {
		setConfig('serverUrl', 'http://localhost/mcp');
		deleteConfig('serverUrl');
		expect(getConfig().serverUrl).toBeUndefined();

		clearConfig();
		expect(getConfig()).toEqual({
			serverUrl: undefined,
			transport: undefined,
			autoReconnect: undefined,
			timeout: undefined,
			format: undefined,
			debug: undefined,
		});
		expect(getConfigPath()).toBe('/private/tmp/afd-cli-test/config.json');
	});
});
