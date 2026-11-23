/**
 * The pure rules of experiments (phase 4 specification, 5.1 to 5.3; D119, D155): `experimentOn`, the `changed` flag,
 * what a settle deletes and when an experiment is overdue. The commands are `experiments.test.ts`'s.
 */

import { describe, expect, it } from 'vitest';
import {
	compareSemver,
	EXPERIMENT_ID,
	enablementChanged,
	experimentOn,
	isStaleVersion,
	overdue,
	settledAway,
	UNKNOWN_STATE,
} from './experiment-rules.js';

const visible = { stage: 'visible' as const, digest: 'sha256:new' };

describe('P4-E5: experimentOn (5.2)', () => {
	it('lets the stage decide first: graduated on, hidden and removed off, whatever is stored', () => {
		const stored = { on: true, digest: 'sha256:new' };
		expect(experimentOn({ ...visible, stage: 'graduated' }, undefined, undefined)).toEqual({
			on: true,
			by: 'stage',
		});
		for (const stage of ['hidden', 'removed'] as const)
			expect(experimentOn({ ...visible, stage }, stored, stored)).toEqual(UNKNOWN_STATE);
		expect(experimentOn(undefined, stored, stored)).toEqual(UNKNOWN_STATE);
	});

	it("takes the person's own choice, then the workspace's, each for the current changes", () => {
		expect(experimentOn(visible, undefined, undefined)).toEqual({ on: false, by: null });
		expect(experimentOn(visible, { on: true, digest: 'sha256:new' }, undefined)).toEqual({
			on: true,
			by: 'person',
		});
		expect(experimentOn(visible, undefined, { digest: 'sha256:new' })).toEqual({
			on: true,
			by: 'workspace',
		});
		// A digest that changed counts as off until turned on again.
		expect(experimentOn(visible, { on: true, digest: 'sha256:old' }, undefined)).toEqual({
			on: false,
			by: null,
		});
		expect(experimentOn(visible, undefined, { digest: 'sha256:old' })).toEqual({
			on: false,
			by: null,
		});
		// A stale own enablement falls through to the workspace's.
		expect(
			experimentOn(visible, { on: true, digest: 'sha256:old' }, { digest: 'sha256:new' })
		).toEqual({ on: true, by: 'workspace' });
	});

	it('voids every enablement made before the last removal, so a re-shipped id revives nothing (5.1)', () => {
		const removedAt = 100;
		expect(
			experimentOn(visible, { on: true, digest: 'sha256:new', at: 50 }, undefined, removedAt)
		).toEqual({ on: false, by: null });
		expect(
			experimentOn(visible, undefined, { digest: 'sha256:new', updatedAt: 100 }, removedAt)
		).toEqual({ on: false, by: null });
		expect(
			experimentOn(visible, { on: true, digest: 'sha256:new', at: 101 }, undefined, removedAt)
		).toEqual({ on: true, by: 'person' });
		// An old opt-out is void too: the re-shipped experiment starts afresh for that person.
		expect(
			experimentOn(
				visible,
				{ on: false, digest: 'x', at: 50 },
				{ digest: 'sha256:new', updatedAt: 120 },
				removedAt
			)
		).toEqual({ on: true, by: 'workspace' });
	});

	it("holds a person's opt-out over the workspace's, whatever the digest (D155)", () => {
		for (const digest of ['sha256:new', 'sha256:old'])
			expect(experimentOn(visible, { on: false, digest }, { digest: 'sha256:new' })).toEqual({
				on: false,
				by: 'person',
			});
	});
});

describe('P4-E5: enablementChanged, settledAway and overdue', () => {
	it('flags an enablement made for other changes, never an opt-out', () => {
		expect(enablementChanged(visible, { on: true, digest: 'sha256:old' }, undefined)).toBe(true);
		expect(enablementChanged(visible, undefined, { digest: 'sha256:old' })).toBe(true);
		expect(enablementChanged(visible, { on: false, digest: 'sha256:old' }, undefined)).toBe(false);
		expect(enablementChanged(visible, { on: true, digest: 'sha256:new' }, undefined)).toBe(false);
	});

	it('deletes what an app removed or no longer declares, and only an app whose manifest was read (I6)', () => {
		const declared = new Map([
			['hello.kept', { stage: 'visible' as const }],
			['hello.gone', { stage: 'removed' as const }],
		]);
		// `other` is listed but unread, so it decides nothing; `away` is no longer listed at all, so its ids go.
		expect(
			settledAway(
				['hello.kept', 'hello.gone', 'hello.dropped', 'other.unread', 'away.left'],
				declared,
				new Set(['hello']),
				new Set(['hello', 'other'])
			)
		).toEqual(['hello.gone', 'hello.dropped', 'away.left']);
	});

	it('is overdue from the day after `ends`, on the call’s clock', () => {
		expect(overdue('2027-03-01', Date.parse('2027-03-01T23:59:59Z'))).toBe(false);
		expect(overdue('2027-03-01', Date.parse('2027-03-02T00:00:00Z'))).toBe(true);
		expect(overdue('not a day', Date.parse('2030-01-01T00:00:00Z'))).toBe(false);
	});

	it('reads a full id, `<plugin>.<id>`, and nothing else', () => {
		for (const id of ['hello.inspector-v2', 'a.b', 'my-app.x0'])
			expect(EXPERIMENT_ID.test(id), id).toBe(true);
		for (const id of ['hello', 'hello.', '.x', 'hello.Inspector', 'a/b.c', 'a.b.c', 'a. b'])
			expect(EXPERIMENT_ID.test(id), id).toBe(false);
	});

	it('compares SemVer 2.0.0 plugin versions and flags strictly older or incomparable shells as stale (#2114)', () => {
		expect(compareSemver('1.0.0', '2.0.0')).toBeLessThan(0);
		expect(compareSemver('1.2.0', '1.10.0')).toBeLessThan(0);
		expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBeLessThan(0);
		expect(compareSemver('1.0.0-beta', '1.0.0')).toBeLessThan(0);
		expect(compareSemver('1.0.0+build.1', '1.0.0+build.2')).toBe(0);
		expect(compareSemver('2.0.0', '1.9.9')).toBeGreaterThan(0);
		// Exact arbitrary-precision integer comparison past Number.MAX_SAFE_INTEGER.
		expect(compareSemver('9007199254740992.0.0', '9007199254740993.0.0')).toBeLessThan(0);
		expect(compareSemver('1.0.0-9007199254740992', '1.0.0-9007199254740993')).toBeLessThan(0);
		// Strict SemVer 2.0.0 rejects leading zeros on numeric prerelease ids and empty identifiers.
		expect(compareSemver('1.0.0-01', '1.0.0-1')).toBeUndefined();
		expect(compareSemver('1.0.0-alpha..1', '1.0.0-alpha.1')).toBeUndefined();
		expect(compareSemver('1.0.0-01a', '1.0.0-01b')).toBeLessThan(0);
		expect(compareSemver('not-semver', '1.0.0')).toBeUndefined();

		expect(isStaleVersion('1.0.0', '2.0.0')).toBe(true);
		expect(isStaleVersion('2.0.0-rc.1', '2.0.0')).toBe(true);
		expect(isStaleVersion('1.0.0', '1.0.0')).toBe(false);
		expect(isStaleVersion('2.0.0', '1.0.0')).toBe(false);
		expect(isStaleVersion('1.0.0', undefined)).toBe(false);
		// Missing or malformed version cannot override a valid recorded SemVer.
		expect(isStaleVersion(undefined, '2.0.0')).toBe(true);
		expect(isStaleVersion('bad', '2.0.0')).toBe(true);
		expect(isStaleVersion('1.0.0', 'bad-recorded')).toBe(false);
	});
});
