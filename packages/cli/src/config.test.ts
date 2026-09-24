import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
	values: new Map<string, unknown>(),
	options: undefined as Record<string, unknown> | undefined,
	writes: 0,
}));

vi.mock('conf', () => ({
	default: class {
		path = '/private/tmp/afd-cli-test/config.json';

		constructor(options: { defaults: Record<string, unknown> }) {
			state.options = options;
			state.values = new Map(Object.entries(options.defaults));
		}

		get(key: string): unknown {
			return state.values.get(key);
		}

		set(key: string | Record<string, unknown>, value?: unknown): void {
			state.writes++;
			const entries = typeof key === 'string' ? [[key, value] as const] : Object.entries(key);
			for (const [name, item] of entries) state.values.set(name, item);
		}

		delete(key: string): void {
			state.values.delete(key);
		}

		clear(): void {
			state.values.clear();
		}
	},
}));

import {
	CONFIG_FILE_MODE,
	clearConfig,
	deleteConfig,
	getConfig,
	getConfigPath,
	restrictConfigFile,
	saveConnection,
	setConfig,
} from './config.js';

describe('CLI configuration', () => {
	beforeEach(() => {
		state.writes = 0;
		state.values = new Map<string, unknown>([
			['timeout', 30000],
			['format', 'text'],
			['debug', false],
		]);
	});

	it('creates the config file readable only by its owner', () => {
		expect(CONFIG_FILE_MODE).toBe(0o600);
		expect(state.options).toMatchObject({ projectName: 'afd-cli', configFileMode: 0o600 });
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

	it('saves a connection URL together with its transport in one write', () => {
		setConfig('transport', 'http');
		state.writes = 0;

		saveConnection({
			url: 'http://localhost/sse',
			transport: 'sse',
			timeout: 5000,
			autoReconnect: false,
		});

		expect(state.writes).toBe(1);
		expect(getConfig()).toMatchObject({
			serverUrl: 'http://localhost/sse',
			transport: 'sse',
			timeout: 5000,
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

describe.skipIf(process.platform === 'win32')('restrictConfigFile', () => {
	it('narrows a config file an older CLI left group/world readable', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'afd-cli-config-'));
		const path = join(directory, 'config.json');
		try {
			await writeFile(path, '{}', { mode: 0o644 });
			restrictConfigFile(path);
			expect((await stat(path)).mode & 0o777).toBe(0o600);

			// Already private: left alone.
			restrictConfigFile(path);
			expect((await stat(path)).mode & 0o777).toBe(0o600);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('ignores a missing file', () => {
		expect(() => restrictConfigFile('/nonexistent/afd-cli/config.json')).not.toThrow();
	});
});
