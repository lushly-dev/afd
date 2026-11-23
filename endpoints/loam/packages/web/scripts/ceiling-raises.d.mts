export interface CeilingAmendment {
	row: string;
	from: number | null;
	to: number | null;
	measured: number | null;
	reason: string;
	amendment: string;
	approvedBy: 'coordinator' | 'owner';
	approval: string;
	approvedOn: string;
}
export interface CeilingSource {
	file: string;
	name: string;
}
export interface CheckResult {
	state: 'inert' | 'within' | 'checked';
	notes: string[];
	failures: string[];
}
export const REPO_ROOT: string;
export const DECISIONS: string;
export const SOURCES: readonly CeilingSource[];
export function parseCeilings(
	source: string,
	name: string
): { rows: Record<string, number> } | { error: string };
export function ceilingChanges(
	base: Record<string, number>,
	head: Record<string, number>
): Array<{ row: string; from: number | null; to: number | null }>;
export function decisionRow(decisions: string, id: string): string | null;
export function checkEndDate(endsOn: string | null, decisions: string): string[];
export function checkAmendment(
	entry: unknown,
	context: { readRepoFile(path: string): string | null; decisions: string; today: string }
): string[];
export function checkCeilingRaises(options: {
	endsOn: string | null;
	amendments: readonly unknown[];
	today: string;
	decisions: string;
	readRepoFile(path: string): string | null;
	readHead(file: string): string | null;
	readBase(file: string): string | null;
	sources?: readonly CeilingSource[];
}): CheckResult;
export function resolveBase(options?: {
	argv?: string[];
	env?: Record<string, string | undefined>;
	cwd?: string;
}): { sha: string | null; reason: string | null };
export function runCeilingRaiseCheck(options?: {
	argv?: string[];
	env?: Record<string, string | undefined>;
	cwd?: string;
	endsOn?: string | null;
	amendments?: readonly unknown[];
	today?: string;
	log?: (line: string) => void;
	error?: (line: string) => void;
}): number;
export const AMENDMENTS_FILE: string;
export function parseEndDate(source: string): { endsOn: string | null } | { error: string };
export function checkEndDateChange(
	baseEndsOn: string | null,
	endsOn: string | null,
	decisions: string
): string[];
export function headingAnchor(heading: string): string;
export function sectionText(markdown: string, anchor: string): string | null;
export function coveringEntries(
	amendments: readonly unknown[],
	change: { row: string; from: number | null; to: number | null }
): CeilingAmendment[] | null;
