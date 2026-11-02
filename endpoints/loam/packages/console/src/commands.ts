/**
 * @fileoverview The command list (phase 1 specification, 7.7). A row's text may be a mounted server's, so
 * each field is read for what it is, and a row with no name is not one: the template only ever sees text.
 */

/** One row of `app-command-list`, as the console reads it. */
export interface ConsoleCommand {
	name: string;
	title?: string;
	description?: string;
	mutation: boolean;
	destructive: boolean;
	/** Displayed. Enforcement is the server's own until phase 5 (7.4). */
	approval: boolean;
	inputSchema: unknown;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === 'object' && value !== null;

/** `app-command-list`'s rows, without anything that is not a command with a name. */
export function readCommands(rows: unknown): ConsoleCommand[] {
	if (!Array.isArray(rows)) return [];
	return rows.flatMap((row): ConsoleCommand[] => {
		if (!isRecord(row) || typeof row.name !== 'string' || row.name === '') return [];
		return [
			{
				name: row.name,
				...(typeof row.title === 'string' ? { title: row.title } : {}),
				...(typeof row.description === 'string' ? { description: row.description } : {}),
				mutation: row.mutation === true,
				destructive: row.destructive === true,
				approval: row.approval === 'required',
				inputSchema: row.inputSchema,
			},
		];
	});
}

export const rowTitle = (command: ConsoleCommand): string => command.title || command.name;

/** Said in words, so a flag never rests on color. */
export const rowFlag = (command: ConsoleCommand): string =>
	[
		command.destructive ? 'Destructive' : command.mutation ? 'Changes data' : '',
		command.approval ? 'Needs approval' : '',
	]
		.filter(Boolean)
		.join(', ');

export function filterCommands(commands: ConsoleCommand[], query: string): ConsoleCommand[] {
	const wanted = query.trim().toLowerCase();
	if (wanted === '') return commands;
	return commands.filter(({ name, title }) =>
		`${name} ${title ?? ''}`.toLowerCase().includes(wanted)
	);
}

/** What the filter's live text says. Empty when there is nothing to say. */
export function filterStatus(all: number, shown: number, query: string): string {
	if (all === 0) return 'This app has no commands to run here.';
	const wanted = query.trim();
	if (wanted === '') return '';
	if (shown === 0) return `No command matches "${wanted}".`;
	return `${shown} of ${all} commands`;
}
