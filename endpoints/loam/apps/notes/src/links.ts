/**
 * @fileoverview A note's links (documents specification, 10): a link in the text is `[[<document id>|<title>]]`,
 * its id and the title when it was made. `parseLinks` is pure, and `linkToken` writes one. What the text
 * links and embeds becomes the note's links in the shell's index, by `document-link-add` and `-remove` from
 * its editor after a save, since a handler may only call queries (D68).
 */

/** One link in a note's text: the document it names, its title then, and where it is, in UTF-16 units. */
export interface NoteLinkV1 {
	document: string;
	title: string;
	start: number;
	end: number;
}

/** A link token: an id of a document, 1 to 128 characters with no `|` or `]`, then its title. */
const TOKEN = /\[\[([^|\]\s]{1,128})\|([^\]]*)\]\]/g;

/** Every link token in `text`, in order. */
export function parseLinks(text: string): NoteLinkV1[] {
	return [...text.matchAll(TOKEN)].map((match) => ({
		document: match[1] as string,
		title: match[2] as string,
		start: match.index,
		end: match.index + match[0].length,
	}));
}

/** The token for a link to `document`, its title cut to 200 characters with no `]` to end it early. */
export function linkToken(document: string, title: string): string {
	return `[[${document}|${title.replaceAll(']', ')').slice(0, 200)}]]`;
}

/** A link of the shell's index as a note's editor reads it. */
export interface HeldLink {
	id: string;
	to: string;
	kind: string;
}

/**
 * What to change so the index holds one `reference` link for each document the text names and one `embed`
 * link for each embedded one, and no other links of those two kinds from this note.
 */
export function linkChanges(
	text: string,
	embeds: readonly string[],
	held: readonly HeldLink[]
): { add: Array<{ to: string; kind: string }>; remove: string[] } {
	const wanted = new Map<string, Set<string>>([
		['reference', new Set(parseLinks(text).map((link) => link.document))],
		['embed', new Set(embeds)],
	]);
	const remove: string[] = [];
	const kept = new Set<string>();
	for (const link of held) {
		const want = wanted.get(link.kind);
		if (!want) continue;
		const key = `${link.kind} ${link.to}`;
		if (want.has(link.to) && !kept.has(key)) kept.add(key);
		else remove.push(link.id);
	}
	const add: Array<{ to: string; kind: string }> = [];
	for (const [kind, documents] of wanted) {
		for (const to of documents) if (!kept.has(`${kind} ${to}`)) add.push({ to, kind });
	}
	return { add, remove };
}
