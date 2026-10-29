/** Static managed-host adapter. User input is data on stdin, never generated code. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (!['create', 'status', 'delete'].includes(input.operation)) throw new Error('Unsupported fragment operation');
  const { fragmentOperation } = await import(pathToFileURL(join(input.root, 'scripts/release/fragments.mjs')));
  const options = {
    root: input.root,
    selectedUnits: [input.unit],
    protocol: 'npm-changesets',
    operation: input.operation,
    intent: input.intent,
    execute: input.operation !== 'status',
  };
  // The approved helper deletes all selected-unit fragments. A named delete must
  // match its complete set, so another pending fragment cannot be removed silently.
  if (input.operation === 'delete') {
    const status = fragmentOperation({ ...options, operation: 'status', execute: false });
    if (status.files.length !== 1 || status.files[0] !== input.fragment) {
      throw new Error('Named delete requires exactly this one selected-unit fragment; review all unit fragments first');
    }
  }
  process.stdout.write(JSON.stringify(fragmentOperation(options)) + '\n');
} catch (error) {
  process.stderr.write(String(error.message) + '\n');
  process.exitCode = 1;
}
