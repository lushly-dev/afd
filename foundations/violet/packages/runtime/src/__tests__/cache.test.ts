import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TokenCache } from '../cache.js';

describe('TokenCache', () => {
	let cache: TokenCache;

	beforeEach(() => {
		cache = new TokenCache();
	});

	afterEach(() => {
		cache.close();
	});

	describe('memory cache (fallback)', () => {
		// Note: Without IndexedDB, cache uses memory fallback

		it('should store and retrieve tokens', async () => {
			await cache.init(); // Will use memory cache

			const tokens = [
				{ id: 'color.primary', value: '#107C10', resolvedAt: 'global' },
				{ id: 'color.secondary', value: '#0078D4', resolvedAt: 'global' },
			];

			await cache.set('test-node', tokens, 3600);
			const result = await cache.get('test-node');

			expect(result).not.toBeNull();
			expect(result?.tokens).toEqual(tokens);
			expect(result?.nodeId).toBe('test-node');
			expect(result?.ttl).toBe(3600);
		});

		it('should detect expired entries', async () => {
			await cache.init();

			const tokens = [{ id: 'test', value: 'value', resolvedAt: 'global' }];

			// Create entry with -1 TTL (already expired)
			await cache.set('expired-node', tokens, -1);

			const result = await cache.get('expired-node');
			expect(result).not.toBeNull();
			expect(cache.isExpired(result!)).toBe(true);
		});

		it('should not report valid entries as expired', async () => {
			await cache.init();

			const tokens = [{ id: 'test', value: 'value', resolvedAt: 'global' }];
			await cache.set('valid-node', tokens, 3600);

			const result = await cache.get('valid-node');
			expect(result).not.toBeNull();
			expect(cache.isExpired(result!)).toBe(false);
		});

		it('should delete cached entries', async () => {
			await cache.init();

			const tokens = [{ id: 'test', value: 'value', resolvedAt: 'global' }];
			await cache.set('delete-me', tokens, 3600);

			await cache.delete('delete-me');
			const result = await cache.get('delete-me');

			expect(result).toBeNull();
		});

		it('should clear all entries', async () => {
			await cache.init();

			const tokens = [{ id: 'test', value: 'value', resolvedAt: 'global' }];
			await cache.set('node-1', tokens, 3600);
			await cache.set('node-2', tokens, 3600);

			await cache.clear();

			expect(await cache.get('node-1')).toBeNull();
			expect(await cache.get('node-2')).toBeNull();
		});

		it('should list all cached keys', async () => {
			await cache.init();

			const tokens = [{ id: 'test', value: 'value', resolvedAt: 'global' }];
			await cache.set('node-a', tokens, 3600);
			await cache.set('node-b', tokens, 3600);
			await cache.set('node-c', tokens, 3600);

			const keys = await cache.keys();
			expect(keys).toHaveLength(3);
			expect(keys).toContain('node-a');
			expect(keys).toContain('node-b');
			expect(keys).toContain('node-c');
		});

		it('should return null for non-existent entries', async () => {
			await cache.init();
			const result = await cache.get('does-not-exist');
			expect(result).toBeNull();
		});
	});
});
