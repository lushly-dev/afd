# Codemod Authoring Reference

## What is a Codemod?

A codemod is an automated code transformation that parses source code into an Abstract Syntax Tree (AST), modifies the tree, and prints it back to source code. Unlike regex-based find-and-replace, codemods understand code structure and can handle variations in formatting, nesting, and naming.

```
Source Code ──> Parse ──> AST ──> Transform ──> Print ──> Modified Code
```

## When to Write a Codemod

Write a codemod when:
- The same mechanical change applies to 10+ files
- The change follows a consistent pattern (e.g., rename API, update import path, change function signature)
- Manual editing would take more than 30 minutes and is error-prone
- The transform needs to be reproducible (other repos, future runs)

Do NOT write a codemod when:
- The change requires understanding business logic context
- Each instance needs a different approach
- There are fewer than 5 instances to change
- The change is a one-off with no future reuse

## jscodeshift (JavaScript / TypeScript)

jscodeshift is Facebook's toolkit for running codemods over JS/TS files. It wraps recast (which preserves formatting) and provides a jQuery-like API for querying and manipulating AST nodes.

### Setup

```bash
npm install -g jscodeshift
# or use npx
npx jscodeshift -t transform.js src/
```

### Transform Structure

```javascript
// transform.js
module.exports = function(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  // Find and transform
  root
    .find(j.CallExpression, {
      callee: { name: 'oldFunction' }
    })
    .replaceWith(path => {
      return j.callExpression(
        j.identifier('newFunction'),
        path.node.arguments
      );
    });

  return root.toSource();
};
```

### Common Patterns

#### Rename an Import

```javascript
module.exports = function(fileInfo, api) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);

  // import { oldName } from 'package' -> import { newName } from 'package'
  root
    .find(j.ImportSpecifier, {
      imported: { name: 'oldName' }
    })
    .forEach(path => {
      path.node.imported.name = 'newName';
      // Also update local binding if not aliased
      if (path.node.local.name === 'oldName') {
        path.node.local.name = 'newName';
      }
    });

  // Also rename all usages
  root
    .find(j.Identifier, { name: 'oldName' })
    .filter(path => {
      // Skip import specifiers (already handled)
      return path.parent.node.type !== 'ImportSpecifier';
    })
    .replaceWith(j.identifier('newName'));

  return root.toSource();
};
```

#### Change Import Source

```javascript
// import x from 'old-package' -> import x from 'new-package'
root
  .find(j.ImportDeclaration, {
    source: { value: 'old-package' }
  })
  .forEach(path => {
    path.node.source.value = 'new-package';
  });
```

#### Wrap a Function Call

```javascript
// fn(args) -> wrapper(fn(args))
root
  .find(j.CallExpression, {
    callee: { name: 'fn' }
  })
  .replaceWith(path => {
    return j.callExpression(
      j.identifier('wrapper'),
      [path.node]
    );
  });
```

#### Add an Argument to a Function Call

```javascript
// fetchData(url) -> fetchData(url, { timeout: 5000 })
root
  .find(j.CallExpression, {
    callee: { name: 'fetchData' }
  })
  .filter(path => path.node.arguments.length === 1)
  .forEach(path => {
    path.node.arguments.push(
      j.objectExpression([
        j.property(
          'init',
          j.identifier('timeout'),
          j.numericLiteral(5000)
        )
      ])
    );
  });
```

### Running jscodeshift

```bash
# Dry run (print changes without writing)
npx jscodeshift -t transform.js --dry --print src/

# Run on specific files
npx jscodeshift -t transform.js src/components/**/*.tsx

# Run with TypeScript parser
npx jscodeshift -t transform.ts --parser tsx src/

# Run with extensions filter
npx jscodeshift -t transform.js --extensions=ts,tsx src/
```

### Testing jscodeshift Transforms

```javascript
// __tests__/transform.test.js
const { applyTransform } = require('jscodeshift/dist/testUtils');
const transform = require('../transform');

describe('transform', () => {
  it('renames oldFunction to newFunction', () => {
    const input = `oldFunction(a, b);`;
    const expected = `newFunction(a, b);`;
    const result = applyTransform(transform, {}, { source: input });
    expect(result).toBe(expected);
  });

  it('handles nested calls', () => {
    const input = `wrapper(oldFunction(a));`;
    const expected = `wrapper(newFunction(a));`;
    const result = applyTransform(transform, {}, { source: input });
    expect(result).toBe(expected);
  });

  it('does not modify unrelated code', () => {
    const input = `otherFunction(a, b);`;
    const result = applyTransform(transform, {}, { source: input });
    expect(result).toBe(input);
  });
});
```

## ts-morph (TypeScript)

ts-morph provides a wrapper around the TypeScript compiler API, making programmatic TypeScript manipulation more ergonomic. It is type-aware, meaning transforms can use type information to make decisions.

### Setup

```bash
npm install ts-morph
```

### Basic Transform

```typescript
import { Project, SyntaxKind } from "ts-morph";

const project = new Project({
  tsConfigFilePath: "./tsconfig.json",
});

for (const sourceFile of project.getSourceFiles()) {
  // Find all calls to deprecated function
  sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(call => call.getExpression().getText() === "deprecatedFn")
    .forEach(call => {
      call.getExpression().replaceWithText("newFn");
    });
}

// Save all changes
project.saveSync();
```

### Type-Aware Transforms

ts-morph excels when the transform depends on type information:

```typescript
import { Project, SyntaxKind, Type } from "ts-morph";

const project = new Project({ tsConfigFilePath: "./tsconfig.json" });

for (const sourceFile of project.getSourceFiles()) {
  // Find all variables of type 'OldType' and change to 'NewType'
  sourceFile
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .filter(decl => {
      const type = decl.getType();
      return type.getText() === "OldType";
    })
    .forEach(decl => {
      const typeNode = decl.getTypeNode();
      if (typeNode) {
        typeNode.replaceWithText("NewType");
      }
    });
}

project.saveSync();
```

### Common Operations

```typescript
// Add an import
sourceFile.addImportDeclaration({
  moduleSpecifier: "@new/package",
  namedImports: ["NewComponent"],
});

// Remove an import
sourceFile
  .getImportDeclarations()
  .filter(imp => imp.getModuleSpecifierValue() === "old-package")
  .forEach(imp => imp.remove());

// Rename a symbol across the project
const myClass = sourceFile.getClassOrThrow("OldClassName");
myClass.rename("NewClassName"); // Renames all references across the project

// Add a property to an interface
const iface = sourceFile.getInterfaceOrThrow("MyInterface");
iface.addProperty({ name: "newProp", type: "string", hasQuestionToken: true });

// Change function return type
const fn = sourceFile.getFunctionOrThrow("myFunction");
fn.setReturnType("Promise<NewType>");
```

### When to Choose ts-morph over jscodeshift

| Factor | jscodeshift | ts-morph |
|---|---|---|
| Type information needed | No | Yes |
| Preserve formatting | Yes (via recast) | Partial (reformats modified nodes) |
| Cross-file references | Manual | Built-in (rename propagates) |
| JS + TS mixed codebase | Yes | TS-focused |
| Community codemods | Large ecosystem | Growing |
| Speed on large codebases | Fast | Slower (full type-check) |

## libcst (Python)

LibCST is a concrete syntax tree library for Python that preserves all formatting details (comments, whitespace, parentheses). It is the standard tool for Python codemods.

### Setup

```bash
pip install libcst
```

### Transform Structure

```python
import libcst as cst
from libcst import matchers as m

class RenameFunction(cst.CSTTransformer):
    def leave_Call(self, original_node, updated_node):
        if m.matches(updated_node.func, m.Name("old_function")):
            return updated_node.with_changes(
                func=cst.Name("new_function")
            )
        return updated_node

# Apply to a file
source = open("module.py").read()
tree = cst.parse_module(source)
modified = tree.visit(RenameFunction())
open("module.py", "w").write(modified.code)
```

### Common Patterns

#### Update Import

```python
class UpdateImport(cst.CSTTransformer):
    def leave_ImportFrom(self, original_node, updated_node):
        if m.matches(updated_node.module, m.Attribute(
            value=m.Name("old_package"),
            attr=m.Name("module")
        )):
            return updated_node.with_changes(
                module=cst.Attribute(
                    value=cst.Name("new_package"),
                    attr=cst.Name("module")
                )
            )
        return updated_node
```

#### Add Decorator

```python
class AddDecorator(cst.CSTTransformer):
    def leave_FunctionDef(self, original_node, updated_node):
        if updated_node.name.value == "my_handler":
            new_decorator = cst.Decorator(
                decorator=cst.Name("login_required")
            )
            return updated_node.with_changes(
                decorators=[*updated_node.decorators, new_decorator]
            )
        return updated_node
```

#### Remove Argument from Function Call

```python
class RemoveDeprecatedArg(cst.CSTTransformer):
    def leave_Call(self, original_node, updated_node):
        if m.matches(updated_node.func, m.Name("create_client")):
            new_args = [
                arg for arg in updated_node.args
                if not (isinstance(arg.keyword, cst.Name)
                        and arg.keyword.value == "deprecated_param")
            ]
            return updated_node.with_changes(args=new_args)
        return updated_node
```

### Running LibCST Codemods

```bash
# Using the built-in codemod runner
python -m libcst.tool codemod my_codemods.RenameFunction .

# With specific files
python -m libcst.tool codemod my_codemods.RenameFunction src/handlers/
```

### Testing LibCST Codemods

```python
from libcst.codemod import CodemodTest
from my_codemods import RenameFunction

class TestRenameFunction(CodemodTest):
    TRANSFORM = RenameFunction

    def test_renames_simple_call(self):
        self.assertCodemod(
            before="old_function(x, y)",
            after="new_function(x, y)",
        )

    def test_leaves_other_calls_unchanged(self):
        code = "other_function(x, y)"
        self.assertCodemod(before=code, after=code)
```

## Codemod Best Practices

### 1. Dry Run First

Always run in dry-run or preview mode before writing files:

```bash
# jscodeshift
npx jscodeshift -t transform.js --dry --print src/

# libcst
python -m libcst.tool codemod MyMod . --no-format  # Review output
```

### 2. Test on Representative Samples

Before running across the full codebase:
1. Identify 3-5 files with different patterns (simple, complex, edge cases)
2. Run the codemod on those files only
3. Review diffs manually
4. Fix the codemod for any missed cases

### 3. Commit Between Steps

```bash
git add -A && git commit -m "before: codemod X"
npx jscodeshift -t transform.js src/
git add -A && git commit -m "codemod: apply X transform"
npx eslint --fix src/  # Clean up formatting
git add -A && git commit -m "after: lint fix post-codemod"
```

### 4. Handle Edge Cases Explicitly

Document known limitations of the codemod:

```javascript
// This codemod handles:
// - Direct calls: oldFn(a, b)
// - Method calls: obj.oldFn(a, b)
//
// This codemod does NOT handle:
// - Dynamic calls: const fn = oldFn; fn(a, b)
// - Destructured imports: const { oldFn } = require('pkg')
// - String references: 'oldFn' in documentation
//
// Manual review needed for the above patterns.
```

### 5. Preserve Formatting

Use tools that preserve original formatting:
- jscodeshift uses recast, which preserves whitespace and comments
- libcst preserves Python formatting by design
- ts-morph may reformat modified nodes; combine with prettier post-run

### 6. Make Codemods Idempotent

Running the codemod twice should produce the same result as running it once:

```javascript
// Check if already transformed
root
  .find(j.CallExpression, {
    callee: { name: 'oldFunction' }
  })
  // Only transform if not already using newFunction
  .filter(path => path.node.callee.name !== 'newFunction')
  .replaceWith(/* ... */);
```

## Framework-Specific Codemods

### React

```bash
# Class components to function components
npx react-codemod class-to-function-component src/

# React 18 to 19 migration
npx @codemod/cli react/19/migration src/

# PropTypes to TypeScript
npx jscodeshift -t react-codemod/transforms/proptypes-to-ts src/
```

### Angular

```bash
# Version upgrade migrations
ng update @angular/core@17 --migrate-only

# Standalone components migration
ng generate @angular/core:standalone-migration
```

### Next.js

```bash
# App Router migration
npx @next/codemod app-dir-migration src/

# Next.js version upgrades
npx @next/codemod next-image-to-legacy-image src/
```

### Python / Django

```bash
# Django upgrade codemods
pip install django-upgrade
django-upgrade --target-version 5.0 **/*.py

# Python modernization
pip install pyupgrade
pyupgrade --py312-plus **/*.py
```

## AI-Assisted Codemod Generation

When a pattern is too complex for a hand-written AST transform, use an LLM to generate the codemod:

### Workflow

1. **Describe the transform** -- Provide before/after examples and edge cases
2. **Generate the codemod** -- Ask the LLM to write a jscodeshift/ts-morph/libcst transform
3. **Test the generated codemod** -- Run on sample files and verify output
4. **Iterate** -- Fix issues in the generated codemod with additional examples
5. **Run at scale** -- Apply across the codebase with dry-run first

### Hybrid Approach

Combine deterministic codemods for well-defined patterns with LLM-generated edits for fuzzy patterns:

```
Pass 1: Run deterministic codemod (handles 80% of cases)
Pass 2: LLM reviews remaining unhandled cases
Pass 3: Human reviews LLM-generated changes
```

This hybrid approach, used by Google and Moderne, achieves higher coverage than either approach alone while maintaining quality through human review.
