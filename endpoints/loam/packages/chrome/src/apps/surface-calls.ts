/**
 * @fileoverview What of an app's context calls the kernel, over one caller's `call` (phase 2
 * specification, 3.6): the port's for `activate`, and a surface's for its element, so an embed's
 * `navigate` or modal is refused as its client's calls are.
 */

import type { AppPortV2 } from '@lushly-dev/loam-kernel';
import {
	type AppContextV1,
	type CommandResult,
	type DocumentRecordV1,
	type DocumentsV1,
	type LinkRowV1,
	type ModalInputV1,
	type PopoverInputV1,
	settingsOver,
	type ToastInputV1,
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
): Pick<AppContextV1, 'client' | 'navigate' | 'overlays' | 'documents' | 'settings'> {
	const { instance } = port;
	return {
		client: { call },
		// The `documents` grant's reads and open, over the same caller (documents specification, 11).
		...(port.manifest?.grants?.some((grant) => grant.name === 'documents')
			? { documents: documentsOver(call) }
			: {}),
		// The `settings` grant's reads of the app's own sections (phase 4 specification, 3.8).
		...(port.manifest?.grants?.some((grant) => grant.name === 'settings')
			? { settings: settingsOver({ call }) }
			: {}),
		async navigate(route: string) {
			const moved = await call('app-route-set', { instance, path: route });
			if (!moved.success) throw refusal(moved, 'The route could not change');
		},
		overlays: {
			toast: (input: ToastInputV1) => call('toast-show', input),
			popover: (input: PopoverInputV1) => call('popover-open', input),
			async modal(input: ModalInputV1) {
				const opened = await call<{ overlayId: string }>('modal-open', input);
				if (!opened.success || !opened.data) throw refusal(opened, 'The modal could not open');
				return port.waitOverlay(opened.data.overlayId);
			},
		},
	};
}

/**
 * The sections a change names that `manifest`'s app hears (phase 4 specification, 3.8): only with the `settings` grant,
 * and only the sections it declares itself, by full id.
 */
export function settingsHeard(
	manifest: AppPortV2['manifest'] | undefined,
	sections: readonly string[]
): string[] {
	if (!manifest?.grants?.some((grant) => grant.name === 'settings')) return [];
	const own = new Set(
		((manifest.ui?.settings ?? []) as Array<{ id: string }>).map(
			(section) => `${manifest.plugin.id}.${section.id}`
		)
	);
	return sections.filter((section) => own.has(section));
}

/**
 * Tell each surface its app's sections changed (3.8): a native surface's mount calls its element's `settingsChanged`,
 * a view's frame sends `host-context-changed` with `dev.loam/settingsChanged`. One surface that throws stops no other.
 */
export function deliverSettings(surfaces: Iterable<unknown>, sections: readonly string[]): number {
	if (sections.length === 0) return 0;
	let told = 0;
	for (const surface of surfaces) {
		const target = surface as { settingsChanged?(changed: string[]): void };
		if (typeof target?.settingsChanged !== 'function') continue;
		try {
			target.settingsChanged([...sections]);
			told++;
		} catch (cause) {
			(globalThis as { reportError?(error: unknown): void }).reportError?.(cause);
		}
	}
	return told;
}
