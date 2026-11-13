#!/usr/bin/env node
// The pack's gap report: what each component's record is missing, read from the committed records
// alone, so it needs no browser and changes only when a record does. `node scripts/pack-gaps.mjs`
// writes pack/GAPS.md; `--check` fails when the committed report is not the one the records give.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const config = JSON.parse(await readFile(join(root, "specimen.config.json"), "utf8"));
const pack = resolve(root, config.pack.directory);
const components = join(pack, "data", config.pack.library, "components");
const report = join(pack, "GAPS.md");

const records = [];
for (const name of (await readdir(components)).filter((file) => file.endsWith(".json")).sort())
  records.push(JSON.parse(await readFile(join(components, name), "utf8")));

const KINDS = [
  ["summary", "No summary"],
  ["usage", "No usage statement"],
  ["a11y-statement", "No accessibility statement"],
  ["role", "No role, observed or authored"],
  ["example", "No example that mounts again on its own"],
];
const count = (kind) => records.filter((record) => record.gaps.some((gap) => gap.kind === kind));
const unobserved = (record, section) =>
  record.gaps
    .filter((gap) => gap.kind === "unobserved" && gap.section === section)
    .map((gap) => gap.name || "(default)");
const guided = records.filter((record) => record.summary).length;
const verified = records.flatMap((record) => [...record.usage, ...record.a11y.statements]).filter(
  (statement) => statement.basis === "verified",
).length;
const statements = records.reduce(
  (total, record) => total + record.usage.length + record.a11y.statements.length,
  0,
);

const lines = [
  "# violet-elements pack: gaps",
  "",
  "Written by `node scripts/pack-gaps.mjs` from the committed records in this directory; do not edit.",
  "This is the backlog of guidance and evidence the pack does not have yet. `pnpm test:stories`",
  "fails when it is not the report the records give.",
  "",
  `- **Components:** ${records.length}, ${guided} with a guide.`,
  `- **Statements:** ${statements} in component guides, ${verified} verified by a claim's check.`,
  "",
  "| Gap | Components |",
  "| --- | --- |",
  ...KINDS.map(([kind, label]) => `| ${label} | ${count(kind).length} |`),
  `| An attribute no case showed set | ${records.filter((record) => unobserved(record, "attributes").length).length} |`,
  `| A slot no case showed filled or empty | ${records.filter((record) => unobserved(record, "slots").length).length} |`,
  "",
  "## By component",
  "",
  "| Component | Missing | Attributes no case showed | Slots no case showed |",
  "| --- | --- | --- | --- |",
];
for (const record of records) {
  const missing = KINDS.filter(([kind]) => record.gaps.some((gap) => gap.kind === kind)).map(
    ([kind]) => kind,
  );
  const attributes = unobserved(record, "attributes");
  const slots = unobserved(record, "slots");
  if (!missing.length && !attributes.length && !slots.length) continue;
  lines.push(
    `| \`${record.tag}\` | ${missing.join(", ") || "-"} | ${attributes.map((name) => `\`${name}\``).join(", ") || "-"} | ${slots.map((name) => `\`${name}\``).join(", ") || "-"} |`,
  );
}
const text = `${lines.join("\n")}\n`;

if (process.argv.includes("--check")) {
  const committed = await readFile(report, "utf8").catch(() => "");
  if (committed !== text) {
    console.error("pack/GAPS.md is not the report the committed records give; run node scripts/pack-gaps.mjs");
    process.exitCode = 1;
  }
} else await writeFile(report, text);
