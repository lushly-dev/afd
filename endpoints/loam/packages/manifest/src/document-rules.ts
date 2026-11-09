/**
 * @fileoverview `ui.documents` (documents specification, 2.1; D23, D46, D79): each type's rules beyond the
 * schema, served from phase 2's step 9. Each has a case in `profile-cases.json`. A template's `content`
 * against its type's `content_schema` is `app check`'s and `app pack`'s, which read the files (2.1).
 */

import { inputSchemaProblem } from './core-rules.js';
import type { ManifestRefusalCode, ManifestV2 } from './types.js';

type Refuse = (
	code: ManifestRefusalCode,
	pointer: string,
	message: string,
	suggestion: string
) => void;

/** A type's id: the plugin's id, or `<plugin id>-<name>` (2.1). */
const TYPE_ID = /^[a-z][a-z0-9]{0,31}(-[a-z][a-z0-9]{0,31})?$/;

/** Whether a command's packed input schema requires each property, as a string where `string` says so. */
function takes(command: { input_schema?: unknown } | undefined, names: string[]): boolean {
	const schema = command?.input_schema as
		| { properties?: Record<string, { type?: unknown }>; required?: unknown[] }
		| undefined;
	return names.every(
		(name, index) =>
			schema?.required?.includes(name) === true &&
			(index > 0 || schema.properties?.[name]?.type === 'string')
	);
}

/** `ui.documents`' rules, for a manifest that passed the schema. `element` checks a custom element name. */
export function documentRules(
	manifest: ManifestV2,
	refuse: Refuse,
	element: (name: string | undefined, pointer: string) => void
): void {
	const types = manifest.ui?.documents;
	if (!types) return;
	const { id: plugin, kind } = manifest.plugin;
	if (kind === 'mounted') {
		refuse(
			'MANIFEST_SURFACE_KIND',
			'/ui/documents',
			"A mounted app declares no document type: its editor would be a server's resource, which phase 5 serves.",
			'Remove `ui.documents`, or make the app `native` or `view`.'
		);
		return;
	}
	if (!(manifest.grants ?? []).some((grant) => grant.name === 'store')) {
		refuse(
			'GRANT_REQUIRED',
			'/ui/documents',
			"A document type's content lives in the `store` grant, which this app does not declare.",
			'Declare `[[grants]] name = "store"`.'
		);
	}
	const commands = new Map((manifest.commands ?? []).map((command) => [command.name, command]));
	const levels = manifest.app?.scope_levels ?? ['workspace'];
	const resources = new Set((manifest.ui?.resources ?? []).map((resource) => resource.uri));
	const ids = new Set<string>();
	types.forEach((type, index) => {
		const at = `/ui/documents/${index}`;
		if (!TYPE_ID.test(type.id) || type.id.split('-')[0] !== plugin || ids.has(type.id)) {
			refuse(
				'DOCUMENT_TYPE_ID_INVALID',
				`${at}/id`,
				`\`${type.id}\` is not a type id of this app, or is repeated.`,
				`Use \`${plugin}\` or \`${plugin}-<name>\`, in lowercase letters and digits, once each.`
			);
		}
		ids.add(type.id);
		const [problem, remedy] = inputSchemaProblem(type.content_schema) ?? [];
		if (problem) {
			refuse(
				'MANIFEST_INPUT_SCHEMA_INVALID',
				`${at}/content_schema`,
				`This \`content_schema\` is refused: ${problem}.`,
				remedy ?? 'Declare a `type: object` schema Zod can read.'
			);
		}
		const command = (name: string | undefined, pointer: string, ok: boolean, rule: string) => {
			if (name !== undefined && (!commands.has(name) || !ok)) {
				refuse(
					'DOCUMENT_COMMAND_INVALID',
					pointer,
					`\`${name}\` is not a command of this app that ${rule}.`,
					`Declare \`${name}\` so that it ${rule}.`
				);
			}
		};
		const instance = 'takes a required string `document`';
		type.instance_commands.forEach((name, at2) => {
			command(
				name,
				`${at}/instance_commands/${at2}`,
				takes(commands.get(name), ['document']),
				instance
			);
		});
		// Each is one of the type's instance commands, so its content passes 4.2's check and 4.4's bound.
		const listed = (name: string | undefined) => type.instance_commands.includes(name as string);
		const exported = commands.get(type.export_command as string);
		command(
			type.export_command,
			`${at}/export_command`,
			listed(type.export_command) && exported?.effects.join() === 'inspect',
			`is one of \`instance_commands\`, with \`effects = ["inspect"]\``
		);
		command(
			type.import_command,
			`${at}/import_command`,
			listed(type.import_command) &&
				takes(commands.get(type.import_command as string), ['document', 'content']),
			'is one of `instance_commands`, and takes `document` and `content`'
		);
		if (type.scope_levels?.some((level) => !levels.includes(level))) {
			refuse(
				'DOCUMENT_SCOPE_INVALID',
				`${at}/scope_levels`,
				"A type's levels are a subset of `app.scope_levels`.",
				`Use only ${levels.join(' and ')}, or widen \`app.scope_levels\`.`
			);
		}
		for (const part of ['editor', 'embed'] as const) {
			const surface = type[part];
			if (!surface) continue;
			const pointer = `${at}/${part}`;
			if (
				kind === 'native'
					? surface.element === undefined || surface.resource !== undefined
					: surface.resource === undefined || surface.element !== undefined
			) {
				refuse(
					'MANIFEST_SURFACE_KIND',
					pointer,
					`A ${kind} type's \`${part}\` is ${kind === 'native' ? 'an `element`' : 'a `resource`'} alone.`,
					kind === 'native'
						? 'Name the element, and remove `resource`.'
						: 'Name one of `ui.resources`, and remove `element`.'
				);
			} else if (surface.resource !== undefined && !resources.has(surface.resource)) {
				refuse(
					'MANIFEST_RESOURCE_UNKNOWN',
					`${pointer}/resource`,
					`\`${surface.resource}\` is not in \`ui.resources\`.`,
					'Declare it in `ui.resources`.'
				);
			}
			element(surface.element, `${pointer}/element`);
		}
		if (type.inspector) {
			if (kind !== 'native') {
				refuse(
					'MANIFEST_SURFACE_KIND',
					`${at}/inspector`,
					'A view type has no inspector: it would need a second sandboxed frame.',
					'Remove `inspector`.'
				);
			}
			element(type.inspector.element, `${at}/inspector/element`);
		}
		if (type.binding.model === 'crdt') {
			refuse(
				'BINDING_MODEL_UNAVAILABLE',
				`${at}/binding/model`,
				'`model = "crdt"` waits for the collaboration specification, which chooses a library.',
				'Use `model = "command"` until then.'
			);
		}
		const templates = new Set<string>();
		if (type.templates.length < 1 || type.templates.length > 20) {
			refuse(
				'DOCUMENT_TEMPLATE_INVALID',
				`${at}/templates`,
				'A type has 1 to 20 templates.',
				'Declare at least one template, and at most 20.'
			);
		}
		type.templates.forEach((template, at2) => {
			if (templates.has(template.id)) {
				refuse(
					'DOCUMENT_TEMPLATE_INVALID',
					`${at}/templates/${at2}/id`,
					`The template \`${template.id}\` is repeated.`,
					'Give each template its own id.'
				);
			}
			templates.add(template.id);
		});
	});
}
