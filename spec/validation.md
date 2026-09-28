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
| `code` | One of the Zod issue codes below. |
| `expected` | Present only when `code` is `invalid_type` (see below). |
| `message` | Human-readable text. Implementations should use the TypeScript wording below. |

| Code | Raised by | TypeScript `message` |
| --- | --- | --- |
| `invalid_type` | A value of the wrong JSON type, or an absent required property | `Invalid input: expected <expected>, received <received>` |
| `invalid_value` | `enum` or `const`, whatever the value's type | `Invalid option: expected one of "a"\|"b"`, or `Invalid input: expected "a"` for a single value |
| `too_small` / `too_big` | `minLength`/`maxLength` | `Too small: expected string to have >=N characters` / `Too big: expected string to have <=N characters` |
| `too_small` / `too_big` | `minItems`/`maxItems` | `Too small: expected array to have >=N items` / `Too big: expected array to have <=N items` |
| `too_small` / `too_big` | `minimum`, `exclusiveMinimum` / `maximum`, `exclusiveMaximum` | `Too small: expected number to be >=N` (`>N` when exclusive) / `Too big: expected number to be <=N` (`<N`) |
| `unrecognized_keys` | `additionalProperties: false` | `Unrecognized key: "a"` / `Unrecognized keys: "a", "b"` |
| `invalid_format` | `pattern`, `format` | `Invalid string: must match pattern /<pattern>/`; for a format, its own text such as `Invalid email address` |
| `invalid_union` | `anyOf`, `oneOf`, or a `type` list with more than one non-null type | `Invalid input` |
| `not_multiple_of` | `multipleOf` | `Invalid number: must be a multiple of N` |

`expected` and `received` in an `invalid_type` issue:
- `expected` is the schema's `type`: `string`, `number`, `boolean`, `object`, `array` or `null`.
- For `integer`, `expected` is `int` when the value is a number with a fraction, and `number` for
  anything else, including an absent property.
- For a `type` list of one type plus `"null"`, `expected` is that one type, for example `string`
  for `["string", "null"]`.
- For `not: {}`, `expected` is `never`.
- `received` names the value's JSON type: `undefined` for an absent property, then `null`,
  `boolean`, `number`, `string`, `array` or `object`.

An absent required property is reported the way its schema reports a value of the wrong type, with
`received undefined`:
- `invalid_value` for an `enum` or `const`;
- `invalid_union` for a `type` list with more than one non-null type;
- `invalid_type` otherwise.

Validation reports every issue it finds, in this order:
1. **Object:** the issues of each property, in the order `properties` declares them, not input
   or alphabetical order. An absent required property is reported in its declared place. The
   object's own `unrecognized_keys` issue comes last.
2. **Array:** item issues in index order, then the array's own `minItems` or `maxItems` issue.
3. **One value:**
   - A type mismatch stops further checks on that value.
   - An `enum` or `const` mismatch gives a single `invalid_value` issue.
   - When several other keywords fail on the same value, such as `minLength` and `pattern`, their
     order is not specified. The vectors avoid that case.

TypeScript does not cap the number of issues. Rust and C++ cap it, at 50 and 100. Whether to cap
is not yet specified, and no vector test has more than 4 issues.

### Field lists

The field lists describe the top level only. They are computed only when validation fails.

| Field | Contents |
| --- | --- |
| `expectedFields` | The names in the root schema's `properties`, in declaration order. Present even when the input is not an object. |
| `unexpectedFields` | The top-level input keys that are not in `properties`, in input order. Every such key is listed, even when `additionalProperties` allows it. |
| `missingFields` | The required top-level properties that are absent, in declaration order. A property that is present with `null` is not missing. |

JavaScript lists integer-like object keys, such as `"1"`, before other keys. The vectors use no
such keys.

The orders above come from the schema and the input as written. An implementation whose JSON
objects sort their keys has to preserve source order instead. Examples are C++'s `afd::Json`, and
Rust's `serde_json` without `preserve_order`.

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

Decision D3 of the [parity closure plan](../docs/features/active/parity-closure/parity-closure.plan.md)
sets these units.

- **`minLength` and `maxLength` count Unicode code points,** as JSON Schema defines.
  - A surrogate pair is one code point.
  - A combining mark or a zero-width joiner is a code point of its own. So `e` followed by U+0301 is
    two code points, and a ZWJ family emoji is five.
  - UTF-8 bytes are not counted. `日本` is two code points.
- **TypeScript's exception.** Zod counts code points from version 4.5.0, and
  `@lushly-dev/afd-server` requires `zod` `^4.5.4`.
  - A command schema built with Zod 4.0 to 4.4 counts UTF-16 code units instead. The result then
    differs for characters outside the Basic Multilingual Plane.
  - The vector tests whose result that changes carry `exceptions.typescript`.
- **Out of scope:** lone surrogates, which are not Unicode scalar values and cannot be represented
  in UTF-8 strings.
- **Arrays:** `minItems` and `maxItems` count elements.
- **Limits outside schemas count UTF-16 code units,** following TypeScript:
  - the 128-unit input cap of the similarity functions;
  - the 1024-unit reference limit of [pipeline variables](./pipeline-variables.md#limits).

## The JSON Schema subset

### Required keywords

Every implementation supports these keywords, with the semantics below.

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
| `$ref` | A local reference: `#`, `#/definitions/<name>` or `#/$defs/<name>`. References may be recursive, and they resolve against the root schema. |
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
`readOnly`, `writeOnly`, `$comment`, `$schema` and `$id`. `$id` does not change how `$ref` resolves.

### Optional keywords

An implementation may support these keywords. If it does, it follows TypeScript's semantics below.

| Keyword | Semantics |
| --- | --- |
| `pattern` | An ECMAScript regular expression, not anchored: it can match any part of the string. |
| `format` | The named format. TypeScript emits `email`, `uuid`, `date-time` and others, each together with a `pattern` that enforces it. An implementation that supports `format` rejects a format name it does not know. |
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
   2. `details.errors` has the same entries in the same order, compared by `path`, `code` and
      `expected`.
   3. The three field lists are equal, including their order and whether they are present.
   4. The suggestion equals the [layout](#suggestion) built from the implementation's own
      `details`.
   5. Issue messages should also match. When they do, the suggestion equals the vector's
      exactly.

`exceptions` names a language whose result may differ on that test, and why. The only
exceptions are TypeScript's [length unit](#length-units) with Zod before 4.5.

Coverage today:
- TypeScript: `packages/server/src/validation-vectors.test.ts` loads the vectors and runs every
  case.
- Python, Rust and C++: loading the vectors is Wave 2 work of the parity closure plan. Each
  language's failing cases are listed in its issue:
  - Python: [#310](https://github.com/lushly-dev/afd/issues/310);
  - Rust: [#311](https://github.com/lushly-dev/afd/issues/311);
  - C++: [#312](https://github.com/lushly-dev/afd/issues/312).

## Open questions

The rules below follow TypeScript or an existing implementation, but they are not yet decided.
Until they are, treat them as provisional.

1. **Key order.**
   - Current rule: field lists and sibling issues follow the schema's declaration order and the
     input's key order.
   - The cost: C++ (`afd::Json`) and Rust (`serde_json` by default) sort keys, so they would need
     order-preserving JSON.
   - The alternative: loaders compare those lists as sets.
2. **A command with no parameters.**
   - Current rule: `"properties": {}` removes every key.
   - The conflict: Rust documents that a command with no parameters accepts any input unchanged,
     yet it advertises `"properties": {}`.
3. **Issue caps.** Not specified. TypeScript reports every issue, while Rust and C++ cap them.
4. **Unknown `format` names.** Current rule: an implementation that supports `format` rejects a
   name it does not know. JSON Schema would ignore it.
5. **A defaulted property listed in `required`.** Current rule: it is optional, as in #284.
   TypeScript never emits one.
6. **D3 and TypeScript.** D3 says TypeScript differs for astral characters, but TypeScript only
   does so with Zod before 4.5. The open choice is whether to reword D3 and keep the `exceptions`
   marks, or to require Zod 4.5 and drop the marks.
