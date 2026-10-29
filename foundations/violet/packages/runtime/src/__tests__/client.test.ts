import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VioletRuntime } from '../client.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('VioletRuntime', () => {
	let runtime: VioletRuntime;

	beforeEach(() => {
		vi.clearAllMocks();
		runtime = new VioletRuntime({
			nodeId: 'test-node',
			apiUrl: 'https://api.test.com',
			apiKey: 'test-key',
			cacheEnabled: false, // Disable cache for simpler tests
		});
	});

	describe('constructor', () => {
		it('should create instance with config', () => {
			const r = new VioletRuntime({ nodeId: 'my-node' });
			expect(r.getCurrentNodeId()).toBe('my-node');
		});

		it('requires apiUrl when apiKey is set', () => {
			expect(() => new VioletRuntime({ nodeId: 'my-node', apiKey: 'secret' })).toThrow(
				/apiUrl is required when apiKey is set/,
			);
			expect(
				() => new VioletRuntime({ nodeId: 'my-node', apiKey: 'secret', apiUrl: '  ' }),
			).toThrow(/apiUrl is required/);
		});

		it('fetches from the page origin when neither apiUrl nor apiKey is set', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						success: true,
						data: { tokens: [], nodeId: 'my-node', ancestry: ['my-node'], tokenCount: 0 },
					}),
			});
			const r = new VioletRuntime({ nodeId: 'my-node', cacheEnabled: false, autoApply: false });
			await r.load();

			const [url, init] = mockFetch.mock.calls[0];
			expect(url).toBe('/api/v1/nodes/my-node/tokens');
			expect(init.headers).not.toHaveProperty('X-API-Key');
		});
	});

	describe('load()', () => {
		it('should fetch tokens from API', async () => {
			const mockTokens = [
				{ id: 'color.primary', value: '#107C10', resolvedAt: 'global' },
				{ id: 'color.secondary', value: '#0078D4', resolvedAt: 'global' },
			];

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						success: true,
						data: {
							tokens: mockTokens,
							nodeId: 'test-node',
							ancestry: ['global', 'test-node'],
							tokenCount: 2,
						},
					}),
			});

			const tokens = await runtime.load();

			expect(mockFetch).toHaveBeenCalledWith(
				'https://api.test.com/api/v1/nodes/test-node/tokens',
				expect.objectContaining({
					headers: expect.objectContaining({
						'X-API-Key': 'test-key',
					}),
				}),
			);
			expect(tokens).toHaveLength(2);
			expect(tokens[0].id).toBe('color.primary');
		});

		it('should throw on API error', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 404,
				statusText: 'Not Found',
			});

			await expect(runtime.load()).rejects.toThrow('HTTP 404');
		});

		it('should throw on API response error', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						success: false,
						error: {
							code: 'NODE_NOT_FOUND',
							message: 'Node not found',
						},
					}),
			});

			await expect(runtime.load()).rejects.toThrow('NODE_NOT_FOUND');
		});
	});

	describe('get() and getValue()', () => {
		beforeEach(async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						success: true,
						data: {
							tokens: [
								{ id: 'color.primary', value: '#107C10', resolvedAt: 'global' },
								{
									id: 'spacing.small',
									value: 4,
									resolvedAt: 'global',
									metadata: { type: 'spacing' },
								},
							],
							nodeId: 'test-node',
							ancestry: [],
							tokenCount: 2,
						},
					}),
			});
			await runtime.load();
		});

		it('should get token by ID', () => {
			const token = runtime.get('color.primary');
			expect(token).toBeDefined();
			expect(token?.value).toBe('#107C10');
		});

		it('should return undefined for unknown token', () => {
			const token = runtime.get('unknown.token');
			expect(token).toBeUndefined();
		});

		it('should get value directly', () => {
			const value = runtime.getValue('color.primary');
			expect(value).toBe('#107C10');
		});

		it('should return undefined value for unknown token', () => {
			const value = runtime.getValue('unknown.token');
			expect(value).toBeUndefined();
		});
	});

	describe('getAll() and getByPattern()', () => {
		beforeEach(async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						success: true,
						data: {
							tokens: [
								{ id: 'color.primary', value: '#107C10', resolvedAt: 'global' },
								{
									id: 'color.secondary',
									value: '#0078D4',
									resolvedAt: 'global',
								},
								{ id: 'spacing.small', value: 4, resolvedAt: 'global' },
								{ id: 'spacing.medium', value: 8, resolvedAt: 'global' },
							],
							nodeId: 'test-node',
							ancestry: [],
							tokenCount: 4,
						},
					}),
			});
			await runtime.load();
		});

		it('should get all tokens', () => {
			const tokens = runtime.getAll();
			expect(tokens).toHaveLength(4);
		});

		it('should filter by pattern', () => {
			const colorTokens = runtime.getByPattern('color.*');
			expect(colorTokens).toHaveLength(2);
			expect(colorTokens[0].id).toMatch(/^color\./);
		});

		it('should match complex patterns', () => {
			const tokens = runtime.getByPattern('*.small');
			expect(tokens).toHaveLength(1);
			expect(tokens[0].id).toBe('spacing.small');
		});
	});

	describe('switchNode()', () => {
		it('should switch to a different node', async () => {
			// Initial load
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						success: true,
						data: {
							tokens: [{ id: 'color.primary', value: '#107C10', resolvedAt: 'global' }],
							nodeId: 'node-a',
							ancestry: [],
							tokenCount: 1,
						},
					}),
			});

			// Switch load
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						success: true,
						data: {
							tokens: [{ id: 'color.primary', value: '#0078D4', resolvedAt: 'node-b' }],
							nodeId: 'node-b',
							ancestry: [],
							tokenCount: 1,
						},
					}),
			});

			await runtime.load();
			expect(runtime.getCurrentNodeId()).toBe('test-node');

			await runtime.switchNode('node-b');
			expect(runtime.getCurrentNodeId()).toBe('node-b');
			expect(runtime.getValue('color.primary')).toBe('#0078D4');
		});
	});

	describe('events', () => {
		it('should emit load event', async () => {
			const listener = vi.fn();
			runtime.on('load', listener);

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						success: true,
						data: {
							tokens: [{ id: 'color.primary', value: '#107C10', resolvedAt: 'global' }],
							nodeId: 'test-node',
							ancestry: [],
							tokenCount: 1,
						},
					}),
			});

			await runtime.load();

			expect(listener).toHaveBeenCalledOnce();
			expect(listener.mock.calls[0][0].type).toBe('load');
		});

		it('should emit load:error on failure', async () => {
			const listener = vi.fn();
			runtime.on('load:error', listener);

			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 500,
				statusText: 'Server Error',
			});

			await expect(runtime.load()).rejects.toThrow();
			expect(listener).toHaveBeenCalled();
		});

		it('should return unsubscribe function', async () => {
			const listener = vi.fn();
			const unsubscribe = runtime.on('load', listener);

			mockFetch.mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						success: true,
						data: {
							tokens: [],
							nodeId: 'test-node',
							ancestry: [],
							tokenCount: 0,
						},
					}),
			});

			await runtime.load();
			expect(listener).toHaveBeenCalledOnce();

			unsubscribe();
			await runtime.load();
			expect(listener).toHaveBeenCalledOnce(); // Still 1, not 2
		});
	});
});
