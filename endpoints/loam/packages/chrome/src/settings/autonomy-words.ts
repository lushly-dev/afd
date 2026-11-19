/**
 * @fileoverview The autonomy section's words (phase 4 specification, 4.5): a mode, a row and a step of the chain that
 * explains a resolved mode, in plain words, pure so a unit holds them.
 */

export type Mode = 'suggest' | 'ask' | 'act';

/** The advisory notice above the rows (4.5), exactly as E13 checks it. */
export const ADVISORY = 'Agents can read this. Loam enforces it from phase 5.';

/** Section 13's message in place of the cap's field on a hosted `provider` deployment. */
export const HOSTED_CAP =
	'Your cap must bind agents connected to the server, so the server will keep it. This deployment cannot keep it yet.';

export const MODES: readonly Mode[] = ['suggest', 'ask', 'act'];

/** A mode as the person reads it. */
export const MODE_WORDS: Readonly<Record<Mode, string>> = {
	suggest: 'Suggest only',
	ask: 'Ask first',
	act: 'Act',
};

/** A row as `autonomy-list` gives it (4.1). */
export interface AutonomyRow {
	id: string;
	level: 'workspace' | 'project';
	project?: string;
	instance?: string;
	command?: string;
	mode?: Mode;
	ceiling?: Mode;
	orphan?: true;
}

/** What a row covers: every app, one app, or one command of an app, by the app's title. */
export function rowWords(
	row: Pick<AutonomyRow, 'instance' | 'command'>,
	titleOf: (instance: string) => string
): string {
	if (row.instance === undefined) return 'Every app and command';
	const app = row.instance === 'shell' ? 'The shell' : titleOf(row.instance);
	return row.command === undefined ? `${app}, every command` : `${app}: ${row.command}`;
}

/** One step of `autonomy-get`'s chain in words: the row that decided the mode, a bound, or the person's cap. */
export function chainWords(
	step: { id: string; mode: Mode; as: 'mode' | 'ceiling' | 'cap' },
	titleOf: (instance: string) => string,
	projectName: string | undefined
): string {
	const mode = MODE_WORDS[step.mode];
	if (step.as === 'cap') return `Your own cap: ${mode}`;
	const where =
		step.id === 'default'
			? 'the default (act on reads, ask before changes and before any mounted tool)'
			: placeWords(step.id, titleOf, projectName);
	return step.as === 'mode' ? `${mode}, from ${where}` : `Bounded to ${mode} by ${where}`;
}

/** A row id, `<level>/<project or ->/<instance or *>/<command or *>`, as a place. */
function placeWords(
	id: string,
	titleOf: (instance: string) => string,
	projectName: string | undefined
): string {
	const [level, , instance, command] = id.split('/');
	const covers = rowWords(
		{
			...(instance && instance !== '*' ? { instance } : {}),
			...(command && command !== '*' ? { command } : {}),
		},
		titleOf
	).replace(/^(Every app|The shell)/, (words) => words.toLowerCase());
	return level === 'project'
		? `the project${projectName ? ` ${projectName}` : ''}'s rule for ${covers}`
		: `the workspace's rule for ${covers}`;
}
