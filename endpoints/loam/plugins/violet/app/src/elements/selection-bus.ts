/**
 * @fileoverview Per-document selection bus linking `token-tree-editor` and `token-tree-inspector`
 * when the host shell mounts the document inspector without forwarding a `selection` property.
 */
type SelectionListener = (selection: string | null) => void;

const latestByDocument = new Map<string, string | null>();
const listenersByDocument = new Map<string, Set<SelectionListener>>();

export function publishSelection(documentId: string, selection: string | null): void {
	latestByDocument.set(documentId, selection);
	const listeners = listenersByDocument.get(documentId);
	if (!listeners) return;
	for (const listener of [...listeners]) {
		listener(selection);
	}
}

export function getSelection(documentId: string): string | null | undefined {
	return latestByDocument.get(documentId);
}

export function subscribeSelection(documentId: string, listener: SelectionListener): () => void {
	let listeners = listenersByDocument.get(documentId);
	if (!listeners) {
		listeners = new Set();
		listenersByDocument.set(documentId, listeners);
	}
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			listenersByDocument.delete(documentId);
		}
	};
}

export function clearSelectionBus(documentId?: string): void {
	if (documentId === undefined) {
		latestByDocument.clear();
		listenersByDocument.clear();
		return;
	}
	latestByDocument.delete(documentId);
}
