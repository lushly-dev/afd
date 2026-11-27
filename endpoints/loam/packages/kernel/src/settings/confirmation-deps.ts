/**
 * @fileoverview What phase 4's confirmations (its 7.2) take from `late` and first paint (`confirmations.ts`), apart so
 * that module stays within its size: every dependency is a type or a function here, so it imports types alone (13).
 */

import type { CommandContext, CommandResult } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import type { DataAdapter } from '@lushly-dev/local-db';
import type { Opener } from '../overlays/commands.js';
import type { OverlayStore } from '../overlays/store.js';
import type { AccessActorV1 } from '../scope/access.js';
import type { ScopeV1 } from '../scope/records.js';
import type {
	AskedFor,
	AskedPreviewV1,
	EnforcedV1,
	ReshowV1,
	StoredConfirmation,
} from './confirmation-parts.js';
import type { SettingsKit } from './settings.js';

export interface ConfirmationDeps {
	store: DataAdapter;
	workspace(): string;
	/** Whether the deployment's identity is `provider`: then a call with no person has no inbox. */
	provider: boolean;
	overlays: OverlayStore;
	/** Step 3's path of a call (6.1): the shell's for a person's gesture, an app's port, the agent interface, or none. */
	openerOf(context: CommandContext): Opener;
	/** Whether an app is active, or owns the active tab (6.1). */
	isActive(instance: string): Promise<boolean>;
	/** A command's `confirm_prompt`, or undefined for one that declares none. */
	askedFor(command: string): AskedFor | undefined;
	/** Phase 5's `ask` of a command that declares none (its 6.1): the shell's own words. Absent: none is asked. */
	genericAsked?(command: string, enforced: EnforcedV1): AskedFor | undefined;
	/**
	 * Told, on the call's path, when a confirmation an agent raised is raised or ends (phase 5's 6.3 and 3.5): approval
	 * health counts it, and the copilot's waiting turn hears it.
	 */
	observe?(
		event: 'asked' | 'confirmed' | 'declined' | 'withdrawn',
		row: StoredConfirmation,
		replacedBy?: StoredConfirmation
	): void | Promise<void>;
	/**
	 * A command the palette lists now (7.1): its definition, whose schema checks the input, and its input's JSON Schema,
	 * whose plain fields the prompt asks for; undefined for one it does not list here.
	 */
	paletteCommand(command: string): { definition: ZodCommandDefinition; json: unknown } | undefined;
	/** Why `input` does not fit the command's own schema, or undefined when it does. */
	inputFault(command: ZodCommandDefinition, input: unknown): string | undefined;
	/** Whether the journal records a call of `command`: one it does not leaves no entry for a replay to run (11). */
	journaled(
		command: string,
		context?: {
			readonly interface?: unknown;
			readonly actor?: { readonly kind?: unknown };
			readonly caller?: unknown;
		}
	): boolean;
	/** `decideAccess` on a scope: whether the actor may enter it now, line 0 included. */
	allows(actor: AccessActorV1, scope: ScopeV1): boolean;
	/**
	 * The re-check on confirm (7.2) past access: why the command's app, or the calling app, can no longer run it here, or
	 * undefined when both still can: enabled for the project, loaded, and the caller's grants.
	 */
	served(command: string, caller: string | undefined, scope: ScopeV1): string | undefined;
	/** An app's owner line title (6.6), never one that says "Loam". */
	appTitle(instance: string): string;
	/** A project's name, for the header. */
	projectName(project: string): string | undefined;
	/** The signed-in person's name, never an email; null for none. */
	personLabel(): string | null;
	/** The kernel's `execute`, past the queue: a top-level call journaled as its own (7.2's run, 7.1's). */
	runNow(
		iface: 'palette' | 'agent' | 'apps',
		name: string,
		input: unknown,
		fields: Record<string | symbol, unknown>
	): Promise<CommandResult>;
	/** Boot's own: `prompt-settle`, journaled before the answer it waits for. */
	runBoot(name: string, input: unknown): Promise<CommandResult>;
	replaying(): boolean;
	/**
	 * Whether an input is over `loam.limits.inputBytes` now, or has no JSON form (phase 4's section 11): an app's raised
	 * call, measured by its port then, is measured again before its confirmed run, as the limit may have fallen since.
	 */
	inputOver(input: unknown): boolean;
	/**
	 * The person signed in now, as `personKey` keys them (`local` outside `provider` mode, signed out): a confirmed run
	 * runs only for the person it was asked of (step 6's fifth round, 2).
	 */
	personNow(): string | undefined;
	/** Whether `command` is a mutation under an archived project in `scope` (line 6; step 6's second round, 4). */
	archived(command: string, scope: ScopeV1): boolean;
	/** Release the queue a queued call holds, as it starts waiting on a person (7.2; step 6's second round, 3). */
	releaseQueue(context: CommandContext): void;
	/**
	 * The document chain a chained call holds (the scope middleware's): given up while it waits on a person, and taken
	 * back, its resource checks repeated, before it runs (step 6's third round, A). Undefined for a call it chains to none.
	 */
	chainOf(context: CommandContext):
		| {
				release(): void;
				again(run: () => Promise<CommandResult>): Promise<CommandResult>;
				/** Lines 5 and 6 again, in place: the inbox's run, which holds its chain already (fifth round, 2). */
				check(): Promise<CommandResult | undefined>;
		  }
		| undefined;
	/** Mark the call's kernel event: its inbox changed, though the call may have failed (`CONFIRMATION_PENDING`). */
	noteInbox(context: CommandContext): void;
	/** SHA-256 of canonical JSON, as the copilot's input digest (phase 5's 3.4). */
	digest(value: unknown): Promise<string>;
	/**
	 * Phase 5's 7.2: a released mounted command's preview, read as the person before it asks; a refusal when it cannot be
	 * read, so nothing is asked; undefined for any other command, and in a replay.
	 */
	previewFor?(
		name: string,
		input: unknown,
		context: CommandContext
	): Promise<AskedPreviewV1 | CommandResult<never> | undefined>;
	/**
	 * Phase 5's 7.2: the run a person confirmed of a released command, on the instance it holds, after its preview is read
	 * again and matches `shown`, its outcome stored by `after` before the hold ends; the kernel's `RESHOW` mark when it
	 * does not match, and nothing ran (`after` not called). Any other command: `run()`, then `after`.
	 */
	release?(
		name: string,
		input: unknown,
		context: CommandContext,
		shown: AskedPreviewV1 | undefined,
		run: () => Promise<CommandResult>,
		after: (result: CommandResult) => Promise<void>
	): Promise<CommandResult | ReshowV1>;
	/** Phase 5's suggestion records (its 6.1), which `palette-run`'s "Run it" opens and runs once. */
	suggestions?: import('./palette-run.js').SuggestionReader;
	/** What a call's confirmation-row reads and writes tell the journal's order (#2117). */
	recordOrder?(
		traceId: string | undefined,
		resource: string
	): import('../journal-order.js').StoreOrderV1 | undefined;
	kit: SettingsKit;
}
