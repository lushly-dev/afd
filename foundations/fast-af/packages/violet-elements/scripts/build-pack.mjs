#!/usr/bin/env node
// Build the component pack's records from every story (two passes each) and write them, with the
// gap report. `node scripts/build-pack.mjs violet-combobox` rebuilds one record; CI's full
// `pack-check` in `test:stories` stays the authority.
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { createSpecimenBench } from "@lushly-dev/specimen";

const component = process.argv[2];
const bench = await createSpecimenBench({ root: resolve(import.meta.dirname, "..") });
try {
  const run = await bench.pack(component ? { component } : {});
  for (const { id, message } of run.cases.failed) console.error(`failed: ${id}: ${message}`);
  for (const id of run.cases.unstable) console.error(`unstable, contributes nothing: ${id}`);
  for (const { tag, field, reason } of run.omitted) console.error(`left out: ${tag} ${field}: ${reason}`);
  for (const { code, path, message } of run.problems) console.error(`${code}: ${path}: ${message}`);
  console.log(
    `${run.written.length} files written, ${run.removed.length} removed, from ${run.cases.passed} of ${run.cases.total} cases (${run.selection.reason}); ${run.examples.kept} examples kept, ${run.examples.leftOut.length} left out; in ${(run.elapsedMs / 1000).toFixed(1)} s`,
  );
} finally {
  await bench.close();
}
execFileSync(process.execPath, [join(import.meta.dirname, "pack-gaps.mjs")], { stdio: "inherit" });
