/** Conservative normalization of language-native prerequisite declarations. */
export const registryName = (registry, name) =>
	registry === 'pypi' ? name.toLowerCase().replace(/[-_.]+/g, '-') : name;

function pythonRange(specifier) {
	const spec = specifier.trim().replace(/^\((.*)\)$/, '$1');
	if (!spec) return '*';
	return spec
		.split(',')
		.map((raw) => {
			const value = raw.trim();
			const compatible = value.match(/^~=([0-9]+(?:\.[0-9]+){1,2})$/);
			if (compatible) {
				const parts = compatible[1].split('.').map(Number);
				const upper = parts.length === 2 ? `${parts[0] + 1}.0.0` : `${parts[0]}.${parts[1] + 1}.0`;
				return `>=${parts.join('.')} <${upper}`;
			}
			const numeric = value.match(/^(==|>=|<=|>|<)([0-9]+(?:\.[0-9]+){0,2})$/);
			if (numeric) {
				const version = numeric[2].split('.').map(Number).concat([0, 0]).slice(0, 3).join('.');
				return `${numeric[1] === '==' ? '' : numeric[1]}${version}`;
			}
			return value.replace(/^==/, '').replace(/\.\*$/, '.x');
		})
		.join(' ');
}

export function pythonRequirements(project) {
	return [
		...(project.dependencies ?? []),
		...Object.values(project['optional-dependencies'] ?? {}).flat(),
	].map((value) => {
		if (typeof value !== 'string') throw new Error('Invalid Python dependency declaration');
		const match = value.match(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*([^;]*)(?:;.*)?$/);
		if (!match) throw new Error('Unsupported Python dependency declaration');
		return {
			registry: 'pypi',
			name: registryName('pypi', match[1]),
			range: pythonRange(match[2]),
		};
	});
}
export function cargoRequirements(manifest) {
	const sections = [manifest, ...Object.values(manifest.target ?? {})];
	return sections.flatMap((section) =>
		['dependencies', 'build-dependencies'].flatMap((field) =>
			Object.entries(section[field] ?? {}).map(([key, value]) => {
				const name = typeof value === 'string' ? key : (value.package ?? key);
				let range = typeof value === 'string' ? value : (value.version ?? null);
				if (range) {
					range = range.replaceAll(',', ' ');
					if (/^\d/.test(range)) range = `^${range}`;
				}
				return { registry: 'crates', name, range };
			})
		)
	);
}

export function npmRequirements(manifest) {
	return ['dependencies', 'optionalDependencies', 'peerDependencies'].flatMap((field) =>
		Object.entries(manifest[field] ?? {}).map(([key, value]) => {
			if (typeof value !== 'string') throw new Error('Invalid npm dependency declaration');
			const alias = value.match(/^(npm|workspace):((?:@[^/\s]+\/)?[^@\s]+)@(.+)$/);
			if (alias)
				return {
					registry: 'npm',
					name: alias[2],
					range: alias[1] === 'workspace' ? `workspace:${alias[3]}` : alias[3],
				};
			const unversionedAlias = value.match(/^npm:((?:@[^/\s]+\/)?[^@\s]+)$/);
			return {
				registry: 'npm',
				name: unversionedAlias?.[1] ?? key,
				range: unversionedAlias ? '*' : value,
			};
		})
	);
}
