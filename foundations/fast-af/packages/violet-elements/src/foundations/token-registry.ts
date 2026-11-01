// The token values come from Loam's Violet themes, as a committed export of the component ids per
// theme (D50; endpoints/loam/docs/phases/0-kernel-chrome/spec.md, section 2.4). The retired
// master-semantic registry is no longer read; categories and tiers follow its families.
import exportText from "../../tokens/violet-theme.export.json?raw";

type TokenMetadata = {
  category: string;
  tier: string;
  cssProperty: string;
};

type TokenReferenceValue = {
  ref: string;
  transform?: string;
};

export type VioletTokenValue = string | number | TokenReferenceValue;

type VioletThemeExportToken = { id: string; value: string };

type VioletThemeExport = {
  contractVersion: number;
  source: string;
  presets: Record<string, VioletThemeExportToken[]>;
};

export type VioletRegistryToken = {
  id: string;
  /** The light value, which is also every component's literal fallback. */
  value: VioletTokenValue;
  /** The value in each preset of the export: light, dark and high-contrast. */
  presets: Record<string, string>;
  metadata: TokenMetadata;
};

export type VioletTokenRegistry = {
  contractVersion: number;
  source: string;
  package: string;
  description: string;
  tokens: VioletRegistryToken[];
};

export type VioletTokenGroup = {
  id: string;
  title: string;
  description: string;
  tokens: VioletRegistryToken[];
};

/** Family prefixes in the retired registry's order, with its category and tier for each. */
const families: ReadonlyArray<[prefix: string, category: string, tier: string]> = [
  ["color.surface.", "color", "semantic"],
  ["color.text.", "color", "semantic"],
  ["color.border.", "color", "semantic"],
  ["color.focus.", "color", "semantic"],
  ["color.control.", "color", "semantic"],
  ["color.action.", "color", "semantic"],
  ["color.state.", "color", "semantic"],
  ["color.field.", "color", "semantic"],
  ["size.font.", "typography", "global"],
  ["size.line.", "typography", "global"],
  ["weight.", "typography", "global"],
  ["type.", "typography", "semantic"],
  ["size.target.", "sizing", "global"],
  ["size.space.", "spacing", "global"],
  ["space.", "spacing", "semantic"],
  ["radius.", "radius", "semantic"],
  ["shadow.", "shadow", "semantic"],
  ["z-index.", "layer", "semantic"],
  ["duration.", "motion", "semantic"],
  ["easing.", "motion", "semantic"],
];

/**
 * The aliases the retired registry declared. The export holds resolved values, so the story's labs
 * get these chains back (`--space-inline-sm: var(--size-space-sm)`) and editing a ramp step still
 * moves the semantic tokens on it. An alias is kept only while both light values agree.
 */
const registryAliases: Readonly<Record<string, string>> = {
  "color.control.selected.background": "color.surface.selected",
  "color.field.background": "color.surface.page",
  "color.field.background.readonly": "color.surface.subtle",
  "color.field.text": "color.text.primary",
  "color.field.placeholder": "color.text.muted",
  "color.field.border": "color.border.subtle",
  "color.field.border.hover": "color.border.strong",
  "color.field.border.focus": "color.focus.ring",
  "color.field.border.invalid": "color.state.danger.border",
  "type.caption.xs.size": "size.font.xs",
  "type.caption.xs.line": "size.line.xs",
  "type.caption.xs.weight": "weight.medium",
  "type.label.sm.size": "size.font.sm",
  "type.label.sm.line": "size.line.sm",
  "type.label.sm.weight": "weight.medium",
  "type.body.md.size": "size.font.md",
  "type.body.md.line": "size.line.md",
  "type.body.md.weight": "weight.regular",
  "type.title.sm.size": "size.font.lg",
  "type.title.sm.line": "size.line.lg",
  "type.title.sm.weight": "weight.semibold",
  "type.title.md.size": "size.font.xl",
  "type.title.md.line": "size.line.xl",
  "type.title.md.weight": "weight.semibold",
  "space.inline.sm": "size.space.sm",
  "space.inline.md": "size.space.md",
  "space.inline.lg": "size.space.lg",
  "space.stack.xs": "size.space.sm",
  "space.stack.sm": "size.space.md",
  "space.stack.md": "size.space.lg",
  "space.layout.sm": "size.space.lg",
  "space.layout.md": "size.space.xl",
};

function familyIndex(tokenId: string): number {
  const index = families.findIndex(([prefix]) => tokenId.startsWith(prefix));
  return index < 0 ? families.length : index;
}

function readRegistry(text: string): VioletTokenRegistry {
  const themeExport = JSON.parse(text) as VioletThemeExport;
  const light = themeExport.presets.light ?? [];
  const lightValues = new Map(light.map(({ id, value }) => [id, value]));
  const tokens = light
    .map(({ id, value }, order) => {
      const family = families[familyIndex(id)];
      const alias = registryAliases[id];
      return {
        order,
        token: {
          id,
          value: alias !== undefined && lightValues.get(alias) === value ? { ref: alias } : value,
          presets: Object.fromEntries(
            Object.entries(themeExport.presets).map(([preset, presetTokens]) => [
              preset,
              presetTokens.find(token => token.id === id)?.value ?? value,
            ]),
          ),
          metadata: {
            category: family?.[1] ?? id.split(".")[0] ?? "",
            tier: family?.[2] ?? "semantic",
            cssProperty: tokenIdToCssVar(id),
          },
        },
      };
    })
    .sort((left, right) => familyIndex(left.token.id) - familyIndex(right.token.id) || left.order - right.order)
    .map(({ token }) => token);

  return {
    contractVersion: themeExport.contractVersion,
    source: themeExport.source,
    package: "@lushly-dev/violet-elements",
    description: `Component tokens from the ${themeExport.source} Violet themes (tokens/violet-theme.export.json).`,
    tokens,
  };
}

function titleCase(segment: string): string {
  return segment
    .split(/[-.]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function groupIdForToken(token: VioletRegistryToken): string {
  const [, family = token.metadata.category] = token.id.split(".");

  if (token.id.startsWith("size.space.")) {
    return "spacing-scale";
  }

  if (token.id.startsWith("size.target.")) {
    return "target-scale";
  }

  if (token.id.startsWith("size.font.")) {
    return "type-scale";
  }

  if (token.id.startsWith("size.line.")) {
    return "line-scale";
  }

  if (token.id.startsWith("weight.")) {
    return "font-weight";
  }

  if (token.id.startsWith("color.surface.")) {
    return "surface";
  }

  if (token.id.startsWith("color.text.")) {
    return "text";
  }

  if (token.id.startsWith("color.border.") || token.id.startsWith("color.focus.")) {
    return "structure";
  }

  if (token.id.startsWith("space.")) {
    return "spacing";
  }

  if (token.id.startsWith("type.")) {
    return "typography";
  }

  if (token.id.startsWith("radius.")) {
    return "shape";
  }

  if (token.id.startsWith("shadow.")) {
    return "elevation";
  }

  if (token.id.startsWith("duration.") || token.id.startsWith("easing.")) {
    return "motion";
  }

  return family;
}

const groupDescriptions = new Map<string, string>([
  ["spacing-scale", "Base spacing ramp values that semantic spacing tokens reference."],
  ["target-scale", "Base control target sizes used for adaptive density across fine and coarse input modes."],
  ["type-scale", "Base font-size ramp values that semantic text styles reference."],
  ["line-scale", "Base line-height ramp values that semantic text styles reference."],
  ["font-weight", "Base weight values that semantic text styles reference."],
  ["surface", "Canvas and container surfaces that define depth and hierarchy."],
  ["text", "Readable foreground values for content, metadata, and lower-emphasis copy."],
  ["structure", "Borders and focus treatments that establish separation and keyboard visibility."],
  ["spacing", "Directional spacing rhythm for inline gaps and stacked layout."],
  ["typography", "Semantic text styles for captions, labels, body copy, and titles."],
  ["shape", "Corner and silhouette values that define the system’s geometry."],
  ["elevation", "Shadow values used when layers need to rise above the surrounding surface."],
  ["motion", "Durations and easing curves that keep interface motion coherent and calm."],
]);

export const violetTokenRegistry = readRegistry(exportText);

export const violetTokenGroups: VioletTokenGroup[] = Array.from(
  violetTokenRegistry.tokens.reduce((map, token) => {
    const groupId = groupIdForToken(token);
    const existing = map.get(groupId) ?? {
      id: groupId,
      title: titleCase(groupId),
      description:
        groupDescriptions.get(groupId) ??
        "Foundational tokens in this family share a common design role.",
      tokens: [],
    };

    existing.tokens.push(token);
    map.set(groupId, existing);
    return map;
  }, new Map<string, VioletTokenGroup>())
).map(([, group]) => group);

export function tokenIdToCssVar(tokenId: string): string {
  return `--${tokenId.replace(/\./g, "-")}`;
}

function isTokenReferenceValue(value: VioletTokenValue): value is TokenReferenceValue {
  return typeof value === "object" && value !== null && "ref" in value;
}

export function tokenValueToCssValue(value: VioletTokenValue): string {
  if (isTokenReferenceValue(value)) {
    return `var(${tokenIdToCssVar(value.ref)})`;
  }

  return String(value);
}

export function buildRegistryCssVars(tokens: VioletRegistryToken[]): string {
  return tokens.map(token => `${tokenIdToCssVar(token.id)}: ${tokenValueToCssValue(token.value)};`).join("\n");
}

export function isColorToken(token: VioletRegistryToken): boolean {
  return token.metadata.category === "color";
}
