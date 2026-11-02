#!/usr/bin/env node
/**
 * session:record: write E2's committed journal fixture, `specimens/fixtures/session-50.journal.json`,
 * by running the kernel's scripted `SESSION_50` on a test kernel (phase 0 specification, 6.7 and
 * 11). `src/session-fixture.test.ts` fails when the committed file no longer matches a fresh
 * recording under `diffJournals`; run this, then review the diff.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recordSession, SESSION_50 } from '@lushly-dev/loam-kernel/testing';

export const FIXTURE = fileURLToPath(
	new URL('../specimens/fixtures/session-50.journal.json', import.meta.url)
);

const { entries } = await recordSession(SESSION_50);
writeFileSync(FIXTURE, `${JSON.stringify(entries, null, '\t')}\n`);
console.log(
	`session:record wrote ${entries.length} entries to specimens/fixtures/session-50.journal.json`
);
