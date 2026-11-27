export const CASES: string;
export function entriesOf(entry: unknown, archives: unknown): unknown[];
export function buildArchive(entries: unknown[], archive?: unknown): Buffer;
export function sha256(bytes: Buffer): string;
export function caseDigests(
	document?: unknown
): Array<{ name: string; recorded: string; built: string }>;
