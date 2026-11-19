/**
 * @fileoverview A failed save's toast (documents specification, 5.5), apart from the editor's DOM so a unit reads it.
 */

/**
 * The toast for a save that failed. `unseen`, a page the person was not looking at, makes it sticky, so it also lands in
 * the inbox whatever `toastSticky` says (phase 4 specification, 10.2's "an unseen failed autosave").
 */
export function notSaved(title: string, cause: unknown, unseen = false) {
	const { code, suggestion } = (cause ?? {}) as { code?: string; suggestion?: string };
	const message = cause instanceof Error ? cause.message : String(cause);
	return {
		message:
			`${title} was not saved: ${message}${code ? ` (${code})` : ''}${suggestion ? `. ${suggestion}` : ''}`.slice(
				0,
				200
			),
		tone: 'danger',
		durationMs: 30_000,
		...(unseen ? { sticky: true } : {}),
	};
}
