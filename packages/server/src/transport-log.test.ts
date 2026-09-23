/**
 * `transport: 'auto'` silently picks stdio whenever stdin is not a TTY (Docker without -t,
 * systemd, pm2, CI), so `start()` reports the resolved transport on stderr.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpServer } from './server.js';

function withStdinTty<T>(isTTY: boolean, run: () => Promise<T>): Promise<T> {
	const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
	Object.defineProperty(process.stdin, 'isTTY', { value: isTTY, configurable: true });
	return run().finally(() => {
		if (original) Object.defineProperty(process.stdin, 'isTTY', original);
		else Reflect.deleteProperty(process.stdin, 'isTTY');
	});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('resolved transport logging', () => {
	it('logs an explicit HTTP transport with its URL', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const server = createMcpServer({
			name: 'log-http',
			version: '1',
			commands: [],
			transport: 'http',
			host: '127.0.0.1',
			port: 3396,
		});
		await server.start();
		await server.stop();
		expect(log).toHaveBeenCalledWith('[log-http] MCP transport: http at http://127.0.0.1:3396');
	});

	it('explains an auto-detected HTTP transport', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		await withStdinTty(true, async () => {
			const server = createMcpServer({
				name: 'log-auto-http',
				version: '1',
				commands: [],
				host: '127.0.0.1',
				port: 3397,
			});
			expect(server.getTransport()).toBe('http');
			await server.start();
			await server.stop();
		});
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining('auto-detected because stdin is a TTY')
		);
	});

	it('warns when auto-detection picks stdio, and logs explicit stdio plainly', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		await withStdinTty(false, async () => {
			const auto = createMcpServer({ name: 'log-auto-stdio', version: '1', commands: [] });
			expect(auto.getTransport()).toBe('stdio');
			await auto.start();
			await auto.stop();
		});
		expect(log).toHaveBeenCalledWith(
			expect.stringMatching(
				/^\[log-auto-stdio\] MCP transport: stdio \(auto-detected.*transport: 'http'/
			)
		);
		const explicit = createMcpServer({
			name: 'log-stdio',
			version: '1',
			commands: [],
			transport: 'stdio',
		});
		await explicit.start();
		await explicit.stop();
		expect(log).toHaveBeenCalledWith('[log-stdio] MCP transport: stdio');
	});
});
