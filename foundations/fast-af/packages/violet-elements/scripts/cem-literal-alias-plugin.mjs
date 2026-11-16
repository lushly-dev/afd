/**
 * Custom Elements Manifest analyzer plugin that writes a literal-union type alias's members in
 * place of its name:
 *
 *   export type ButtonAppearance = "primary" | "secondary" | "quiet";
 *   declare public appearance: ButtonAppearance;   // type: "primary" | "secondary" | "quiet"
 *
 * The analyzer keeps the alias's name, which a reader of the manifest cannot look up, so the
 * attribute's allowed values were lost (#1147). Specimen reads a union of literals as the
 * attribute's values, so the component pack and Umbel's briefs gain them with no change there.
 *
 * Only a module-level alias without type parameters whose members are all literals (or `null`,
 * `undefined`, or another such alias) is recorded. An alias declared twice with different members
 * is left as its name rather than guessed, and a type with anything but plain names and literals
 * between its `|`s (generics, functions, object types) is left as written.
 */

/** Alias name to its member texts, or null when two declarations disagree. */
const aliases = new Map();

function literalText(ts, node) {
  if (ts.isLiteralTypeNode(node)) {
    const literal = node.literal;
    if (ts.isStringLiteral(literal)) return JSON.stringify(literal.text);
    if (ts.isNumericLiteral(literal)) return literal.text;
    if (literal.kind === ts.SyntaxKind.TrueKeyword) return "true";
    if (literal.kind === ts.SyntaxKind.FalseKeyword) return "false";
    if (literal.kind === ts.SyntaxKind.NullKeyword) return "null";
    return undefined;
  }
  if (node.kind === ts.SyntaxKind.UndefinedKeyword) return "undefined";
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && !node.typeArguments) {
    return node.typeName.text;
  }
  return undefined;
}

function readAlias(ts, node) {
  if (!ts.isTypeAliasDeclaration(node) || !ts.isSourceFile(node.parent) || node.typeParameters) {
    return undefined;
  }
  const members = ts.isUnionTypeNode(node.type) ? node.type.types : [node.type];
  const texts = [];
  for (const member of members) {
    const text = literalText(ts, member);
    if (text === undefined) return undefined;
    texts.push(text);
  }
  return { name: node.name.text, texts };
}

const KEYWORDS = new Set(["null", "undefined", "true", "false"]);

/** An alias's literals with nested aliases expanded, or undefined when it cannot be resolved. */
function expand(name, seen = new Set()) {
  const texts = aliases.get(name);
  if (!texts || seen.has(name)) return undefined;
  seen.add(name);
  const out = [];
  for (const text of texts) {
    if (aliases.has(text)) {
      const nested = expand(text, seen);
      if (!nested) return undefined;
      out.push(...nested);
    } else if (/^[A-Za-z_$][\w$]*$/.test(text) && !KEYWORDS.has(text)) {
      return undefined;
    } else {
      out.push(text);
    }
  }
  return out;
}

const PLAIN_MEMBER = /^(?:[A-Za-z_$][\w$]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?)$/;

/** The type text with each alias member written out, or undefined when nothing changes. */
export function expandTypeText(text) {
  const members = text.split("|").map(member => member.trim());
  if (members.some(member => !PLAIN_MEMBER.test(member))) return undefined;
  let changed = false;
  const out = [];
  for (const member of members) {
    if (aliases.has(member)) {
      const expanded = expand(member);
      if (!expanded) return undefined;
      out.push(...expanded);
      changed = true;
    } else {
      out.push(member);
    }
  }
  return changed ? [...new Set(out)].join(" | ") : undefined;
}

export function literalAliasPlugin() {
  return {
    name: "cem-literal-alias",
    analyzePhase({ ts, node }) {
      const alias = readAlias(ts, node);
      if (!alias) return;
      const known = aliases.get(alias.name);
      if (known === undefined) {
        aliases.set(alias.name, alias.texts);
      } else if (known !== null && known.join("|") !== alias.texts.join("|")) {
        aliases.set(alias.name, null);
      }
    },
    packageLinkPhase({ customElementsManifest }) {
      for (const module of customElementsManifest.modules ?? []) {
        for (const declaration of module.declarations ?? []) {
          const typed = [
            ...(declaration.attributes ?? []),
            ...(declaration.members ?? []).filter(member => member.kind === "field"),
          ];
          for (const item of typed) {
            const expanded = item.type?.text ? expandTypeText(item.type.text) : undefined;
            if (expanded) {
              // An attribute can share its field's type object; give each its own.
              item.type = { ...item.type, text: expanded };
            }
          }
        }
      }
    },
  };
}
