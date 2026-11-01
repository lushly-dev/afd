import type { ComponentSchema, PropertySchema, SchemaValue } from './plugin.js';

/**
 * Core's schema source: a custom elements manifest (schema 1.x) read into one schema per tag.
 * The manifest's own words are kept; a finite partition is derived only from a type written
 * as a union of literals or `boolean`.
 */

interface ManifestDeclaration {
	tagName?: string;
	customElement?: boolean;
	description?: string;
	members?: {
		kind?: string;
		name?: string;
		type?: { text?: string };
		default?: string;
		description?: string;
		attribute?: string;
		static?: boolean;
		privacy?: string;
	}[];
	attributes?: {
		name?: string;
		type?: { text?: string };
		default?: string;
		description?: string;
		fieldName?: string;
	}[];
	events?: { name?: string; type?: { text?: string }; description?: string }[];
	slots?: { name?: string; description?: string }[];
	cssProperties?: { name?: string; default?: string; description?: string }[];
}
interface Manifest {
	schemaVersion?: string;
	modules?: { declarations?: ManifestDeclaration[] }[];
}

/** The finite values a type text allows, or `undefined` when it allows others too. */
export function finiteValues(type: string | undefined): SchemaValue[] | undefined {
	if (!type) return undefined;
	const members = type
		.split('|')
		.map((member) => member.trim())
		.filter(Boolean);
	const values: SchemaValue[] = [];
	for (const member of members) {
		if (member === 'boolean') values.push(true, false);
		else if (member === 'true' || member === 'false') values.push(member === 'true');
		else if (member === 'null') values.push(null);
		else if (member === 'undefined') continue;
		else if (/^(['"]).*\1$/.test(member)) values.push(member.slice(1, -1));
		else if (/^-?\d+(\.\d+)?$/.test(member)) values.push(Number(member));
		else return undefined;
	}
	return values.length ? [...new Set(values)] : undefined;
}

function property(
	name: string,
	type: string | undefined,
	extra: Partial<PropertySchema>
): PropertySchema {
	const values = finiteValues(type);
	return {
		name,
		...(type ? { type } : {}),
		...(values ? { values } : {}),
		...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined)),
	};
}

/** Every custom element the manifest declares, by tag; the last declaration of a tag wins. */
export function readManifest(value: unknown): Map<string, ComponentSchema> {
	const manifest = value as Manifest;
	if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.modules))
		throw new TypeError('A custom elements manifest needs a modules array.');
	const schemas = new Map<string, ComponentSchema>();
	for (const module of manifest.modules)
		for (const declaration of module.declarations ?? []) {
			const tag = declaration.tagName;
			if (!tag) continue;
			const fields = (declaration.members ?? []).filter(
				(member) =>
					member.kind === 'field' && member.name && !member.static && member.privacy !== 'private'
			);
			const reflected = new Map<string, string>();
			for (const attribute of declaration.attributes ?? [])
				if (attribute.fieldName && attribute.name)
					reflected.set(attribute.fieldName, attribute.name);
			const properties = fields.map((member) =>
				property(member.name as string, member.type?.text, {
					attribute: member.attribute ?? reflected.get(member.name as string),
					default: member.default,
					description: member.description,
				})
			);
			const fieldNames = new Set(properties.map((item) => item.name));
			const attributes = (declaration.attributes ?? [])
				.filter(
					(attribute) =>
						attribute.name && !(attribute.fieldName && fieldNames.has(attribute.fieldName))
				)
				.map((attribute) =>
					property(attribute.name as string, attribute.type?.text, {
						default: attribute.default,
						description: attribute.description,
					})
				);
			schemas.set(tag, {
				tag,
				sources: ['manifest'],
				properties,
				attributes,
				slots: (declaration.slots ?? []).map((slot) => ({
					name: slot.name ?? '',
					...(slot.description ? { description: slot.description } : {}),
				})),
				events: (declaration.events ?? [])
					.filter((event) => event.name)
					.map((event) => ({
						name: event.name as string,
						...(event.type?.text ? { type: event.type.text } : {}),
						...(event.description ? { description: event.description } : {}),
					})),
				cssProperties: (declaration.cssProperties ?? [])
					.filter((item) => item.name)
					.map((item) => ({
						name: item.name as string,
						...(item.default ? { default: item.default } : {}),
						...(item.description ? { description: item.description } : {}),
					})),
				commands: [],
				// A manifest does not describe commands; only a plugin can.
				unknown: ['commands'],
			});
		}
	return schemas;
}
