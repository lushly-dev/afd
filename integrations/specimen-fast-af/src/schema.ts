import type { ComponentSchema, PropertySchema } from '@lushly-dev/specimen';

/**
 * FAST-AF's Definition Schema merged into core's schema. What the manifest already states
 * stays; FAST-AF adds what its definitions know: properties and their finite values, slots,
 * events, CSS properties and `@command` commands.
 */
export interface FastComponentSchema {
	name: string;
	description?: string;
	properties: {
		name: string;
		type: string;
		attribute?: string;
		default?: unknown;
		values?: string[];
		description?: string;
	}[];
	events: { name: string; description?: string }[];
	slots: { name: string; description?: string }[];
	cssProperties: { name: string; default?: string; description?: string }[];
	commands?: { id: string; label?: string; description?: string }[];
}

function text(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	return typeof value === 'string' ? value : JSON.stringify(value);
}

function mergeProperty(
	base: PropertySchema | undefined,
	fast: FastComponentSchema['properties'][number]
): PropertySchema {
	const merged: PropertySchema = { ...(base ?? { name: fast.name }) };
	merged.type ??= fast.type;
	merged.attribute ??= fast.attribute;
	if (merged.values === undefined) {
		if (fast.values?.length) merged.values = [...fast.values];
		else if (fast.type === 'boolean') merged.values = [true, false];
	}
	const fallback = text(fast.default);
	if (merged.default === undefined && fallback !== undefined) merged.default = fallback;
	merged.description ??= fast.description;
	return Object.fromEntries(
		Object.entries(merged).filter(([, value]) => value !== undefined)
	) as PropertySchema;
}

function byName<T extends { name: string }>(base: T[], added: T[]): T[] {
	const names = new Set(base.map((item) => item.name));
	return [...base, ...added.filter((item) => !names.has(item.name))];
}

export function mergeFastSchema(
	tag: string,
	base: ComponentSchema | undefined,
	fast: FastComponentSchema
): ComponentSchema {
	const schema: ComponentSchema = base ?? {
		tag,
		sources: [],
		properties: [],
		attributes: [],
		slots: [],
		events: [],
		cssProperties: [],
		commands: [],
		unknown: [],
	};
	const properties = schema.properties.map((property) => {
		const known = fast.properties.find((item) => item.name === property.name);
		return known ? mergeProperty(property, known) : property;
	});
	for (const property of fast.properties)
		if (!properties.some((item) => item.name === property.name))
			properties.push(mergeProperty(undefined, property));
	const commands = (fast.commands ?? []).map((command) =>
		Object.fromEntries(
			Object.entries({
				id: command.id,
				label: command.label,
				description: command.description,
			}).filter(([, value]) => value !== undefined)
		)
	) as ComponentSchema['commands'];
	return {
		...schema,
		properties,
		slots: byName(
			schema.slots,
			fast.slots.map(({ name, description }) => ({ name, ...(description ? { description } : {}) }))
		),
		events: byName(
			schema.events,
			fast.events.map(({ name, description }) => ({
				name,
				...(description ? { description } : {}),
			}))
		),
		cssProperties: byName(schema.cssProperties, fast.cssProperties),
		commands: byName(
			schema.commands.map((command) => ({ ...command, name: command.id })),
			commands.map((command) => ({ ...command, name: command.id }))
		).map(({ name: _name, ...command }) => command),
		// The definition states its commands, even when it has none.
		unknown: schema.unknown.filter((field) => field !== 'commands'),
	};
}
