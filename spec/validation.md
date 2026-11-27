# Command input validation

Normative behavior for validating a command's input before its middleware and handler run.
TypeScript, Python, Rust and C++ must implement exactly this.
[`vectors/validation.json`](./vectors/validation.json) pins it with cases generated from TypeScript.

The contract is the input JSON Schema a command advertises, which is its MCP `inputSchema`:
- **TypeScript** derives it from the command's Zod schema with `zodToJsonSchema` (draft-07).
- **Rust and C++** declare it directly.
- **Python** derives it from a Pydantic model.

A language may validate with a native model, but for the schema it advertises it must accept,
reject and report exactly as described here.

## When validation runs

- Validation runs after the command lookup and the context check, and before middleware and the
  handler. A failure returns the error below, and no middleware or handler runs.
- The MCP `tools/call`, HTTP and `DirectClient` entry points first turn absent or `null`
  arguments into `{}`. This spec starts from that object.
- Middleware and the handler receive the **validated input**: undeclared keys are removed and
  defaults are applied. Hooks that observe calls, such as `onCommand`, receive the raw input.

## Unknown keys

What happens to a key that an object schema does not declare in `properties` depends on
`additionalProperties`:

| `additionalProperties` | Undeclared keys |
| --- | --- |
| absent | Removed, as Zod's default object does. |
| `false` | Rejected: one `unrecognized_keys` issue per object, at the object's path. |
| `true` or `{}` | Kept unchanged. |
| a schema | Each key is validated against that schema, at `<path>.<key>`, and kept. |

- The rule applies at every level: the root, nested objects, array items, `$ref` targets, and the
  branch an `anyOf` or `oneOf` selects.
- An object schema with neither `properties` nor `additionalProperties` keeps its keys.
  TypeScript never advertises one: `z.object({})` becomes `"properties": {}`, which removes every
  key.
- Removal is silent when the input is valid. When validation fails for any reason,
  `unexpectedFields` names the undeclared top-level keys (see [Field lists](#field-lists)).

## The `VALIDATION_ERROR` result

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Input validation failed",
    "suggestion": "title: Invalid input: expected string, received undefined. Unknown field(s): extra. Missing required field(s): title. Expected fields: title, priority, done",
    "details": {
      "errors": [
        {
          "path": "title",
          "message": "Invalid input: expected string, received undefined",
          "code": "invalid_type",
          "expected": "string"
        }
      ],
      "expectedFields": ["title", "priority", "done"],
      "unexpectedFields": ["extra"],
      "missingFields": ["title"]
    }
  }
}
```

- `message` is always `Input validation failed`, with no command name and no issue text.
- `details.errors` lists the issues (see [Issues](#issues)).
- `expectedFields`, `unexpectedFields` and `missingFields` are the [field lists](#field-lists).
  Each is left out when it would be empty.
- TypeScript sets no other `CommandError` field, such as `retryable`, on this error.

### Issues

Each entry of `details.errors` has these fields:

| Field | Value |
| --- | --- |
| `path` | Object keys and array indices joined with `.`, for example `filter.tags.1`. The whole input is `(root)`. Keys are not escaped. |
| `code` | One of AFD's nine normative validation issue codes below. |
| `expected` | Present only when `code` is `invalid_type`, using AFD's `expected` vocabulary below. |
| `message` | Non-empty human-readable text. Wording is advisory and is not compared byte for byte across languages unless a vector explicitly pins `exactMessage: true`. |

#### AFD validation issue codes

AFD owns its own closed validation issue code vocabulary. Implementations backed by a third-party
validator (such as Zod in TypeScript or Pydantic in Python) **MUST** map library-specific codes
explicitly into this catalog rather than passing raw library issue codes onto the wire; any
unmapped or custom refinement code maps to `custom`.

| AFD `code` | Raised by (JSON Schema) | Zod mapping | Advisory message guidance |
| --- | --- | --- | --- |
| `invalid_type` | A value of the wrong JSON type, or an absent required property | `invalid_type` | `Invalid input: expected <expected>, received <received>` |
| `invalid_value` | `enum` or `const`, whatever the value's type | `invalid_value` | `Invalid option: expected one of "a"\|"b"`, or `Invalid input: expected "a"` for a single value |
| `too_small` | `minLength`, `minItems`, `minimum`, `exclusiveMinimum` | `too_small` | `Too small: expected <kind> to ...` |
| `too_big` | `maxLength`, `maxItems`, `maximum`, `exclusiveMaximum` | `too_big` | `Too big: expected <kind> to ...` |
| `unrecognized_keys` | `additionalProperties: false` | `unrecognized_keys` | `Unrecognized key: "a"` / `Unrecognized keys: "a", "b"` |
| `invalid_format` | `pattern`, `format` | `invalid_format` | `Invalid string: must match pattern /<pattern>/`, or format-specific wording |
| `invalid_union` | `anyOf`, `oneOf`, or a `type` list with more than one non-null type | `invalid_union` | `Invalid input` |
| `not_multiple_of` | `multipleOf` | `not_multiple_of` | `Invalid number: must be a multiple of N` |
| `custom` | Programmatic refinement or any validator-specific code outside the eight schema codes above | `custom` (and default fallback for any unmapped Zod code) | Human-readable explanation of the constraint |

AFD's `expected` vocabulary (for `invalid_type` issues):
- The JSON Schema `type`: `string`, `number`, `boolean`, `object`, `array` or `null`.
- For `integer`: `int` when the value is a number with a fractional part, and `number` for
  anything else, including an absent property.
- For a `type` list of one type plus `"null"`: that one type, for example `string` for
  `["string", "null"]`.
- For `not: {}`: `never`.
- For an absent required property with no type constraint (including `{}`, `true`, or no entry in
  `properties`): `nonoptional`.
- When reporting the received JSON type in advisory messages, use `undefined` for an absent
  property, otherwise `null`, `boolean`, `number`, `string`, `array` or `object`.

An absent required property is reported the way its schema reports a value of the wrong type:
- `invalid_value` for an `enum` or `const`;
- `invalid_union` for a `type` list with more than one non-null type;
- `invalid_type` otherwise.

Validation reports every issue it finds up to the configured validation issue cap
([`execution-controls.md#validation-issue-cap`](./execution-controls.md#validation-issue-cap),
default `100` issues; truncation is never silent and sets `details.truncated: true` and
`details.limit`). The following traversal rules apply:

1. **Object:** property issues come before the object's own `unrecognized_keys` issue. Sibling
   property issues may follow declaration order or sorted key order; source order is not required.
   An absent required property is validated by its own schema like a present property.
2. **Array:** item issues follow index order, then the array's own `minItems` or `maxItems` issue.
3. **One value:**
   - A type mismatch stops further checks on that value.
   - An `enum` or `const` mismatch gives a single `invalid_value` issue.
   - When several other keywords fail on the same value, such as `minLength` and `pattern`, their
     order is not specified. The vectors avoid that case.

TypeScript keeps its existing schema declaration order. Other implementations may keep their
native JSON object representation. For a given schema and input, issue order must be deterministic.
Conformance compares issues without sibling order, preserving duplicate issues; see
[Conformance](#conformance). Input byte/depth limits may reject an input explicitly, but must not
silently truncate its validation report.

### Field lists

The field lists describe the top level only. They are computed only when validation fails.

| Field | Contents |
| --- | --- |
| `expectedFields` | The names in the root schema's `properties`. Present even when the input is not an object. |
| `unexpectedFields` | The top-level input keys that are not in `properties`. Every such key is listed, even when `additionalProperties` allows it. |
| `missingFields` | The required top-level properties without defaults that are absent. A property that is present with `null` is not missing. |

Field-list order is implementation-defined and deterministic. TypeScript retains schema declaration
order for `expectedFields` and `missingFields`, and input order for `unexpectedFields`; integer-like
JavaScript keys come first. Sorted JSON maps are also conforming. The vectors compare field-list
membership without order, preserving duplicates and whether each list is present.

### Suggestion

The suggestion is built from `details` in the same way as `formatEnhancedValidationError` in
`packages/server/src/validation.ts`. It joins these parts with `". "`, and leaves out each part that
would be empty:

1. **The issues.**
   - One issue gives `<path>: <message>`.
   - Several issues give one `- <path>: <message>` line each, joined with `\n`.
   - An issue at `(root)` shows its message only.
2. `Unknown field(s): <unexpectedFields joined with ", ">`
3. `Missing required field(s): <missingFields joined with ", ">`
4. `Expected fields: <expectedFields joined with ", ">`

With several issues, the `". "` follows the last issue line.

## Length units

Decision D3 of the [parity closure plan](../docs/features/complete/parity-closure/parity-closure.plan.md)
sets these units.

- **`minLength` and `maxLength` count Unicode code points,** as JSON Schema defines.
  - A surrogate pair is one code point.
  - A combining mark or a zero-width joiner is a code point of its own. So `e` followed by U+0301 is
    two code points, and a ZWJ family emoji is five.
  - UTF-8 bytes are not counted. `日本` is two code points.
- **Unicode code points are mandatory across every implementation.** There are no language
  length-unit exceptions in the vectors. (Implementation note: TypeScript satisfies this by
  depending on a Zod release whose string length checks count code points rather than UTF-16 units.)
- **Out of scope:** lone surrogates, which are not Unicode scalar values and cannot be represented
  in UTF-8 strings.
- **Arrays:** `minItems` and `maxItems` count elements.
- **Limits outside schemas count UTF-16 code units,** following TypeScript:
  - the 128-unit input cap of the similarity functions;
  - the 1024-unit reference limit of [pipeline variables](./pipeline-variables.md#limits).

## The JSON Schema subset

### Required keywords

Every implementation supports these keywords, with the semantics below.

**Boolean schemas.** Wherever a schema may appear (a property, `items`, `additionalProperties`, a
definition, a `$ref` target, a branch), `true` and `false` are schemas too. `true` is `{}`: it
accepts any value, and an absent required property under it is reported as `nonoptional`. `false`
is `not: {}`: it accepts no value, and its issue is `invalid_type` with `expected: "never"` and the
message `Invalid input: expected never, received <type>`. `additionalProperties: false` keeps its
own rule (one `unrecognized_keys` issue for the object), while a `$ref` to a `false` definition
there is a schema like any other. The root of an input schema is still an object: registration
refuses a boolean root. [`vectors/validation.json`](./vectors/validation.json) holds the
`boolean-schemas` case.

| Keyword | Semantics |
| --- | --- |
| `type` | A type name, or a list of names: `string`, `number`, `integer`, `boolean`, `object`, `array`, `null`. See the rules below. |
| `properties` | Each declared property that is present is validated against its schema. |
| `required` | Each listed property must be present. `null` counts as present. |
| `enum` | The value must equal one of the listed values, by JSON equality. |
| `items` | A single schema for every element. The array (tuple) form is not part of the subset. |
| `minItems`, `maxItems` | Inclusive element counts. |
| `minLength`, `maxLength` | Inclusive lengths, counted in [code points](#length-units). |
| `minimum`, `maximum` | Inclusive bounds. |
| `exclusiveMinimum`, `exclusiveMaximum` | Exclusive bounds, given as numbers (draft 6 and later). The draft-04 boolean form is not supported. |
| `additionalProperties` | A boolean or a schema; see [Unknown keys](#unknown-keys). |
| `$ref` | A local reference: `#`, `#/definitions/<name>` or `#/$defs/<name>`, where `<name>` is one JSON Pointer token (`~1` for `/`, `~0` for `~`). Any other pointer, such as `#/$defs/A/properties/x` or one into a nested `$id` subschema, fails at registration. References may be recursive. They resolve against the nearest schema resource around them: the closest subschema with its own `$id` (see [Annotations](#annotations)), or else the root schema. |
| `definitions`, `$defs` | Containers for `$ref` targets. TypeScript emits `definitions`. |
| `default` | See [Defaults](#defaults). |

`type` rules:
- `integer` accepts any number without a fractional part, so `1.0` is an integer.
- No value is ever coerced: `"7"` is not a number, `1` is not a boolean, and `"true"` is not a
  boolean.
- A list accepts a value of any listed type. TypeScript emits `["<type>", "null"]` for a nullable
  field, and a list of several types for a union of primitives.

TypeScript's `z.int()` advertises `minimum: -9007199254740991` and `maximum: 9007199254740991`.
Those bounds apply like any others.

### Annotations

These keywords are accepted and have no effect: `title`, `description`, `examples`, `deprecated`,
`readOnly`, `writeOnly`, `$comment` and `$schema`.

`$id` adds no constraint, but a string `$id` starts a schema resource, as in Draft 2020-12: a
`$ref` in that subschema, or in the subschema itself, resolves against it, so a structured-result
envelope whose `data` schema has its own `$id` and `$defs` validates as written. A bare fragment
such as `"#node"`, which draft-07 used as an anchor, starts no resource. The `$id` value is never
resolved as a URI, and a `$ref` naming one is not part of the subset.

### Optional keywords

An implementation may support these keywords. If it does, it follows TypeScript's semantics below.

| Keyword | Semantics |
| --- | --- |
| `pattern` | An ECMAScript regular expression, not anchored: it can match any part of the string. |
| `format` | The named format. TypeScript emits `email`, `uuid`, `date-time` and others, each together with a `pattern` that enforces it. An implementation that supports `format` rejects a format name it does not know at registration, naming the format and its location. |
| `const` | JSON equality. A mismatch is `invalid_value`, whatever the value's type. |
| `anyOf` | The first branch that matches produces the value, with that branch's unknown keys removed and defaults applied. If no branch matches, one `invalid_union` issue is reported at the value's path. TypeScript emits `anyOf` for a union of objects and for a nullable object. |
| `oneOf` | Exactly one branch must match. No match, or more than one, gives `invalid_union`. See the discriminator rule below. |
| `allOf` | Every branch must match, and each failing branch reports its own issues. TypeScript emits `allOf` for an intersection of non-object schemas. It also wraps the `$ref` of an optional or defaulted reused schema (one with a Zod `meta({ id })`) in a one-branch `allOf`. |
| `not` | The value must not match the subschema. TypeScript emits only `not: {}`, which no value satisfies; its issue is `invalid_type` with `expected: "never"`. |
| `multipleOf` | The value divided by the keyword's value must be an integer. |

**The `oneOf` discriminator rule.** When every branch is an object schema with a `const` property
of the same name, TypeScript uses that property as a discriminator:
- the property's value selects the branch, and that branch's issues are reported;
- an unknown value gives `invalid_union` at `<path>.<property>`.

**An unsupported keyword is rejected at registration.** An implementation that does not support an
optional keyword must reject a command whose input schema uses it, and never silently ignore it.
The rejection happens when the command is registered, and names the keyword and its location. The
same applies to every keyword outside the three lists above, for example `uniqueItems`,
`patternProperties`, `propertyNames` and `if`/`then`/`else`. C++ does this in
`CompiledSchema::compile` (`packages/cpp/include/afd/schema.hpp`).

## Explicit `null`

This section settles [#282](https://github.com/lushly-dev/afd/issues/282). `null` is a value, not
an absent property:

- **It fails unless the schema allows it.** A property whose schema does not allow `null` rejects
  it with `invalid_type`, `received null`, even when the property is optional.
  - A schema allows `null` when, for example, its `type` is `"null"` or a list that includes it,
    or its `enum` includes `null`.
- **A default never replaces it.** An explicit `null` stays `null`.
- **It is not missing.** A required property that is `null` fails its type check, and is not
  listed in `missingFields`.
- **It is kept.** Where the schema allows `null`, the handler receives the property as `null`.

These rules apply at every level.

## Defaults

This section settles [#284](https://github.com/lushly-dev/afd/issues/284).

- **Absent properties get their default,** before middleware and the handler run.
  - This happens at every level where the enclosing object is present: the root, nested objects,
    array items and `$ref` targets.
  - An absent object with no default of its own stays absent. Its properties' defaults do not
    create it.
- **A default is used as is.**
  - It is not validated against its schema.
  - Defaults declared inside it are not applied. For example, `filter` with default `{"limit": 5}`
    becomes `{"limit": 5}`, even if `filter.sort` has a default.
  - This is Zod 4's behavior.
- **A present value is always validated,** even when it equals the default.
- **A property with a default is optional.**
  - TypeScript does not list it in `required`.
  - A hand-written schema that lists a defaulted property in `required` is treated as if it did
    not: the property is never missing.

## Conformance

[`vectors/validation.json`](./vectors/validation.json) holds cases generated from TypeScript by
[`vectors/generate-validation.mjs`](./vectors/generate-validation.mjs). Each case has:
- an `id`;
- a `section` of this spec;
- a `description`;
- the `schema` TypeScript advertises;
- `optionalKeywords`: the optional keywords it uses, if any;
- `tests`.

Each test gives an `input` and one of two outcomes:
- `valid: true` with `data`, which is what the handler receives;
- `valid: false` with the `error`.

A test is identified as `<case id>[<index>]`, for example `type[4]`.

An implementation checks each case like this:

1. **Register a command** with the case's `schema` and a handler that returns its input.
   - If the case lists an optional keyword the implementation does not support, registration must
     fail, and the case ends there.
2. **Run every test** through the path an MCP call takes.
3. **For a valid test,** the call succeeds, and the data equals `data` by JSON equality. Numbers
   compare by value, so `1` equals `1.0`. Key order is ignored.
4. **For an invalid test:**
   1. `code` and `message` equal the vector's.
   2. `details.errors` has the same entries, compared as a multiset by `path`, `code` and
      `expected` (including whether `expected` is present). Preserve duplicate issues; do not
      compare sets. Sibling issue order may differ. Check array index order and parent-after-child
      issue rules separately where those structures appear.
   3. The three field lists have the same members, compared without order and preserving
      duplicates and whether each list is present.
   4. The suggestion equals the [layout](#suggestion) built from the implementation's own
      `details`.
   5. Every issue's `code` must belong to AFD's nine-code catalog, and its `message` must be a
      non-empty string. Issue `message` text is **not** compared byte for byte across languages
      unless a vector test explicitly sets `exactMessage: true`.

There are no language exceptions for the supported contract.

Coverage in the stabilization candidate:
- TypeScript: `packages/server/src/validation-vectors.test.ts` loads the vectors and runs every
  case.
- Python: `python/tests/test_validation_vectors.py` executes every case.
- Rust: `packages/rust/tests/validation_vectors.rs` executes supported cases and verifies
  registration rejection for unsupported optional keywords.
- C++: `packages/cpp/tests/vectors_test.cpp` executes every case.
- Alfred checks that all four implementations retain designated vector loaders.

This records source coverage, not publication of those implementations.

## Settled decisions

[#332](https://github.com/lushly-dev/afd/issues/332) settles the former open questions:

1. Sibling issue and field-list source order is not a cross-language requirement. TypeScript keeps
   its current order; sorted JSON implementations keep their representation. Comparison preserves
   duplicate issues and list presence, and suggestions use actual details.
2. A command advertising `"properties": {}` removes undeclared keys. An empty parameter list does
   not bypass that advertised schema. An object schema with neither `properties` nor
   `additionalProperties` keeps its keys.
3. All issues up to `maxValidationIssues` (default `100`, see
   [`execution-controls.md#validation-issue-cap`](./execution-controls.md#validation-issue-cap)) are
   reported; truncation past the cap is never silent (`details.truncated: true`, `details.limit`,
   `details.totalErrors` and an explicit note in `suggestion`). `vectors/validation.json` case
   `issue-count-capped` verifies this cap across all four languages ([#2128](https://github.com/lushly-dev/afd/issues/2128)–[#2131](https://github.com/lushly-dev/afd/issues/2131)).
4. A supported `format` with an unknown name is rejected at registration.
5. A property with a default is optional even when listed in `required`.
6. All implementations count Unicode code points for `minLength` and `maxLength`; legacy length-unit
   exceptions are removed.
