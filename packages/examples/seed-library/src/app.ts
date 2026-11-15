/**
 * @fileoverview The seed library as one application: its records, its 24 commands, and the
 * middleware a host runs them through.
 *
 * What the application asks of the host (`seed-library.md`): the approval middleware holds a
 * loan of rare seed and calls a hook, and the application does the rest. The hook records the
 * request (one for a member and a variety, however often it is asked), the hold's summary says
 * where it waits, the token is never handed out and never retried, and `request-decide` makes
 * the loan itself.
 */

import { type CommandMiddleware, fixedClock, type ManualClock } from '@lushly-dev/afd-core';
import {
	createApprovalMiddleware,
	createDirectRegistry,
	createDirectToolSurface,
	type DirectCommandRegistry,
	type ZodCommandDefinition,
} from '@lushly-dev/afd-server';
import { donationCommands } from './commands/donations.js';
import { loanCommands } from './commands/loans.js';
import { requestCommands } from './commands/requests.js';
import { varietyCommands } from './commands/varieties.js';
import { type LibraryFixtureInput, libraryFixtureSchema } from './fixture.js';
import { createStewardMiddleware } from './steward.js';
import { iso, LibraryStore } from './store.js';

/** How long a request waits for the steward: as long as its hold, which the host caps at a day. */
export const HOLD_MS = 24 * 60 * 60 * 1000;

export interface SeedLibraryOptions {
	/** The records to start from. Default: none, until `load` is called. */
	fixture?: LibraryFixtureInput;
	/**
	 * The library's clock, which the approval middleware and the handlers read. Default: a
	 * clock stopped at the fixture's `now`; `load` moves it there.
	 */
	clock?: ManualClock;
	/** The actor ids of the people with the steward's role. Default: `['steward']`. */
	stewardIds?: readonly string[];
	/**
	 * The approval tokens' HMAC key (32 bytes or more). Default: random, since no token is ever
	 * handed out or retried: the steward's decision is the approval.
	 */
	approvalSecret?: string | Uint8Array;
}

export interface SeedLibrary {
	readonly store: LibraryStore;
	readonly clock: ManualClock;
	readonly commands: ZodCommandDefinition[];
	/** The steward's authorization, then the approval gate. */
	readonly middleware: CommandMiddleware[];
	/** Replace the records with a fixture's, and stop the clock at its `now`. */
	load(fixture: LibraryFixtureInput): void;
	/** An in-process registry over the commands and middleware, with the MCP tool surface. */
	createRegistry(): DirectCommandRegistry;
}

/** Every command, built over one store. */
export function createLibraryCommands(store: LibraryStore): ZodCommandDefinition[] {
	return [
		...varietyCommands(store),
		...loanCommands(store),
		...requestCommands(store),
		...donationCommands(store),
	];
}

function heldLoan(input: unknown): { memberId: string; varietyId: string } | undefined {
	if (!input || typeof input !== 'object') return undefined;
	const { memberId, varietyId } = input as Record<string, unknown>;
	return typeof memberId === 'string' && typeof varietyId === 'string'
		? { memberId, varietyId }
		: undefined;
}

export function createSeedLibrary(options: SeedLibraryOptions = {}): SeedLibrary {
	const store = new LibraryStore();
	const clock = options.clock ?? fixedClock(options.fixture?.now ?? 0);
	const commands = createLibraryCommands(store);
	const secret = options.approvalSecret ?? globalThis.crypto.getRandomValues(new Uint8Array(32));

	/** The loan the call asks for, when it is one the steward has to agree to. */
	const forSteward = (command: string, input: unknown) => {
		const loan = command === 'loan-create' ? heldLoan(input) : undefined;
		return loan && store.needsSteward(loan.memberId, loan.varietyId) ? loan : undefined;
	};

	const approval = createApprovalMiddleware({
		secret,
		commands,
		ttlMs: HOLD_MS,
		includeToken: false,
		relay: 'none',
		clock,
		summarize: (command, input) => {
			const loan = forSteward(command, input);
			return loan
				? `${store.requestSummary(loan.memberId, loan.varietyId)}. It waits for the steward, in request-list`
				: undefined;
		},
		onApprovalRequired: (held) => {
			const loan = forSteward(held.command, held.input);
			if (loan) {
				store.recordRequest(
					loan.memberId,
					loan.varietyId,
					iso(Date.parse(held.expiresAt)),
					clock.now()
				);
			}
		},
	});

	const middleware = [createStewardMiddleware(options.stewardIds ?? ['steward']), approval];

	const library: SeedLibrary = {
		store,
		clock,
		commands,
		middleware,
		load(fixture) {
			const parsed = libraryFixtureSchema.parse(fixture);
			store.load(parsed);
			clock.set(parsed.now);
		},
		createRegistry() {
			return createDirectRegistry(commands, {
				middleware,
				clock,
				tools: createDirectToolSurface(),
			});
		},
	};
	if (options.fixture) library.load(options.fixture);
	return library;
}
