/**
 * Custom Elements Manifest analyzer plugin for FAST's imperative attribute registration:
 *
 *   attr(VioletX.prototype, "name");
 *   attr({ mode: "boolean" })(VioletX.prototype, "disabled");
 *   attr({ attribute: "supporting-text" })(VioletX.prototype, "supportingText");
 *
 * The built-in analyzer only understands `@attr` decorators, so these classes ended up with
 * `attributes: []`. This plugin records each call while walking the module, then copies the
 * matching `declare public` field's type, description, and default onto a manifest attribute
 * and links the field back to it via `attribute` / `reflects`.
 */

const pending = new WeakMap();

function stringLiteral(ts, node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

function readOptions(ts, node) {
  const options = {};

  if (!node || !ts.isObjectLiteralExpression(node)) {
    return options;
  }

  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
      const value = stringLiteral(ts, property.initializer);
      if (value !== undefined) {
        options[property.name.text] = value;
      }
    }
  }

  return options;
}

/** Matches `attr(Proto, "name")` and `attr({ ... })(Proto, "name")`. */
function readAttrCall(ts, node) {
  if (!ts.isCallExpression(node)) {
    return undefined;
  }

  const callee = node.expression;
  let options = {};

  if (ts.isCallExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "attr") {
    options = readOptions(ts, callee.arguments[0]);
  } else if (!(ts.isIdentifier(callee) && callee.text === "attr")) {
    return undefined;
  }

  const [target, name] = node.arguments;
  const propertyName = stringLiteral(ts, name);

  if (
    !target ||
    propertyName === undefined ||
    !ts.isPropertyAccessExpression(target) ||
    target.name.text !== "prototype" ||
    !ts.isIdentifier(target.expression)
  ) {
    return undefined;
  }

  return {
    className: target.expression.text,
    fieldName: propertyName,
    attribute: options.attribute ?? propertyName.toLowerCase(),
    mode: options.mode ?? "reflect",
  };
}

/** Matches `@attr` / `@attr({ ... })` on a class property (the analyzer skips `declare` fields). */
function readAttrDecorator(ts, node) {
  if (!ts.isPropertyDeclaration(node) || !ts.isIdentifier(node.name) || !ts.isClassDeclaration(node.parent) || !node.parent.name) {
    return undefined;
  }

  for (const decorator of ts.getDecorators?.(node) ?? []) {
    const expression = decorator.expression;
    const identifier = ts.isCallExpression(expression) ? expression.expression : expression;

    if (ts.isIdentifier(identifier) && identifier.text === "attr") {
      const options = ts.isCallExpression(expression) ? readOptions(ts, expression.arguments[0]) : {};

      return {
        className: node.parent.name.text,
        fieldName: node.name.text,
        attribute: options.attribute ?? node.name.text.toLowerCase(),
        mode: options.mode ?? "reflect",
      };
    }
  }

  return undefined;
}

export function fastAttrPlugin() {
  return {
    name: "violet-fast-attr",
    analyzePhase({ ts, node, moduleDoc }) {
      const call = readAttrCall(ts, node) ?? readAttrDecorator(ts, node);

      if (call) {
        pending.set(moduleDoc, [...(pending.get(moduleDoc) ?? []), call]);
      }
    },
    moduleLinkPhase({ moduleDoc }) {
      for (const call of pending.get(moduleDoc) ?? []) {
        const declaration = moduleDoc.declarations?.find(item => item.kind === "class" && item.name === call.className);

        if (!declaration) {
          continue;
        }

        declaration.attributes ??= [];

        if (declaration.attributes.some(attribute => attribute.name === call.attribute)) {
          continue;
        }

        const field = declaration.members?.find(member => member.kind === "field" && member.name === call.fieldName);
        const attribute = { name: call.attribute };

        if (field?.description) {
          attribute.description = field.description;
        }

        if (call.mode === "boolean") {
          attribute.type = { text: "boolean" };
        } else if (field?.type) {
          attribute.type = field.type;
        }

        if (field?.default !== undefined) {
          attribute.default = field.default;
        }

        attribute.fieldName = call.fieldName;
        declaration.attributes.push(attribute);

        if (field) {
          field.attribute = call.attribute;

          if (call.mode !== "fromView") {
            field.reflects = true;
          }
        }
      }

      pending.delete(moduleDoc);
    },
  };
}
