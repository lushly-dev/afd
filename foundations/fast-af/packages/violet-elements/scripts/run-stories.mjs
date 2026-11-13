#!/usr/bin/env node
// Every story on Specimen: each must pass, the story contract must hold, the review page must
// build within its budgets, and the committed component pack and its gap report must be the ones
// the stories give. Prints the contract's report and the pack check's, and fails if any of these
// do not hold.
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createSpecimenBench } from "@lushly-dev/specimen";

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const bench = await createSpecimenBench({ root: resolve(import.meta.dirname, "..") });
const site = await mkdtemp(join(tmpdir(), "violet-elements-stories-"));
try {
  const run = await bench.contract();
  for (const { id, message } of run.cases.failed) console.error(`failed: ${id}: ${message}`);
  for (const { severity, code, message } of run.findings) console.error(`${severity}: ${code}: ${message}`);
  console.log(
    `${run.cases.passed} of ${run.cases.total} stories passed; ${run.rules}: ${run.counts.errors} errors, ${run.counts.warnings} warnings, over ${run.stats.components} components and ${run.stats.storyFiles} story files, in ${seconds(run.elapsedMs)}`,
  );
  // Throws past a budget.
  await bench.build(join(site, "out"));
  if (!run.valid) process.exitCode = 1;

  // The drift check: builds every record again from two passes over every story and compares.
  const pack = await bench.packCheck();
  for (const { id, message } of pack.cases.failed) console.error(`pack: failed: ${id}: ${message}`);
  for (const id of pack.cases.unstable) console.error(`pack: unstable, contributes nothing: ${id}`);
  for (const [kind, paths] of [
    ["changed", pack.changed],
    ["added", pack.added],
    ["removed", pack.removed],
  ])
    for (const path of paths) console.error(`pack: ${kind}: ${path}`);
  for (const { code, path, message } of pack.problems) console.error(`pack: ${code}: ${path}: ${message}`);
  console.log(
    `pack-check: ${pack.components.length} records ${pack.valid ? "match" : "differ from"} the committed pack; ${pack.cases.passed} of ${pack.cases.total} cases the same in both passes, ${pack.cases.unstable.length} unstable, ${pack.cases.retried.length} retried; in ${seconds(pack.elapsedMs)}`,
  );
  if (!pack.valid) {
    console.error("Rebuild the records with `specimen pack` (see the package README) and commit them.");
    process.exitCode = 1;
  }
  try {
    execFileSync(process.execPath, [join(import.meta.dirname, "pack-gaps.mjs"), "--check"], {
      stdio: "inherit",
    });
  } catch {
    process.exitCode = 1;
  }
} finally {
  await bench.close();
  await rm(site, { recursive: true, force: true });
}
