import type { CommandRunner, ComponentSchema, SpecimenPlugin, ThemePreset } from '../plugin.js';

/** The configured plugins, installed in order before any specimen or story module loads. */
export interface InstalledPlugins {
	plugins: SpecimenPlugin[];
	runners: Map<string, { plugin: string; runner: CommandRunner }>;
	themes: Map<string, { plugin: string; preset: ThemePreset }>;
}

/** The module ids plugins are bundled under, in configuration order. */
const PLUGIN = /^\$plugin:(\d+)$/;

function isPlugin(value: unknown): value is SpecimenPlugin {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { id?: unknown }).id === 'string' &&
		Boolean((value as { id: string }).id)
	);
}

/**
 * Import every plugin module and register what each declares. A plugin id, runner id or theme
 * name registered twice is an error, never a silent choice between them.
 */
export async function installPlugins(
	loaders: Record<string, () => Promise<unknown>>
): Promise<InstalledPlugins> {
	const ids = Object.keys(loaders)
		.filter((id) => PLUGIN.test(id))
		.sort((left, right) => Number(PLUGIN.exec(left)?.[1]) - Number(PLUGIN.exec(right)?.[1]));
	const installed: InstalledPlugins = { plugins: [], runners: new Map(), themes: new Map() };
	for (const id of ids) {
		const module = (await (loaders[id] as () => Promise<{ default?: unknown }>)()) ?? {};
		const exported = module.default;
		const declared = Array.isArray(exported) ? exported : [exported];
		for (const plugin of declared) {
			if (!isPlugin(plugin))
				throw new Error(
					`Plugin module ${ids.indexOf(id) + 1} must default-export a plugin, or an array of plugins, each with an id.`
				);
			if (installed.plugins.some((existing) => existing.id === plugin.id))
				throw new Error(`Plugin '${plugin.id}' is registered twice.`);
			for (const [name, runner] of Object.entries(plugin.runners ?? {})) {
				const existing = installed.runners.get(name);
				if (existing)
					throw new Error(
						`Command runner '${name}' is registered by '${existing.plugin}' and '${plugin.id}'.`
					);
				if (typeof runner?.run !== 'function')
					throw new Error(`Command runner '${name}' of plugin '${plugin.id}' has no run function.`);
				installed.runners.set(name, { plugin: plugin.id, runner });
			}
			for (const [name, preset] of Object.entries(plugin.themes ?? {})) {
				const existing = installed.themes.get(name);
				if (existing)
					throw new Error(
						`Theme '${name}' is registered by '${existing.plugin}' and '${plugin.id}'.`
					);
				installed.themes.set(name, { plugin: plugin.id, preset });
			}
			installed.plugins.push(plugin);
		}
	}
	return installed;
}

/** Core's schema, enriched by each plugin's schema source in order. */
export async function enrichSchema(
	installed: InstalledPlugins,
	tag: string,
	base: ComponentSchema | undefined
): Promise<ComponentSchema | undefined> {
	let schema = base;
	for (const plugin of installed.plugins) {
		if (!plugin.schema) continue;
		const enriched = await plugin.schema(tag, schema);
		if (enriched && enriched !== schema)
			schema = {
				...enriched,
				sources: [...new Set([...(enriched.sources ?? []), plugin.id])],
			};
	}
	return schema;
}

/** A value inspection can report: functions and nodes are described, cycles are cut. */
export function describe(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
	if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
	if (typeof value === 'undefined') return '[undefined]';
	if (typeof value === 'bigint' || typeof value === 'symbol') return `[${typeof value}]`;
	if (value === null || typeof value !== 'object') return value;
	if (typeof Node !== 'undefined' && value instanceof Node)
		return `[node ${value.nodeName.toLowerCase()}]`;
	if (seen.has(value)) return '[circular]';
	if (depth > 6) return '[nested too deeply]';
	seen.add(value);
	if (Array.isArray(value)) return value.map((item) => describe(item, depth + 1, seen));
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, describe(item, depth + 1, seen)])
	);
}
