/**
 * @fileoverview Pointers and keys. A validator speaks RFC 6901 pointers; an author reads
 * `commands[0].expose.pallete`.
 */

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function segments(pointer: string): string[] {
	return pointer
		.split('/')
		.slice(1)
		.map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}

/** The key an author reads for a pointer. The document itself is `(root)`. */
export function keyOf(pointer: string): string {
	let key = '';
	for (const part of segments(pointer)) {
		if (/^\d+$/.test(part)) key += `[${part}]`;
		else if (IDENTIFIER.test(part)) key += key === '' ? part : `.${part}`;
		else key += `[${JSON.stringify(part)}]`;
	}
	return key === '' ? '(root)' : key;
}

/** A pointer with each index replaced by `*`, as the refusal tables are keyed. */
export function shapeOf(pointer: string): string {
	return pointer.replace(/\/\d+(?=\/|$)/g, '/*');
}

/** The value a pointer reaches, or undefined. */
export function valueAt(document: unknown, pointer: string): unknown {
	let at = document;
	for (const part of segments(pointer)) {
		if (typeof at !== 'object' || at === null) return undefined;
		at = (at as Record<string, unknown>)[part];
	}
	return at;
}

/** The keys the object at `pointer` admits, from a table keyed with `*` for an index or free name. */
export function admittedAt(
	table: Readonly<Record<string, readonly string[]>>,
	pointer: string
): readonly string[] {
	let path = '';
	for (const part of segments(pointer)) {
		const named = `${path}/${part}`;
		path = /^\d+$/.test(part) || !(named in table) ? `${path}/*` : named;
	}
	return table[path] ?? [];
}

function editDistance(a: string, b: string): number {
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) {
			const substitute = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
			row[j] = Math.min((previous[j] as number) + 1, (row[j - 1] as number) + 1, substitute);
		}
		previous = row;
	}
	return previous[b.length] as number;
}

/** The admitted key closest to `key`, at an edit distance of at most 2. */
export function closestKey(key: string, admitted: readonly string[]): string | undefined {
	let best: string | undefined;
	let bestDistance = 3;
	for (const candidate of admitted) {
		const distance = editDistance(key, candidate);
		if (distance < bestDistance) {
			best = candidate;
			bestDistance = distance;
		}
	}
	return best;
}

/** "Did you mean `palette`? Admitted keys: ...", or only the list. */
export function suggestKey(key: string, admitted: readonly string[], noun = 'keys'): string {
	const closest = closestKey(key, admitted);
	const list = admitted.map((name) => `\`${name}\``).join(', ');
	const known = list === '' ? `No ${noun} are admitted here.` : `Admitted ${noun}: ${list}.`;
	return closest ? `Did you mean \`${closest}\`? ${known}` : known;
}
