/** Scoped fragment adapter. Validates every input before its first write. */
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { loadInventory, parseFragments, safePath } from './control.mjs';

export function fragmentOperation({
	root,
	inventory = loadInventory(root),
	selectedUnits,
	protocol,
	operation,
	intent,
	execute = false,
}) {
	const reject = (message) => {
		throw new Error(message);
	};
	if (!['create', 'status', 'consume', 'delete'].includes(operation))
		reject('Unknown fragment operation');
	if (!selectedUnits?.length || new Set(selectedUnits).size !== selectedUnits.length)
		reject('Select distinct release units');
	const units = selectedUnits.map((id) => inventory.units.find((unit) => unit.id === id));
	if (units.some((unit) => !unit || unit.protocol !== protocol))
		reject('Ambiguous protocol/unit selection');
	const fragments = parseFragments(root, inventory);
	const selected = fragments.filter((fragment) =>
		fragment.units.some((id) => selectedUnits.includes(id))
	);
	if (
		selected.some(
			(fragment) =>
				fragment.protocol !== protocol || fragment.units.some((id) => !selectedUnits.includes(id))
		)
	)
		reject('Incomplete coordinated fragment selection');
	let created;
	if (operation === 'create') {
		const storage =
			inventory.storages?.filter((entry) => entry.protocol === protocol) ??
			(protocol === 'npm-changesets' ? [{ path: '.changeset', protocol }] : []);
		if (
			storage.length !== 1 ||
			!/^[a-z0-9][a-z0-9-]*$/.test(intent?.id ?? '') ||
			typeof intent.summary !== 'string' ||
			!intent.summary.trim()
		)
			reject('Invalid fragment storage or intent');
		if (protocol === 'npm-changesets') {
			if (
				!intent.changes?.length ||
				new Set(intent.changes.map((change) => change.name)).size !== intent.changes.length
			)
				reject('Invalid npm changes');
			const owners = intent.changes.map((change) => {
				if (!['major', 'minor', 'patch'].includes(change.type)) reject('Invalid npm semver intent');
				return units.find((unit) => unit.distributions.some((entry) => entry.name === change.name))
					?.id;
			});
			if (owners.includes(undefined) || selectedUnits.some((id) => !owners.includes(id)))
				reject('Fragment intent must bind exactly the selected units');
			created = {
				file: `${storage[0].path}/${intent.id}.md`,
				text: `---\n${intent.changes.map((change) => `${JSON.stringify(change.name)}: ${change.type}`).join('\n')}\n---\n\n${intent.summary.trim()}\n`,
			};
		} else if (protocol === 'category-json-v1') {
			if (
				!['added', 'changed', 'fixed', 'removed', 'security', 'deprecated'].includes(
					intent.category
				)
			)
				reject('Invalid category intent');
			created = {
				file: `${storage[0].path}/${intent.id}.json`,
				text: `${JSON.stringify({ protocol, units: selectedUnits, category: intent.category, summary: intent.summary }, null, 2)}\n`,
			};
		} else reject('Unsupported fragment protocol');
		if (existsSync(safePath(root, created.file))) reject('Fragment already exists');
	}
	const files = operation === 'create' ? [created.file] : selected.map((fragment) => fragment.file);
	// Resolve all paths before mutation. A failed validation never deletes another unit's intent.
	const paths = files.map((file) => safePath(root, file));
	if (execute && operation === 'create') writeFileSync(paths[0], created.text, { flag: 'wx' });
	if (execute && ['consume', 'delete'].includes(operation))
		for (const path of paths) unlinkSync(path);
	return {
		operation,
		protocol,
		selectedUnits,
		files,
		created,
		executed: execute && operation !== 'status',
	};
}
