#!/usr/bin/env node
// Every story on Specimen: each must pass, the story contract must hold, and the review page must
// build within its budgets. Prints the contract's report, and fails if any of these do not hold.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createSpecimenBench } from "@lushly-dev/specimen";

const bench = await createSpecimenBench({ root: resolve(import.meta.dirname, "..") });
const site = await mkdtemp(join(tmpdir(), "violet-elements-stories-"));
try {
  const run = await bench.contract();
  for (const { id, message } of run.cases.failed) console.error(`failed: ${id}: ${message}`);
  for (const { severity, code, message } of run.findings) console.error(`${severity}: ${code}: ${message}`);
  console.log(
    `${run.cases.passed} of ${run.cases.total} stories passed; ${run.rules}: ${run.counts.errors} errors, ${run.counts.warnings} warnings, over ${run.stats.components} components and ${run.stats.storyFiles} story files`,
  );
  // Throws past a budget.
  await bench.build(join(site, "out"));
  if (!run.valid) process.exitCode = 1;
} finally {
  await bench.close();
  await rm(site, { recursive: true, force: true });
}
