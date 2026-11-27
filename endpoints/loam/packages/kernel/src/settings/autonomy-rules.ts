/**
 * @fileoverview Autonomy's pure rules (phase 4 specification, 4.1 and 4.2; D118, D156): the record, a row's id, the
 * default, resolution with its ceilings and the person's cap, the bound a project row meets when it is written (F8),
 * and which rows the apps leave orphaned. In the `late-settings` chunk; phase 5's step 3 enforces with
 * {@link resolveAutonomy} (its D145), so its shape is 4.2's: `{ mode, from, ceilings, cap, chain }`.
 */

/** D41's three modes, strictest first. */
export const AUTONOMY_MODES = ['suggest', 'ask', 'act'] as const;
export type AutonomyModeV1 = (typeof AUTONOMY_MODES)[number];

/** A stored row (4.1). */
export interface AutonomyRowV1 {
	/** `<level>/<project or ->/<instance or *>/<command or *>`. */
	id: string;
	level: 'workspace' | 'project';
	project?: string;
	/** An instance, or `shell`; required with `command`. */
	instance?: string;
	/** A command `instance` registers. */
	command?: string;
	/**
	 * **Amended (step 8, R2):** the identity of the app the owner decided about, stored with a row naming an instance:
	 * {@link SHELL_IDENTITY} for the shell's, `plugin:<plugin id>` for a native or view app, and for a mounted instance
	 * `mounted:<app>:<transport>:<route>` as its deployment entry names its server. A row whose instance's identity
	 * changes is orphaned, and only the same identity backs it again.
	 */
	app?: string;
	/**
	 * The mode. **Amended (step 8):** absent only on the workspace's general row while it holds a `ceiling` alone, so an
	 * owner can let projects go further without changing the workspace's own mode from the default.
	 */
	mode?: AutonomyModeV1;
	/** The workspace's general row only. */
	ceiling?: AutonomyModeV1;
	/**
	 * Set when `command` or `instance` no longer exists, or the instance's app changed (R2). **Amended (step 8, R1):**
	 * ignored as a mode, but still a bound wherever it would apply, so flagging a row never loosens a resolution.
	 */
	orphan?: true;
	updatedAt: number;
	updatedBy: string;
}

/** What resolution needs to know of the command it resolves for (4.2's default). */
export interface AutonomyCommandV1 {
	name: string;
	/** The instance that registers it, or `shell`. */
	instance: string;
	mutation: boolean;
	/** A mounted server's tool: its own labels cannot be trusted, so its default is `ask` (D156). */
	mounted: boolean;
	/**
	 * A mounted tool whose instance entry says `labels = "per-part"`, which vouches for the server's own mutation reports
	 * (phase 5 specification, 5.1, 6.1): its reads default to `act`.
	 */
	vouched?: boolean;
}

/** One step of the explanation: the row (or `default`) that decided the mode, a ceiling that bounded it, the cap. */
export interface AutonomyChainItemV1 {
	id: string;
	mode: AutonomyModeV1;
	as: 'mode' | 'ceiling' | 'cap';
}

/** 4.2's result. */
export interface AutonomyResolutionV1 {
	mode: AutonomyModeV1;
	/** The id of the row that decided the mode before any bound, or `default`. */
	from: string;
	/** Each bound that applied, in the order applied, whether or not it lowered the mode. */
	ceilings: Array<{ id: string; mode: AutonomyModeV1 }>;
	/** The person's own cap, or null for none. */
	cap: AutonomyModeV1 | null;
	chain: AutonomyChainItemV1[];
}

/** The id of the default in a chain. */
export const DEFAULT_ID = 'default';

/**
 * The shell's identity on its rows (R4): `loam`, the plugin id no app may take (`MANIFEST_ID_RESERVED`), so a row for
 * the shell's commands never matches an app, even one at an instance named `shell` in a projection that did not pass
 * through the deployment reader, which refuses that id since phase 4's step 3 (`DEPLOYMENT_INSTANCE_RESERVED`).
 */
export const SHELL_IDENTITY = 'loam';

/** An instance id, as a deployment entry names one (phase 1 specification, 4.2); never `*`. */
export const INSTANCE_ID = /^[a-z][a-z0-9]{0,31}$/;
/** A command's name, as the registry holds one (AFD's `domain-action`); never `*`. */
export const COMMAND_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** A row's id (4.1). */
export const autonomyRowId = (row: {
	level: 'workspace' | 'project';
	project?: string | undefined;
	instance?: string | undefined;
	command?: string | undefined;
}): string =>
	`${row.level}/${row.level === 'project' ? row.project : '-'}/${row.instance ?? '*'}/${row.command ?? '*'}`;

const rank = (mode: AutonomyModeV1): number => AUTONOMY_MODES.indexOf(mode);

/** The stricter of two modes. */
export const lowerOf = (a: AutonomyModeV1, b: AutonomyModeV1): AutonomyModeV1 =>
	rank(a) <= rank(b) ? a : b;

/** Whether `mode` is looser than `bound`. */
export const above = (mode: AutonomyModeV1, bound: AutonomyModeV1): boolean =>
	rank(mode) > rank(bound);

/**
 * The default (4.2 step 3, D156): act on reads, ask before changes, ask before any tool of a mounted server, but the
 * reads of one whose entry says `labels = "per-part"` (phase 5 specification, 6.1), and `shell-open`, navigation that
 * holds no data (9.3), which acts.
 */
export const defaultMode = (
	command: Pick<AutonomyCommandV1, 'mutation' | 'mounted' | 'vouched'> & { name?: string }
): AutonomyModeV1 =>
	command.name === 'shell-open'
		? 'act'
		: command.mutation || (command.mounted && command.vouched !== true)
			? 'ask'
			: 'act';

/** The strictest default, a general or instance project row's bound when the workspace sets neither (F8). */
export const STRICTEST_DEFAULT: AutonomyModeV1 = 'ask';

/** The rows of the workspace and of `project`, the orphans with them only when `orphans` is set. */
function live(
	rows: readonly AutonomyRowV1[],
	project: string | undefined,
	orphans = false
): Map<string, AutonomyRowV1> {
	const kept = new Map<string, AutonomyRowV1>();
	for (const row of rows) {
		if (row.orphan && !orphans) continue;
		if (row.level === 'project' && (project === undefined || row.project !== project)) continue;
		kept.set(row.id, row);
	}
	return kept;
}

/** The rows of one level for a command, most specific first: command, instance, general (4.2 steps 1 and 2). */
const ladder = (
	level: 'workspace' | 'project',
	project: string | undefined,
	instance: string,
	command: string
): [string, string, string] => [
	autonomyRowId({ level, project, instance, command }),
	autonomyRowId({ level, project, instance }),
	autonomyRowId({ level, project }),
];

/**
 * The workspace's bound on a project row (4.2 step 4): its `ceiling`, else its general row's mode, else `fallback`,
 * the default for the command at resolution and {@link STRICTEST_DEFAULT} at write time for a row of every kind.
 */
function workspaceBound(
	held: Map<string, AutonomyRowV1>,
	fallback: AutonomyModeV1
): { id: string; mode: AutonomyModeV1 } {
	const general = held.get(autonomyRowId({ level: 'workspace' }));
	if (general?.ceiling) return { id: general.id, mode: general.ceiling };
	if (general?.mode) return { id: general.id, mode: general.mode };
	return { id: DEFAULT_ID, mode: fallback };
}

/**
 * Resolve a command's mode for one person in one scope (4.2), pure. `rows` may hold any rows: orphans and other
 * projects' are ignored, so the chain names only rows of the workspace and of `project`, which the caller has
 * already decided they may enter. `cap` is the person's own, or undefined for none.
 */
export function resolveAutonomy(input: {
	rows: readonly AutonomyRowV1[];
	command: AutonomyCommandV1;
	project?: string | undefined;
	cap?: AutonomyModeV1 | undefined;
}): AutonomyResolutionV1 {
	const { command, project } = input;
	const held = live(input.rows, project);
	const fallback = defaultMode(command);
	const first = (ids: readonly string[]) =>
		ids.map((id) => held.get(id)).find((row) => row?.mode !== undefined);
	const decidedBy =
		(project === undefined
			? undefined
			: first(ladder('project', project, command.instance, command.name))) ??
		first(ladder('workspace', undefined, command.instance, command.name));
	const from = decidedBy?.id ?? DEFAULT_ID;
	let mode = decidedBy?.mode ?? fallback;
	const chain: AutonomyChainItemV1[] = [{ id: from, mode, as: 'mode' }];
	const ceilings: AutonomyResolutionV1['ceilings'] = [];
	if (decidedBy?.level === 'project') {
		const bounds = [
			workspaceBound(held, fallback),
			held.get(autonomyRowId({ level: 'workspace', instance: command.instance })),
			held.get(
				autonomyRowId({ level: 'workspace', instance: command.instance, command: command.name })
			),
		];
		for (const bound of bounds) {
			if (!bound?.mode) continue;
			ceilings.push({ id: bound.id, mode: bound.mode });
			chain.push({ id: bound.id, mode: bound.mode, as: 'ceiling' });
			mode = lowerOf(mode, bound.mode);
		}
	}
	// R1: an orphan decides nothing, but each that names this instance, and this command or none, still bounds it.
	for (const row of live(input.rows, project, true).values()) {
		if (!row.orphan || !row.mode || row.instance !== command.instance) continue;
		if (row.command !== undefined && row.command !== command.name) continue;
		ceilings.push({ id: row.id, mode: row.mode });
		chain.push({ id: row.id, mode: row.mode, as: 'ceiling' });
		mode = lowerOf(mode, row.mode);
	}
	const cap = input.cap ?? null;
	if (cap !== null) {
		chain.push({ id: 'cap', mode: cap, as: 'cap' });
		mode = lowerOf(mode, cap);
	}
	return { mode, from, ceilings, cap, chain };
}

/**
 * The bound a project row meets when it is written (4.2 step 4, F8), its tightest: a general or instance row against
 * the workspace's `ceiling`, else its general row's mode, else {@link STRICTEST_DEFAULT}, since such a row covers
 * commands of every kind; a command row against those with the command's own default in place of the strictest, and
 * the workspace's rows for its instance and command. An instance row meets the workspace's row for its instance too,
 * which resolution would lower it to (step 8's reading). Undefined for a workspace row, which owners set unbounded.
 */
export function writeBound(
	rows: readonly AutonomyRowV1[],
	target: {
		level: 'workspace' | 'project';
		instance?: string | undefined;
		command?: AutonomyCommandV1 | undefined;
	}
): { id: string; mode: AutonomyModeV1 } | undefined {
	if (target.level !== 'project') return undefined;
	const held = live(rows, undefined);
	// R1: the workspace's rows for the instance and the command bound it even when orphaned.
	const all = live(rows, undefined, true);
	const bounds = [
		workspaceBound(held, target.command ? defaultMode(target.command) : STRICTEST_DEFAULT),
		target.instance === undefined
			? undefined
			: all.get(autonomyRowId({ level: 'workspace', instance: target.instance })),
		target.command === undefined
			? undefined
			: all.get(
					autonomyRowId({
						level: 'workspace',
						instance: target.instance,
						command: target.command.name,
					})
				),
	];
	let tightest: { id: string; mode: AutonomyModeV1 } | undefined;
	for (const bound of bounds) {
		if (!bound?.mode) continue;
		if (!tightest || above(tightest.mode, bound.mode))
			tightest = { id: bound.id, mode: bound.mode };
	}
	return tightest;
}

/**
 * What the kernel knows of an instance now: undefined when the deployment no longer has it; its app's `identity`
 * (R2), undefined when it cannot be read; and its `commands`, undefined while its catalog is unknown (a mounted server
 * not yet read, a disabled or refused instance), never an empty set in their place.
 */
export interface InstanceStateV1 {
	identity: string | undefined;
	commands: ReadonlySet<string> | undefined;
}

/**
 * Which rows the apps leave orphaned, and which they back again (4.2; amended by step 8's R1 and R2): a row naming an
 * instance the deployment no longer has, an instance whose app is not the one the row was decided for, or a command a
 * known catalog no longer holds. An unknown identity or catalog decides nothing: the row's flag stays as it is. A row
 * is backed again only by the same identity, and for a command row, by a known catalog holding the command.
 */
export function orphanChanges(
	rows: readonly AutonomyRowV1[],
	stateOf: (instance: string) => InstanceStateV1 | undefined
): { orphaned: string[]; restored: string[] } {
	const orphaned: string[] = [];
	const restored: string[] = [];
	for (const row of rows) {
		if (row.instance === undefined) continue;
		const state = stateOf(row.instance);
		let gone: boolean | undefined;
		if (state === undefined) gone = true;
		else if (state.identity === undefined) gone = undefined;
		else if (row.app !== state.identity) gone = true;
		else if (row.command === undefined) gone = false;
		else if (state.commands === undefined) gone = undefined;
		else gone = !state.commands.has(row.command);
		if (gone === true && !row.orphan) orphaned.push(row.id);
		else if (gone === false && row.orphan) restored.push(row.id);
	}
	return { orphaned: orphaned.sort(), restored: restored.sort() };
}
