/**
 * @fileoverview Loam's JSON Schema 2020-12 validator over Zod (#871): wraps `z.fromJSONSchema` to
 * close the three differences the manifest rule cannot refuse:
 *
 * - `pattern` and `patternProperties` compile with the `u` flag, so `.`, `\S`, `\W`, `\D` and
 *   negated classes match whole Unicode code points (including astral characters such as emoji);
 * - `type: "integer"` accepts every finite integer (`Number.isInteger`), including values above 2^53;
 * - an input's own `__proto__` key (as `JSON.parse` makes one) is checked against
 *   `additionalProperties: false`, `additionalProperties` schemas, `patternProperties`,
 *   `propertyNames`, `minProperties` and `maxProperties` before being stripped from parsed output.
 */

import { type ZodType, z } from 'zod';

type Node = Record<string, unknown>;
type JsonSchemaInput = Parameters<typeof z.fromJSONSchema>[0];

const isNode = (value: unknown): value is Node =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const COMPOSITION = ['anyOf', 'oneOf', 'allOf', 'not', 'default', 'readOnly'] as const;

function stripComposition(node: Node): Node {
	const copy: Node = { ...node };
	for (const key of COMPOSITION) delete copy[key];
	return copy;
}

/**
 * Recursively copy plain objects and arrays without any own `__proto__` key (#871), so open
 * sub-objects or untyped values validated from JSON cannot carry a raw `__proto__` key to hosts.
 */
export function stripOwnProto<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((item) => stripOwnProto(item)) as T;
	}
	if (!isNode(value)) return value;
	const clean: Record<string, unknown> = {};
	for (const key of Object.keys(value)) {
		if (key === '__proto__') continue;
		const prop = Object.getOwnPropertyDescriptor(value, key)?.value;
		Object.defineProperty(clean, key, {
			value: stripOwnProto(prop),
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	return clean as T;
}

function resolveRef(root: Node, ref: string): unknown {
	if (ref === '#') return root;
	const decode = (name: string) => name.replaceAll('~1', '/').replaceAll('~0', '~');
	if (ref.startsWith('#/$defs/')) {
		const defs = isNode(root.$defs) ? root.$defs : undefined;
		const name = decode(ref.slice(8));
		if (defs && Object.hasOwn(defs, name)) return defs[name];
	}
	if (ref.startsWith('#/definitions/')) {
		const defs = isNode(root.definitions) ? root.definitions : undefined;
		const name = decode(ref.slice(14));
		if (defs && Object.hasOwn(defs, name)) return defs[name];
	}
	throw new Error(`Unresolved $ref: ${ref}`);
}

/** Whether `node` or any reachable subschema triggers one of the three Zod/JSON Schema differences. */
function needsCustom(node: unknown, root: Node, seen: Set<unknown>): boolean {
	if (!isNode(node) || seen.has(node)) return false;
	seen.add(node);
	if (typeof node.pattern === 'string') return true;
	if (node.type === 'integer' || (Array.isArray(node.type) && node.type.includes('integer')))
		return true;
	if (
		isNode(node.patternProperties) ||
		isNode(node.additionalProperties) ||
		node.additionalProperties === false ||
		typeof node.minProperties === 'number' ||
		typeof node.maxProperties === 'number'
	) {
		return true;
	}
	if (typeof node.$ref === 'string') {
		try {
			return needsCustom(resolveRef(root, node.$ref), root, seen);
		} catch {
			return false;
		}
	}
	for (const key of ['additionalProperties', 'propertyNames', 'items', 'contains', 'not']) {
		if (needsCustom(node[key], root, seen)) return true;
	}
	for (const key of ['properties', '$defs', 'definitions']) {
		const map = node[key];
		if (isNode(map)) {
			for (const child of Object.values(map)) if (needsCustom(child, root, seen)) return true;
		}
	}
	for (const key of ['prefixItems', 'anyOf', 'oneOf', 'allOf']) {
		const list = node[key];
		if (Array.isArray(list)) {
			for (const child of list) if (needsCustom(child, root, seen)) return true;
		}
	}
	return false;
}

/** Structural equality for JSON Schema `uniqueItems` (numbers, strings, arrays, plain objects). */
function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a)) {
		return Array.isArray(b) && a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
	}
	if (Array.isArray(b)) return false;
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	return aKeys.every(
		(key) =>
			Object.hasOwn(b, key) &&
			deepEqual(
				Object.getOwnPropertyDescriptor(a, key)?.value,
				Object.getOwnPropertyDescriptor(b, key)?.value
			)
	);
}

function hasUniqueItems(items: unknown[]): boolean {
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			if (deepEqual(items[i], items[j])) return false;
		}
	}
	return true;
}

/**
 * Convert a JSON Schema 2020-12 schema into a Zod schema, honouring `u`-flag regex patterns,
 * arbitrary finite integers and own `__proto__` keys on objects while stripping `__proto__` from
 * the parsed output.
 */
export function fromJsonSchema(schema: unknown): ZodType {
	if (!isNode(schema)) return z.fromJSONSchema(schema as JsonSchemaInput);
	if (!needsCustom(schema, schema, new Set())) {
		return z.fromJSONSchema(schema as JsonSchemaInput);
	}
	const root = schema;
	const refs = new Map<string, ZodType>();
	const building = new Set<string>();

	const convert = (node: unknown): ZodType => {
		if (typeof node === 'boolean') return node ? z.any() : z.never();
		if (!isNode(node)) return z.fromJSONSchema(node as JsonSchemaInput);

		// Reject the same unsupported JSON Schema keywords that `z.fromJSONSchema` throws on.
		if (node.not !== undefined) {
			if (isNode(node.not) && Object.keys(node.not).length === 0) return z.never();
			throw new Error('not is not supported in Zod (except { not: {} } for never)');
		}
		if (node.unevaluatedItems !== undefined) {
			throw new Error('unevaluatedItems is not supported');
		}
		if (node.unevaluatedProperties !== undefined) {
			throw new Error('unevaluatedProperties is not supported');
		}
		if (node.if !== undefined || node.then !== undefined || node.else !== undefined) {
			throw new Error('Conditional schemas (if/then/else) are not supported');
		}
		if (node.dependentSchemas !== undefined || node.dependentRequired !== undefined) {
			throw new Error('dependentSchemas and dependentRequired are not supported');
		}

		if (typeof node.$ref === 'string') {
			const ref = node.$ref;
			const cached = refs.get(ref);
			if (cached) return cached;
			if (building.has(ref)) return z.lazy(() => refs.get(ref) as ZodType);
			building.add(ref);
			const built = convert(resolveRef(root, ref));
			building.delete(ref);
			refs.set(ref, built);
			return built;
		}

		let base: ZodType = convertBase(node);
		const hasExplicitType =
			node.type !== undefined || node.enum !== undefined || node.const !== undefined;

		if (Array.isArray(node.anyOf)) {
			const options = node.anyOf.map(convert);
			const union =
				options.length === 0
					? z.never()
					: options.length === 1
						? (options[0] as ZodType)
						: z.union(options as [ZodType, ZodType, ...ZodType[]]);
			base = hasExplicitType ? z.intersection(base, union) : union;
		}
		if (Array.isArray(node.oneOf)) {
			const options = node.oneOf.map(convert);
			const exclusive =
				options.length === 0
					? z.never()
					: options.length === 1
						? (options[0] as ZodType)
						: z.xor(options as [ZodType, ZodType, ...ZodType[]]);
			base = hasExplicitType ? z.intersection(base, exclusive) : exclusive;
		}
		if (Array.isArray(node.allOf)) {
			if (node.allOf.length === 0) {
				base = hasExplicitType ? base : z.any();
			} else {
				let acc = hasExplicitType ? base : convert(node.allOf[0]);
				const start = hasExplicitType ? 0 : 1;
				for (let i = start; i < node.allOf.length; i++) {
					acc = z.intersection(acc, convert(node.allOf[i]));
				}
				base = acc;
			}
		}
		if (node.readOnly === true) base = base.readonly();
		if (node.default !== undefined) base = base.default(node.default);
		return base;
	};

	const convertBase = (node: Node): ZodType => {
		if (node.enum !== undefined || node.const !== undefined) {
			return z.fromJSONSchema(stripComposition(node) as JsonSchemaInput);
		}
		const { type } = node;
		if (Array.isArray(type)) {
			const variants = type.map((t) => convertBase({ ...node, type: t }));
			if (variants.length === 0) return z.never();
			if (variants.length === 1) return variants[0] as ZodType;
			return z.union(variants as [ZodType, ZodType, ...ZodType[]]);
		}
		if (type === undefined) return z.any();
		switch (type) {
			case 'string': {
				const clean = stripComposition(node);
				if (typeof clean.pattern !== 'string') {
					return z.fromJSONSchema(clean as JsonSchemaInput);
				}
				const { pattern, ...rest } = clean;
				return (z.fromJSONSchema(rest as JsonSchemaInput) as z.ZodString).regex(
					new RegExp(pattern, 'u')
				);
			}
			case 'integer': {
				const clean = stripComposition(node);
				return z
					.fromJSONSchema({ ...clean, type: 'number' } as JsonSchemaInput)
					.refine((value) => typeof value === 'number' && Number.isInteger(value), {
						message: 'Invalid input: expected int, received number',
					});
			}
			case 'number':
			case 'boolean':
			case 'null':
				return z.fromJSONSchema(stripComposition(node) as JsonSchemaInput);
			case 'array':
				return convertArray(node);
			case 'object':
				return convertObject(node);
			default:
				return z.fromJSONSchema(stripComposition(node) as JsonSchemaInput);
		}
	};

	const convertArray = (node: Node): ZodType => {
		const prefixItems = Array.isArray(node.prefixItems) ? node.prefixItems : undefined;
		const items = node.items;
		let arraySchema: ZodType;
		if (prefixItems) {
			const minItems = typeof node.minItems === 'number' ? node.minItems : 0;
			const positional = prefixItems.map((item, index) => {
				const converted = convert(item);
				return index < minItems ? converted : converted.optional();
			});
			const tuple = z.tuple(positional as [ZodType, ...ZodType[]]);
			const rest =
				items === false
					? undefined
					: items === true || items === undefined
						? z.any()
						: convert(items);
			arraySchema = rest ? tuple.rest(rest) : tuple;
			if (typeof node.minItems === 'number') {
				const min = node.minItems;
				arraySchema = arraySchema.refine((value) => Array.isArray(value) && value.length >= min, {
					message: `Too small: expected array to have >=${min} items`,
				});
			}
			if (typeof node.maxItems === 'number') {
				const max = node.maxItems;
				arraySchema = arraySchema.refine((value) => Array.isArray(value) && value.length <= max, {
					message: `Too big: expected array to have <=${max} items`,
				});
			}
		} else if (items !== undefined) {
			let list = z.array(convert(items));
			if (typeof node.minItems === 'number') list = list.min(node.minItems);
			if (typeof node.maxItems === 'number') list = list.max(node.maxItems);
			arraySchema = list;
		} else {
			arraySchema = z.array(z.any());
		}
		// Run `uniqueItems` and `contains` on the raw array before item defaults or key stripping run.
		if (node.uniqueItems === true || node.contains !== undefined) {
			const checkUnique = node.uniqueItems === true;
			const containsSchema = node.contains !== undefined ? convert(node.contains) : undefined;
			const minContains = typeof node.minContains === 'number' ? node.minContains : 1;
			const maxContains = typeof node.maxContains === 'number' ? node.maxContains : undefined;
			arraySchema = z
				.unknown()
				.superRefine((raw, ctx) => {
					if (!Array.isArray(raw)) return;
					if (checkUnique && !hasUniqueItems(raw)) {
						ctx.addIssue({ code: 'custom', message: 'Array items must be unique' });
					}
					if (containsSchema) {
						let matches = 0;
						for (const item of raw) if (containsSchema.safeParse(item).success) matches++;
						if (matches < minContains || (maxContains !== undefined && matches > maxContains)) {
							ctx.addIssue({
								code: 'custom',
								message: 'Array does not satisfy contains constraint',
							});
						}
					}
				})
				.pipe(arraySchema);
		}
		return arraySchema;
	};

	const convertObject = (node: Node): ZodType => {
		const properties = isNode(node.properties) ? node.properties : {};
		const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
		const shape: Record<string, ZodType> = {};
		for (const [key, propSchema] of Object.entries(properties)) {
			const converted = convert(propSchema);
			Object.defineProperty(shape, key, {
				value: required.has(key) ? converted : converted.optional(),
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
		const patternEntries = isNode(node.patternProperties)
			? Object.entries(node.patternProperties).map(
					([pattern, child]) => [new RegExp(pattern, 'u'), convert(child)] as const
				)
			: undefined;
		const additionalSchema = isNode(node.additionalProperties)
			? convert(node.additionalProperties)
			: undefined;
		const strict = node.additionalProperties === false;

		let inner: ZodType;
		if (patternEntries) {
			// Apply parsed `patternProperties` outputs so defaults and `__proto__` stripping from
			// matched subschemas are preserved instead of passing raw input values through.
			inner = z
				.object(shape)
				.passthrough()
				.transform((parsed) => {
					const out: Record<string, unknown> = {};
					for (const key of Object.keys(parsed)) {
						if (key === '__proto__') continue;
						let value = Object.getOwnPropertyDescriptor(parsed, key)?.value;
						if (!Object.hasOwn(properties, key)) {
							for (const [regex, valueSchema] of patternEntries) {
								if (!regex.test(key)) continue;
								const res = valueSchema.safeParse(value);
								if (res.success) value = res.data;
							}
						}
						Object.defineProperty(out, key, {
							value,
							enumerable: true,
							writable: true,
							configurable: true,
						});
					}
					return out;
				});
		} else if (strict) {
			inner = z.object(shape).strict();
		} else if (additionalSchema) {
			inner = z.object(shape).catchall(additionalSchema);
		} else {
			inner = z.object(shape).passthrough();
		}

		const hasKeyGuard = node.propertyNames !== undefined && node.propertyNames !== true;
		const keySchema = hasKeyGuard
			? convert(
					isNode(node.propertyNames) &&
						node.propertyNames.type === undefined &&
						node.propertyNames.$ref === undefined &&
						node.propertyNames.enum === undefined &&
						node.propertyNames.const === undefined
						? { type: 'string', ...node.propertyNames }
						: node.propertyNames
				)
			: undefined;
		const minProperties = typeof node.minProperties === 'number' ? node.minProperties : undefined;
		const maxProperties = typeof node.maxProperties === 'number' ? node.maxProperties : undefined;

		// Run key-level checks on the raw object BEFORE Zod strips an own `__proto__` key, so
		// `patternProperties`, `additionalProperties`, `propertyNames` and key-count bounds all see it.
		if (
			patternEntries ||
			additionalSchema ||
			strict ||
			keySchema ||
			minProperties !== undefined ||
			maxProperties !== undefined
		) {
			return z
				.unknown()
				.superRefine((raw, ctx) => {
					if (!isNode(raw)) return;
					const ownKeys = Object.keys(raw);
					if (minProperties !== undefined && ownKeys.length < minProperties) {
						ctx.addIssue({
							code: 'custom',
							message: `Object must have at least ${minProperties} properties`,
						});
					}
					if (maxProperties !== undefined && ownKeys.length > maxProperties) {
						ctx.addIssue({
							code: 'custom',
							message: `Object must have at most ${maxProperties} properties`,
						});
					}
					const unrecognized: string[] = [];
					for (const key of ownKeys) {
						if (keySchema) {
							const keyResult = keySchema.safeParse(key);
							if (!keyResult.success) {
								for (const issue of keyResult.error.issues) {
									ctx.addIssue({ ...issue, path: [key, ...issue.path] });
								}
							}
						}
						const value = Object.getOwnPropertyDescriptor(raw, key)?.value;
						if (patternEntries) {
							let matched = false;
							for (const [regex, valueSchema] of patternEntries) {
								if (!regex.test(key)) continue;
								matched = true;
								const parsed = valueSchema.safeParse(value);
								if (!parsed.success) {
									for (const issue of parsed.error.issues) {
										ctx.addIssue({ ...issue, path: [key, ...issue.path] });
									}
								}
							}
							if (strict && !matched && !Object.hasOwn(properties, key)) {
								unrecognized.push(key);
							}
						} else if (additionalSchema && key === '__proto__' && !Object.hasOwn(properties, key)) {
							const parsed = additionalSchema.safeParse(value);
							if (!parsed.success) {
								for (const issue of parsed.error.issues) {
									ctx.addIssue({ ...issue, path: [key, ...issue.path] });
								}
							}
						} else if (strict && key === '__proto__' && !Object.hasOwn(properties, key)) {
							unrecognized.push(key);
						}
					}
					if (unrecognized.length > 0) {
						ctx.addIssue({
							code: 'unrecognized_keys',
							keys: unrecognized,
							message: `Unrecognized key(s): ${unrecognized.join(', ')}`,
						});
					}
				})
				.pipe(inner);
		}
		return inner;
	};

	return convert(root);
}
