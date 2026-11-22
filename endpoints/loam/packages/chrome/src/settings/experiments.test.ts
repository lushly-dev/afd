/**
 * The experiments list's words (phase 4 specification, 5.2 and 5.4): where a state comes from, and when an experiment
 * ends, said as a reader says it. The element itself is P4-E5's Chromium file, `web/test/browser/experiments.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { type ExperimentRow, endWords, stateWords } from './experiments-words.js';

const row = (extra: Partial<ExperimentRow> = {}): ExperimentRow => ({
	fullId: 'hello.inspector-v2',
	owner: 'hello',
	title: 'Greeting inspector',
	changes: 'Shows an inspector.',
	ends: '2027-03-01',
	stage: 'visible',
	on: false,
	by: null,
	workspace: false,
	changed: false,
	overdue: false,
	...extra,
});

describe('the experiments list in words', () => {
	it('says what decided each state', () => {
		expect(stateWords(row())).toBe('Off.');
		expect(stateWords(row({ on: true, by: 'person' }))).toBe('On: you turned it on.');
		expect(stateWords(row({ on: false, by: 'person', workspace: true }))).toBe(
			'Off: you turned it off.'
		);
		expect(stateWords(row({ on: true, by: 'workspace' }))).toBe(
			'On: an owner turned it on for the workspace.'
		);
		expect(stateWords(row({ stage: 'graduated', on: true, by: 'stage' }))).toMatch(/everyone/);
	});

	it('says the day it ends in UTC, and that nothing turns off past it', () => {
		expect(endWords(row())).toMatch(/^Ends .*2027\.$/);
		expect(endWords(row({ ends: '2027-03-01' }))).toContain('1');
		expect(endWords(row({ overdue: true }))).toMatch(/^Was to end .*stays as it is/);
		expect(endWords(row({ ends: 'soon' }))).toBe('Ends soon.');
	});
});
