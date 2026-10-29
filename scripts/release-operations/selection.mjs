import semver from 'semver';
import { discoverDistributions, planRelease } from '../release/control.mjs';

export function pendingUnits(inventory, fragments, route) {
	return inventory.units
		.filter(
			(unit) =>
				unit.state === 'admitted' &&
				unit.protocol === 'npm-changesets' &&
				unit.routes.includes(route) &&
				fragments.some((fragment) => fragment.units.includes(unit.id))
		)
		.map((unit) => unit.id);
}

/** Default selection preserves unrelated eligible components when another batch is held. */
export function selectDefault({ root, inventory, fragments, registryEvidence, route }) {
	const pending = pendingUnits(inventory, fragments, route);
	const all = discoverDistributions(root, inventory);
	const graph = new Map(inventory.units.map((unit) => [unit.id, new Set()]));
	const edge = (a, b) => {
		graph.get(a)?.add(b);
		graph.get(b)?.add(a);
	};
	for (const fragment of fragments)
		for (const a of fragment.units) for (const b of fragment.units) edge(a, b);
	for (const distribution of all.filter((entry) => pending.includes(entry.unit))) {
		for (const requirement of distribution.dependencyRequirements) {
			const dependency = all.find(
				(entry) => entry.registry === requirement.registry && entry.name === requirement.name
			);
			if (!dependency) continue;
			let range = requirement.range.replace(/^workspace:/, '');
			if (requirement.range.startsWith('workspace:') && ['*', '^', '~'].includes(range))
				range = range === '*' ? dependency.version : `${range}${dependency.version}`;
			const published = registryEvidence.find(
				(entry) => entry.registry === requirement.registry && entry.name === requirement.name
			);
			if (
				!semver.validRange(range) ||
				!published?.versions.some((version) => semver.satisfies(version, range))
			)
				edge(distribution.unit, dependency.unit);
		}
	}
	const visited = new Set(),
		selectedUnits = [],
		blocked = [];
	for (const id of pending) {
		if (visited.has(id)) continue;
		const component = [],
			queue = [id];
		while (queue.length) {
			const unit = queue.pop();
			if (visited.has(unit)) continue;
			visited.add(unit);
			component.push(unit);
			queue.push(...(graph.get(unit) ?? []));
		}
		try {
			if (component.some((unit) => !pending.includes(unit)))
				throw new Error(
					'Coordinated prerequisite or release intent requires an approved pending unit'
				);
			planRelease({ root, inventory, selectedUnits: component, registryEvidence, fragments });
			selectedUnits.push(...component);
		} catch (error) {
			blocked.push({ selectedUnits: component.sort(), reason: error.message });
		}
	}
	return { selectedUnits: selectedUnits.sort(), blocked };
}
