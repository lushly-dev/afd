/**
 * A view fixture's handlers for E7 (phase 2 specification, 15): what each call's context holds of its
 * scope, and a nested query's, on the SDK's real `serveHandlers`.
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
	} as never,
});
