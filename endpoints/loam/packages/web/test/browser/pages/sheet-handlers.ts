/**
 * Step 12's fixture view type's handlers, on the SDK's real `serveHandlers`, with the `store` grant: a sheet's
 * text under `documentContentKey`, a write with its undo, and a query that tries to write, which the frame's
 * store refuses (STORE_WRITE_IN_QUERY).
 */
import { documentContentKey, failure, success } from '@lushly-dev/loam-sdk';
import { serveHandlers } from '@lushly-dev/loam-sdk/view';

type Context = {
	store?: {
		get<T>(key: string): Promise<T | undefined>;
		put(key: string, value: unknown): Promise<void>;
	};
};

const read = async (document: string, context: Context) =>
	((await context.store?.get<{ text?: string }>(documentContentKey(document)))?.text ??
		'') as string;

serveHandlers({
	sdk: 1,
	handlers: {
		async 'sheet-read'(input: { document: string }, context: Context) {
			return success({ text: await read(input.document, context) });
		},
		async 'sheet-write'(input: { document: string; text: string }, context: Context) {
			const previous = await read(input.document, context);
			await context.store?.put(documentContentKey(input.document), { text: input.text });
			return success(
				{ text: input.text },
				{ undoCommand: 'sheet-write', undoArgs: { document: input.document, text: previous } }
			);
		},
		async 'sheet-peek-write'(input: { document: string }, context: Context) {
			try {
				await context.store?.put(documentContentKey(input.document), { text: 'written' });
				return success({ wrote: true });
			} catch (cause) {
				const { code, data } = cause as { code?: unknown; data?: { code?: unknown } };
				return failure({
					code: String(data?.code ?? code ?? 'REFUSED'),
					message: 'The store refused a query’s write',
					suggestion: 'Write only from a mutation',
				});
			}
		},
	} as never,
});
