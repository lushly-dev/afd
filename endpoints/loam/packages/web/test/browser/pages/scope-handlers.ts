/**
 * A view fixture's handlers for E7 (phase 2 specification, 15): what each call's context holds of its
 * scope, and a nested query's, on the SDK's real `serveHandlers`; and what the frame's store answers a
 * key naming another scope's record.
 */
import { success } from '@lushly-dev/loam-sdk';
import { serveHandlers } from '@lushly-dev/loam-sdk/view';

serveHandlers({
	sdk: 1,
	handlers: {
		async 'scoped-where'(_input: unknown, context: { scope: unknown }) {
			return success({ scope: context.scope });
		},
		async 'scoped-nested'(
			_input: unknown,
			context: { scope: unknown; client: { call(name: string): Promise<{ data?: unknown }> } }
		) {
			const nested = await context.client.call('scoped-where');
			return success({ outer: context.scope, nested: (nested.data as { scope?: unknown })?.scope });
		},
		async 'scoped-store'(
			_input: unknown,
			context: { store?: { put(key: string, value: unknown): Promise<void> } }
		) {
			try {
				await context.store?.put('p~prj_beacon~x', 'v');
				return success({ stored: true });
			} catch (cause) {
				// The store's own reply, as the frame's RPC failure carries it, so no other throw passes.
				const { name, code, data } = cause as { name?: unknown; code?: unknown; data?: unknown };
				return success({ refused: { name, code, data } });
			}
		},
	} as never,
});
