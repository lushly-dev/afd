/**
 * @fileoverview What of an app's context calls the kernel, over one caller's `call` (phase 2
 * specification, 3.6): the port's for `activate`, and a surface's for its element, so an embed's
 * `navigate` or modal is refused as its client's calls are.
 */

import type { AppPortV2 } from '@lushly-dev/loam-kernel';
import type {
	AppContextV1,
	CommandResult,
	DocumentRecordV1,
	DocumentsV1,
	LinkRowV1,
	ModalInputV1,
	ToastInputV1,
} from '@lushly-dev/loam-sdk';

/** A refusal as a rejection, with its code and suggestion, for what an app awaits rather than reads. */
function refusal(result: CommandResult<unknown>, fallback: string): Error {
	return Object.assign(new Error(result.error?.message ?? fallback), {
		code: result.error?.code,
		suggestion: result.error?.suggestion,
	});
}

/**
 * {@link DocumentsV1} over one caller's `call` (documents specification, 11): each a call the `documents`
 * grant allows, within the surface's scope; `open` rejects with its refusal, `DOCUMENT_OPEN_NOT_ACTIVE` among
 * them, and the reads answer null or nothing.
 */
export function documentsOver(call: AppPortV2['call']): DocumentsV1 {
	const read = async <T>(name: string, input: unknown) => {
		const result = await call<T>(name, input);
		return result.success ? result.data : undefined;
	};
	return {
		get: async (document) => (await read<DocumentRecordV1>('document-get', { document })) ?? null,
		list: async (options) =>
			(await read<{ documents: DocumentRecordV1[] }>('document-list', options ?? {}))?.documents ??
			[],
		links: async (document) =>
			(await read<{ out: LinkRowV1[]; in: LinkRowV1[] }>('document-link-list', { document })) ?? {
				out: [],
				in: [],
			},
		async open(document, options) {
			const opened = await call('document-open', { document, ...options });
			if (!opened.success) throw refusal(opened, 'The document could not open');
		},
	};
}

export function surfaceCalls(
	port: Pick<AppPortV2, 'instance' | 'waitOverlay' | 'manifest'>,
	call: AppPortV2['call']
): Pick<AppContextV1, 'client' | 'navigate' | 'overlays' | 'documents'> {
	const { instance } = port;
	return {
		client: { call },
		// The `documents` grant's reads and open, over the same caller (documents specification, 11).
		...(port.manifest?.grants?.some((grant) => grant.name === 'documents')
			? { documents: documentsOver(call) }
			: {}),
		async navigate(route: string) {
			const moved = await call('app-route-set', { instance, path: route });
			if (!moved.success) throw refusal(moved, 'The route could not change');
		},
		overlays: {
			toast: (input: ToastInputV1) => call('toast-show', input),
			async modal(input: ModalInputV1) {
				const opened = await call<{ overlayId: string }>('modal-open', input);
				if (!opened.success || !opened.data) throw refusal(opened, 'The modal could not open');
				return port.waitOverlay(opened.data.overlayId);
			},
		},
	};
}
