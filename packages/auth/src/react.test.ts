// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MockAuthAdapter } from './adapters/mock.js';
import { createAuthHooks } from './react.js';

describe('createAuthHooks', () => {
	describe('useAuth', () => {
		it('returns the adapter instance', () => {
			const adapter = new MockAuthAdapter();
			const { useAuth } = createAuthHooks(adapter);
			const { result } = renderHook(() => useAuth());
			expect(result.current).toBe(adapter);
		});
	});

	describe('useSession', () => {
		it('returns current session state', () => {
			const adapter = new MockAuthAdapter();
			const { useSession } = createAuthHooks(adapter);
			const { result } = renderHook(() => useSession());
			expect(result.current.status).toBe('unauthenticated');
		});

		it('updates when auth state changes', async () => {
			const adapter = new MockAuthAdapter();
			const { useSession } = createAuthHooks(adapter);
			const { result } = renderHook(() => useSession());

			expect(result.current.status).toBe('unauthenticated');

			await act(async () => {
				adapter._setUser({ id: 'u1', email: 'test@example.com' });
			});

			expect(result.current.status).toBe('authenticated');
			if (result.current.status === 'authenticated') {
				expect(result.current.user.email).toBe('test@example.com');
			}
		});
	});

	describe('useUser', () => {
		it('returns null when unauthenticated', () => {
			const adapter = new MockAuthAdapter();
			const { useUser } = createAuthHooks(adapter);
			const { result } = renderHook(() => useUser());
			expect(result.current).toBeNull();
		});

		it('returns user when authenticated', async () => {
			const adapter = new MockAuthAdapter();
			const { useUser } = createAuthHooks(adapter);
			const { result } = renderHook(() => useUser());

			await act(async () => {
				adapter._setUser({ id: 'u1', email: 'test@example.com', name: 'Test' });
			});

			expect(result.current).toEqual({
				id: 'u1',
				email: 'test@example.com',
				name: 'Test',
			});
		});
	});
});
