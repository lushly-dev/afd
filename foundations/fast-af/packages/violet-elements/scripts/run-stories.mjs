#!/usr/bin/env node
// Every story on Specimen: each must pass, the story contract must hold, the review page must
// build within its budgets, and the committed component pack and its gap report must be the ones
// the stories give. Prints the contract's report and the pack check's, and fails if any of these
// do not hold.
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
  // Throws past a budget. SPECIMEN_BUILD_REPORT keeps the build's report, which CI compares with
  // main's (scripts/size-delta.mjs, #2634).
  try {
    await bench.build(join(site, "out"));
  } finally {
    const kept = process.env.SPECIMEN_BUILD_REPORT;
    if (kept) {
      await mkdir(dirname(resolve(kept)), { recursive: true });
      await copyFile(join(site, "out", "specimen-build.json"), resolve(kept)).catch(() => {});
    }
  }
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
  const changedTags = new Set(
    pack.changed
      .map((path) => /^data\/[^/]+\/components\/([^/]+)\.json$/.exec(path)?.[1])
      .filter(Boolean),
  );
  for (const { tag, from, reason } of pack.examples.leftOut) {
    if (changedTags.has(tag)) console.error(`pack: example left out: ${tag} (${from}): ${reason}`);
  }
  const drifted = pack.changed.length + pack.added.length + pack.removed.length;
  const hasErrors = pack.cases.failed.length > 0 || pack.problems.length > 0;
  const problemLabel = pack.problems.length === 1 ? "problem" : "problems";
  const errorSuffix = hasErrors ? ` (${pack.cases.failed.length} failed, ${pack.problems.length} ${problemLabel})` : "";
  const packSummary = pack.valid
    ? `${pack.components.length} records match the committed pack`
    : drifted > 0
      ? `${drifted} ${drifted === 1 ? "file differs" : "files differ"} from the committed pack (across ${pack.components.length} records)${errorSuffix}`
      : `failed${errorSuffix} across ${pack.components.length} records`;
  console.log(
    `pack-check: ${packSummary}; ${pack.cases.passed} of ${pack.cases.total} cases the same in both passes, ${pack.cases.unstable.length} unstable, ${pack.cases.retried.length} retried; in ${seconds(pack.elapsedMs)}`,
  );
  if (!pack.valid) {
    if (hasErrors) {
      console.error("Fix the failed cases or pack problems above before rebuilding the pack.");
    }
    if (drifted > 0) {
      console.error("Rebuild the records with `specimen pack` (see the package README) and commit them.");
    }
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
