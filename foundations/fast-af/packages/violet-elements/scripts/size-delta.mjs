#!/usr/bin/env node
// The bench's size delta against main's, for the reviewer (#2634): reads two `specimen-build.json`
// reports, compares them with Specimen's `buildSizeDeltas` and prints Markdown, appended to the
// job summary when GITHUB_STEP_SUMMARY is set. Advisory: a missing or unreadable report is said
// and the script still exits 0, so it never fails a run.
//
//   node scripts/size-delta.mjs --before <main's report> --after <this build's report> [--base <label>]
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildSizeDeltas, formatBuildSizeDeltas } from "@lushly-dev/specimen";

const { values } = parseArgs({
  options: { before: { type: "string" }, after: { type: "string" }, base: { type: "string" } },
});
const title = "violet-elements bench size against main";
const read = (path) => (path && existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined);
let text;
try {
  const before = read(values.before);
  const after = read(values.after);
  text = !after
    ? `### ${title}\n\nNo report from this build at ${values.after ?? "(no --after)"}.\n`
    : !before
      ? `### ${title}\n\nNo report from main to compare with yet: one is saved when the stories job runs on a push to main.\n`
      : formatBuildSizeDeltas(buildSizeDeltas(before, after), { title, base: values.base });
} catch (error) {
  text = `### ${title}\n\nNot compared: ${error.message}\n`;
}
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
