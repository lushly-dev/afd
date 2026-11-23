# Pipeline variable references

Normative behavior for variable references in pipeline step inputs and `when` conditions
(`afd-pipe`, `executePipeline`, `DirectClient.pipe`). TypeScript, Python and Rust must implement
exactly this. The pipeline request comes from an untrusted client, so resolution must never reach
anything but pipeline data.

## Reference syntax

A step input value is a **reference** only when the **entire string** matches one of these forms.
References are not interpolated inside longer strings.

| Form | Resolves to |
| --- | --- |
| `$prev` / `$prev.<path>` | `data` of the previous step |
| `$first` / `$first.<path>` | `data` of the first step |
| `$steps[N]` / `$steps[N].<path>` | `data` of step `N` (0-based) |
| `$steps.<alias>` / `$steps.<alias>.<path>` | `data` of the step whose `as` is `<alias>` |
| `$input` / `$input.<path>` | the pipeline request's own `input` field |

`<path>` is a sequence of segments separated by `.`. A segment is either a key (`user`) or a key
followed by an index (`items[2]`). A purely numeric segment (`items.2`) indexes an array.

## Literals and escaping

- A string that starts with `$` but does not match a form above (for example `$9.99`, `$HOME`,
  `$prevx`) is a **literal** and passes through unchanged.
- A string that starts with `$$` is always a literal with one leading `$` removed:
  `"$$prev"` becomes `"$prev"`. This is how a client sends a literal that looks like a reference.

## What a path may reach

Resolution operates on **JSON data only**:

1. Step data is viewed as JSON before traversal: language-native objects such as Pydantic models,
   dataclasses and serde structs are converted to their JSON representation first. Resolution never
   reads object attributes, methods, prototypes or language internals.
2. A key segment resolves only to an **own key** of a JSON object. Inherited or prototype
   properties never match.
3. A segment beginning with `__` never resolves, whatever the data contains.
4. An index resolves only when it is within the bounds of a JSON array.

`$input` refers to the `input` field of the pipeline request. It is never the host's execution
context (trace IDs, auth, or other values a host passes to its executor).

## Unresolved references

If a reference cannot be resolved (unknown alias, index out of bounds, missing key, skipped or
failed step, a successful step whose result has no `data`, `__` segment, no request `input`), it
resolves to **absent**. A successful step whose `data` is `null` is not absent: a reference to it
resolves to `null`, and a path below it is absent. Absent means:

- as an object property value, the property is omitted from the step input;
- as an array element, it becomes `null`.

In `when` conditions, an unresolved reference is absent: `$exists` is `false`, and comparisons with
absent operands are `false`.

## Resolution details

- `$prev` is the `data` of the most recent **successful** step, not simply the previous step.
- A key contains any characters except `.`, `[`, `]` and whitespace. Each segment has at most one
  `[N]` suffix. A string using any other syntax is a literal: for example `$prev.a b`,
  `$steps[0][1]` and `$steps.user[0]`.
- A purely numeric segment is an own-key lookup on an object and an index on an array.
- The `__` rule applies to aliases too: `$steps.__proto__` is unresolved.
- `$$` unescaping applies at any string length. The 1024-unit limit applies only to strings
  that would otherwise be references.
- `$exists` is `false` for `null` as well as absent values.
- `$eq` and `$ne` compare **JSON values structurally** (deep equality of objects and arrays).
  Objects are never compared by identity.

## Limits

- Step inputs, and the request `input`, nested deeper than **64** levels are rejected before any
  step runs. The outermost object or array counts as level 1. The pipeline returns a
  `VALIDATION_ERROR` failure and never overflows the stack.
- Each referenced value copied into a step input is also capped at **64** levels (at most
  **128** levels combined with a 64-level template), failing that step with `VALIDATION_ERROR`.
- Repeated expansion of referenced values within a step input is bounded (at most **100,000**
  expanded values and **16 MiB** of string/key characters across the template and repeated
  expansions; the first expansion of a single referenced value is not capped for size so a
  large single step output still flows through `$prev`). Exceeding the expansion limit fails
  that step with `VALIDATION_ERROR` (`retryable: false`) without invoking the command.
- The budget is counted the same way in every implementation, per step input:
  - **Template:** every value in the template costs one value: each object, array, number,
    boolean, `null` and literal string (a `$$` literal after its escape is removed). A literal
    string also costs its characters, and each template object key costs its characters.
  - **References:** a resolved reference costs one value. An unresolved reference costs nothing
    in an object and one value (its `null`) in an array.
  - **Repeats:** the value a reference resolves to is charged in full, as if it were template,
    only when the same step input has already expanded it. An object or array is the same when it
    is the same location in the same step's data or the request `input`: `$prev` and
    `$steps[N]` naming one step reach the same values. (TypeScript compares objects by identity,
    so in-process step data that shares one object under two keys counts as one value there; data
    that arrived as JSON shares nothing.) A non-empty string is the same when it is equal. A
    referenced number, boolean, `null` or empty string is always charged: one value more.
  - **Cycles:** a reference may pass through circular in-process step data, but copying a cycle
    into a step input fails as nested too deep.
  - **Characters** are UTF-16 code units, as for references.
  - **Error:** the failure's `details` are `{ "stepIndex": <index>, "limit": "depth" | "nodes" |
    "chars" }`, naming the first limit the resolution crossed. The order object keys are walked in
    differs (Rust and C++ sort them, Python keeps insertion order, and TypeScript puts integer-like
    keys first), so an input that crosses two limits can name a different one; every
    implementation fails it.
- A reference string longer than **1024** UTF-16 code units is a literal (it is never resolved).
  The unit follows TypeScript's `string.length` (decision D3 of the parity closure plan, #283).

## Conformance

Each implementation has tests for every rule above. At minimum, the tests cover:

- the forms;
- `$9.99`, `$$prev`, a `__proto__`/`__class__`/`constructor` path;
- an out-of-bounds index;
- `$input` with and without a request `input`;
- an unresolved alias;
- 65-level nesting, in the template and in a referenced value;
- repeated fan-out of one referenced value over the value budget, and one large reference under it;
- `when` over an unresolved path.
