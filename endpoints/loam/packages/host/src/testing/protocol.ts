/**
 * @fileoverview What the development profile's child reports, and how its parent reads it: one line,
 * `ready` or `failed`, on stdout, before it serves or as it fails.
 */

export const READY = 'LOAM_DEV_READY';
export const FAILED = 'LOAM_DEV_FAILED';

/** What `ready` carries. */
export interface ChildReady {
	origin: string;
	sandboxOrigin: string | null;
	spki: string;
	certificate: string;
	mail: string;
	data: string;
}

export type ChildLine =
	| { kind: 'ready'; ready: ChildReady }
	| { kind: 'failed'; error: Error & { code: string } }
	| { kind: 'log' };

/** Reads one line of the child's stdout. */
export function readChildLine(line: string): ChildLine {
	if (line.startsWith(`${READY} `))
		return { kind: 'ready', ready: JSON.parse(line.slice(READY.length + 1)) as ChildReady };
	if (line.startsWith(`${FAILED} `)) {
		const { code, message } = JSON.parse(line.slice(FAILED.length + 1)) as {
			code?: string;
			message?: string;
		};
		return {
			kind: 'failed',
			error: Object.assign(new Error(message ?? 'The development profile failed.'), {
				code: code ?? 'DEV_FAILED',
			}),
		};
	}
	return { kind: 'log' };
}

/** Splits a stream's chunks into whole lines, keeping a partial line until its end arrives. */
export function lineSplitter(onLine: (line: string) => void): (chunk: string) => void {
	let pending = '';
	return (chunk) => {
		pending += chunk;
		let end = pending.indexOf('\n');
		while (end !== -1) {
			onLine(pending.slice(0, end));
			pending = pending.slice(end + 1);
			end = pending.indexOf('\n');
		}
	};
}
