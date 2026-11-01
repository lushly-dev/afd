import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";
import rawPaletteProposalText from "../../tokens/raw-palette.proposal.jsonc?raw";

import "../button/violet-button";
import "../checkbox/violet-checkbox";
import {
  VioletDataGridColumn,
  VioletDataGridRow,
} from "../data-grid/violet-data-grid";
import "../data-grid/violet-data-grid";
import "../text-field/violet-text-field";
import {
  buildRegistryCssVars,
  isColorToken,
  tokenIdToCssVar,
  tokenValueToCssValue,
  violetTokenGroups,
  violetTokenRegistry,
} from "./token-registry";
import { referenceComponentSet } from "./reference-component-set";

type RawPaletteEntry = {
  id: string;
  hex: string;
  hsl: string;
  roleHint: string;
};

type RawPaletteProposal = {
  proposalVersion: string;
  package: string;
  description: string;
  rawPalette: RawPaletteEntry[];
  notes: string[];
};

function parseJsoncText<T>(text: string): T {
  const withoutBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLineComments = withoutBlockComments.replace(
    /(^|[^:\\])\/\/.*$/gm,
    "$1",
  );
  const withoutTrailingCommas = withoutLineComments.replace(
    /,(\s*[}\]])/g,
    "$1",
  );

  return JSON.parse(withoutTrailingCommas) as T;
}

type CultivationRow = {
  commonName: string;
  family: string;
  light: string;
  dtm: string;
  status: string;
};

const gridColumns: VioletDataGridColumn<CultivationRow>[] = [
  {
    id: "commonName",
    label: "Plant",
    sortable: true,
    value: (row) => row.commonName,
  },
  { id: "family", label: "Family", sortable: true, value: (row) => row.family },
  { id: "light", label: "Light", value: (row) => row.light },
  {
    id: "dtm",
    label: "DTM",
    sortable: true,
    align: "end",
    value: (row) => row.dtm,
  },
  { id: "status", label: "Status", value: (row) => row.status },
];

const gridRows: VioletDataGridRow<CultivationRow>[] = [
  {
    id: "black-currant",
    data: {
      commonName: "Black currant",
      family: "Grossulariaceae",
      light: "Part sun",
      dtm: "365",
      status: "Established",
    },
  },
  {
    id: "romanesco",
    data: {
      commonName: "Romanesco",
      family: "Brassicaceae",
      light: "Full sun",
      dtm: "80",
      status: "In bed",
    },
  },
  {
    id: "tomato-midnight",
    data: {
      commonName: "Midnight Roma tomato",
      family: "Solanaceae",
      light: "Full sun",
      dtm: "78",
      status: "Seedling",
    },
  },
];

const rawPaletteProposal = parseJsoncText<RawPaletteProposal>(rawPaletteProposalText);
const rawPaletteEntries = rawPaletteProposal.rawPalette;

const radiusOrder = new Map([
  ["radius.sm", 0],
  ["radius.md", 1],
  ["radius.lg", 2],
  ["radius.round", 3],
]);

const radiusTokens = violetTokenRegistry.tokens
  .filter((token) => token.id.startsWith("radius."))
  .sort((left, right) => {
    const leftRank = radiusOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = radiusOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.id.localeCompare(right.id);
  });

const targetScaleOrder = new Map([
  ["size.target.compact", 0],
  ["size.target.natural", 1],
  ["size.target.comfortable", 2],
]);

const targetRampTokens = violetTokenRegistry.tokens
  .filter((token) => token.id.startsWith("size.target."))
  .sort((left, right) => {
    const leftRank = targetScaleOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = targetScaleOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.id.localeCompare(right.id);
  });

const spacingScaleOrder = new Map([
  ["size.space.xs", 0],
  ["size.space.sm", 1],
  ["size.space.md", 2],
  ["size.space.lg", 3],
  ["size.space.xl", 4],
]);

const spacingRampTokens = violetTokenRegistry.tokens
  .filter((token) => token.id.startsWith("size.space."))
  .sort((left, right) => {
    const leftRank = spacingScaleOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = spacingScaleOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.id.localeCompare(right.id);
  });

const spacingSemanticOrder = new Map([
  ["space.inline.sm", 0],
  ["space.inline.md", 1],
  ["space.inline.lg", 2],
  ["space.stack.xs", 3],
  ["space.stack.sm", 4],
  ["space.stack.md", 5],
  ["space.layout.sm", 6],
  ["space.layout.md", 7],
]);

const spacingSemanticTokens = violetTokenRegistry.tokens
  .filter((token) => token.id.startsWith("space."))
  .sort((left, right) => {
    const leftRank = spacingSemanticOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = spacingSemanticOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.id.localeCompare(right.id);
  });

const surfaceOrder = new Map([
  ["color.surface.page", 0],
  ["color.surface.card", 1],
  ["color.surface.subtle", 2],
  ["color.surface.selected", 3],
  ["color.surface.floating", 4],
]);

const surfaceTokens = violetTokenRegistry.tokens
  .filter((token) => token.id.startsWith("color.surface."))
  .sort((left, right) => {
    const leftRank = surfaceOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = surfaceOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.id.localeCompare(right.id);
  });

const textStructureOrder = new Map([
  ["color.text.primary", 0],
  ["color.text.secondary", 1],
  ["color.text.muted", 2],
  ["color.border.subtle", 3],
  ["color.border.strong", 4],
  ["color.focus.ring", 5],
]);

const textStructureTokens = violetTokenRegistry.tokens
  .filter((token) =>
    token.id.startsWith("color.text.") ||
    token.id.startsWith("color.border.") ||
    token.id.startsWith("color.focus."),
  )
  .sort((left, right) => {
    const leftRank = textStructureOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = textStructureOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.id.localeCompare(right.id);
  });

const shadowOrder = new Map([
  ["shadow.control", 0],
  ["shadow.card", 1],
  ["shadow.floating", 2],
]);

const shadowTokens = violetTokenRegistry.tokens
  .filter((token) => token.id.startsWith("shadow."))
  .sort((left, right) => {
    const leftRank = shadowOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = shadowOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.id.localeCompare(right.id);
  });

const motionOrder = new Map([
  ["duration.fast", 0],
  ["duration.base", 1],
  ["duration.slow", 2],
  ["easing.standard", 3],
  ["easing.emphasized", 4],
]);

const motionTokens = violetTokenRegistry.tokens
  .filter((token) => token.id.startsWith("duration.") || token.id.startsWith("easing."))
  .sort((left, right) => {
    const leftRank = motionOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = motionOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.id.localeCompare(right.id);
  });

const actionStateOrder = new Map([
  ["color.action.primary.background", 0],
  ["color.action.primary.text", 1],
  ["color.action.primary.hover", 2],
  ["color.action.primary.pressed", 3],
  ["color.action.secondary.background", 4],
  ["color.action.secondary.text", 5],
  ["color.action.secondary.border", 6],
  ["color.action.secondary.hover", 7],
  ["color.action.secondary.pressed", 8],
  ["color.state.success.background", 9],
  ["color.state.success.text", 10],
  ["color.state.success.border", 11],
  ["color.state.warning.background", 12],
  ["color.state.warning.text", 13],
  ["color.state.warning.border", 14],
  ["color.state.danger.background", 15],
  ["color.state.danger.text", 16],
  ["color.state.danger.border", 17],
]);

const actionStateTokens = violetTokenRegistry.tokens
  .filter((token) =>
    token.id.startsWith("color.action.") ||
    token.id.startsWith("color.state."),
  )
  .sort((left, right) => {
    const leftRank = actionStateOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = actionStateOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.id.localeCompare(right.id);
  });

const fieldOrder = new Map([
  ["color.field.background", 0],
  ["color.field.background.readonly", 1],
  ["color.field.text", 2],
  ["color.field.placeholder", 3],
  ["color.field.border", 4],
  ["color.field.border.hover", 5],
  ["color.field.border.focus", 6],
  ["color.field.border.invalid", 7],
]);

const fieldTokens = violetTokenRegistry.tokens
  .filter((token) => token.id.startsWith("color.field."))
  .sort((left, right) => {
    const leftRank = fieldOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = fieldOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.id.localeCompare(right.id);
  });

const fontScaleOrder = new Map([
  ["size.font.xs", 0],
  ["size.font.sm", 1],
  ["size.font.md", 2],
  ["size.font.lg", 3],
  ["size.font.xl", 4],
]);

const fontScaleTokens = violetTokenRegistry.tokens
  .filter((token) => token.id.startsWith("size.font."))
  .sort((left, right) => {
    const leftRank = fontScaleOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = fontScaleOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.id.localeCompare(right.id);
  });

const lineScaleOrder = new Map([
  ["size.line.xs", 0],
  ["size.line.sm", 1],
  ["size.line.md", 2],
  ["size.line.lg", 3],
  ["size.line.xl", 4],
]);

const lineScaleTokens = violetTokenRegistry.tokens
  .filter((token) => token.id.startsWith("size.line."))
  .sort((left, right) => {
    const leftRank = lineScaleOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = lineScaleOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.id.localeCompare(right.id);
  });

const weightOrder = new Map([
  ["weight.regular", 0],
  ["weight.light", 1],
  ["weight.medium", 2],
  ["weight.semibold", 3],
]);

const weightTokens = violetTokenRegistry.tokens
  .filter((token) => token.id.startsWith("weight."))
  .sort((left, right) => {
    const leftRank = weightOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = weightOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.id.localeCompare(right.id);
  });

function statusLabel(status: "done" | "next" | "planned"): string {
  if (status === "done") {
    return "Done";
  }

  if (status === "next") {
    return "Next";
  }

  return "Planned";
}

function renderFoundationsOverview(): HTMLElement {
  const root = document.createElement("section");
  root.setAttribute("data-story", "violet-foundations-overview");
  root.innerHTML = `
    <style>
      :host, [data-story="violet-foundations-overview"] {
        ${buildRegistryCssVars(violetTokenRegistry.tokens)}
      }

      .foundations {
        display: grid;
        gap: 1.5rem;
        color: var(--color-text-primary, #18181b);
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      }

      .hero,
      .section {
        display: grid;
        gap: 0.9rem;
        padding: 1.5rem;
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        border-radius: 18px;
        background: var(--color-surface-card, #faf9f5);
        box-shadow: var(--shadow-card, 0 1px 2px rgba(28, 26, 13, 0.15), 0 5px 10px rgba(28, 26, 13, 0.06));
      }

      .hero {
        background:
          radial-gradient(circle at top left, rgba(220, 232, 255, 0.9), transparent 28%),
          linear-gradient(180deg, var(--color-surface-card, #faf9f5) 0%, var(--color-surface-page, #fffefa) 100%);
      }

      .eyebrow {
        margin: 0;
        color: var(--color-text-secondary, #414651);
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1,
      h2,
      h3,
      p {
        margin: 0;
      }

      h1 {
        font: 600 clamp(2.3rem, 4vw, 3.6rem)/0.95 "Iowan Old Style", "Palatino Linotype", serif;
      }

      .hero-copy,
      .section-copy,
      .token-description,
      .component-why,
      .component-shape {
        color: var(--color-text-secondary, #414651);
        font-size: 0.98rem;
        line-height: 1.55;
      }

      .section-header {
        display: grid;
        gap: 0.35rem;
      }

      .token-groups,
      .component-grid,
      .family-grid {
        display: grid;
        gap: 1rem;
      }

      .token-group,
      .component-card,
      .family-card {
        display: grid;
        gap: 0.8rem;
        padding: 1rem;
        border-radius: 14px;
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        background: var(--color-surface-card, #faf9f5);
      }

      .token-grid {
        display: grid;
        gap: 0.75rem;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }

      .token-card {
        display: grid;
        gap: 0.55rem;
        padding: 0.9rem;
        border-radius: 12px;
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        background: var(--color-surface-page, #fffefa);
      }

      .swatch {
        block-size: 3.25rem;
        border-radius: 10px;
        border: 1px solid var(--color-border-strong, rgba(28, 26, 13, 0.48));
      }

      .token-header {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 0.75rem;
      }

      .token-id,
      .component-card h3,
      .family-card h3 {
        font-size: 0.97rem;
        font-weight: 700;
      }

      .token-value,
      .token-tags,
      .status-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        width: fit-content;
        padding: 0.18rem 0.5rem;
        border-radius: 999px;
        background: var(--color-surface-subtle, #f0efe6);
        color: var(--color-text-secondary, #414651);
        font-size: 0.78rem;
      }

      .status-chip[data-status="done"] {
        background: var(--color-surface-selected, #ddeadf);
        color: var(--color-text-primary, #18181b);
      }

      .status-chip[data-status="next"] {
        border: 1px solid var(--color-border-strong, rgba(28, 26, 13, 0.48));
      }

      .component-list,
      .token-list {
        display: grid;
        gap: 0.35rem;
        padding-left: 1rem;
        color: var(--color-text-secondary, #414651);
      }

      .family-grid {
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }

      @container (min-width: 54rem) {
        .token-groups,
        .component-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    </style>
    <div class="foundations">
      <section class="hero">
        <p class="eyebrow">Violet Foundations</p>
        <h1>Token review needs a real catalog and a real applied surface.</h1>
        <p class="hero-copy">
          The token registry should be the source of truth, Storybook should be the visual
          review surface, and the reference component set should tell us whether the system
          actually coheres when the tokens are applied to real UI shapes.
        </p>
      </section>

      <section class="section">
        <div class="section-header">
          <p class="eyebrow">Current Registry</p>
          <h2>Foundational tokens, grouped by role</h2>
          <p class="section-copy">
            These cards are driven from the component token export of Loam's Violet themes
            (tokens/violet-theme.export.json), not a hand-maintained preview list.
          </p>
        </div>
        <div class="token-groups"></div>
      </section>

      <section class="section">
        <div class="section-header">
          <p class="eyebrow">Proposed Expansion</p>
          <h2>Reference component set for style reconciliation</h2>
          <p class="section-copy">
            This is the smallest practical set that still gives us coverage across the major
            component shapes. Once this set feels coherent, most future components inherit
            the right decisions instead of spreading drift.
          </p>
        </div>
        <div class="component-grid"></div>
      </section>

      <section class="section">
        <div class="section-header">
          <p class="eyebrow">Next Token Families</p>
          <h2>Foundation gaps the reference set will force us to resolve</h2>
        </div>
        <div class="family-grid">
          <article class="family-card">
            <h3>Action</h3>
            <p class="token-description">
              Primary and secondary action emphasis for buttons, active tabs, and highlighted affordances.
            </p>
          </article>
          <article class="family-card">
            <h3>Input</h3>
            <p class="token-description">
              Neutral control surfaces, placeholders, and stronger field-focused border language.
            </p>
          </article>
          <article class="family-card">
            <h3>State Overlays</h3>
            <p class="token-description">
              Hover, pressed, and disabled treatments that stay distinct from selected and focus states.
            </p>
          </article>
          <article class="family-card">
            <h3>Interactive Sizing</h3>
            <p class="token-description">
              Minimum targets and control-specific spacing that help small components stay usable.
            </p>
          </article>
        </div>
      </section>
    </div>
  `;

  const groupsHost = root.querySelector(".token-groups");
  const componentHost = root.querySelector(".component-grid");

  if (!groupsHost || !componentHost) {
    return root;
  }

  for (const group of violetTokenGroups) {
    const section = document.createElement("section");
    section.className = "token-group";
    section.innerHTML = `
      <div class="section-header">
        <h3>${group.title}</h3>
        <p class="token-description">${group.description}</p>
      </div>
      <div class="token-grid"></div>
    `;

    const grid = section.querySelector(".token-grid");
    if (!grid) {
      continue;
    }

    for (const token of group.tokens) {
      const card = document.createElement("article");
      card.className = "token-card";

      const swatchMarkup = isColorToken(token)
        ? `<div class="swatch" style="background: var(--${token.id.replace(
            /\./g,
            "-",
          )}, ${tokenValueToCssValue(token.value)});"></div>`
        : "";

      card.innerHTML = `
        ${swatchMarkup}
        <div class="token-header">
          <div>
            <div class="token-id">${token.id}</div>
            <div class="token-value">${tokenValueToCssValue(token.value)}</div>
          </div>
          <div class="token-tags">${token.metadata.tier}</div>
        </div>
        <p class="token-description">${token.metadata.cssProperty}</p>
        <div class="token-description"><strong>Dark:</strong> ${token.presets.dark}</div>
        <div class="token-description"><strong>High contrast:</strong> ${
          token.presets["high-contrast"]
        }</div>
      `;

      grid.append(card);
    }

    groupsHost.append(section);
  }

  for (const component of referenceComponentSet) {
    const card = document.createElement("article");
    card.className = "component-card";
    card.innerHTML = `
      <div class="token-header">
        <h3>${component.title}</h3>
        <span class="status-chip" data-status="${
          component.status
        }">${statusLabel(component.status)}</span>
      </div>
      <p class="component-shape"><strong>Shape:</strong> ${component.shape}</p>
      <div>
        <p class="component-why"><strong>Validates:</strong></p>
        <ul class="component-list">
          ${component.validates.map((item) => `<li>${item}</li>`).join("")}
        </ul>
      </div>
      <p class="component-why">${component.whyItMatters}</p>
    `;
    componentHost.append(card);
  }

  return root;
}

function renderAppliedSystem(): HTMLElement {
  const root = document.createElement("section");
  root.setAttribute("data-story", "violet-foundations-applied");
  root.innerHTML = `
    <style>
      :host, [data-story="violet-foundations-applied"] {
        ${buildRegistryCssVars(violetTokenRegistry.tokens)}
        color: var(--color-text-primary, #18181b);
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: var(--color-surface-page, #fffefa);
      }

      .system {
        display: grid;
        gap: 1.5rem;
        padding: 1.25rem;
        color: var(--color-text-primary, #18181b);
      }

      .hero {
        display: grid;
        gap: 0.75rem;
        padding: 1.5rem;
        border-radius: 20px;
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        background:
          radial-gradient(circle at top left, rgba(220, 232, 255, 0.92), transparent 26%),
          linear-gradient(180deg, var(--color-surface-card, #faf9f5) 0%, var(--color-surface-page, #fffefa) 100%);
        box-shadow: var(--shadow-card, 0 1px 2px rgba(28, 26, 13, 0.15), 0 5px 10px rgba(28, 26, 13, 0.06));
      }

      .eyebrow,
      .meta,
      .caption,
      .field-label,
      .helper,
      .menu-label {
        color: var(--color-text-secondary, #414651);
      }

      .eyebrow {
        margin: 0;
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1,
      h2,
      h3,
      p {
        margin: 0;
      }

      h1 {
        font: 600 clamp(2rem, 4vw, 3rem)/0.95 "Iowan Old Style", "Palatino Linotype", serif;
      }

      .panel-grid {
        display: grid;
        gap: 1rem;
      }

      .panel,
      .card,
      .menu,
      .preview-bar {
        display: grid;
        gap: 0.85rem;
        padding: 1rem;
        border-radius: 18px;
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        background: var(--color-surface-card, #faf9f5);
        box-shadow: var(--shadow-card, 0 1px 2px rgba(28, 26, 13, 0.15), 0 5px 10px rgba(28, 26, 13, 0.06));
      }

      .preview-bar {
        grid-template-columns: minmax(0, 1fr);
      }

      .control-grid {
        display: grid;
        gap: 1rem;
      }

      .button-row,
      .choice-row,
      .tab-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-inline-sm, 4px);
        align-items: center;
      }

      .button {
        display: inline-flex;
        align-items: center;
        gap: var(--space-inline-sm, 4px);
        min-block-size: 2.5rem;
        padding: 0 1rem;
        border-radius: var(--radius-md, 4px);
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        background: var(--color-surface-card, #faf9f5);
        color: var(--color-text-primary, #18181b);
        font: inherit;
      }

      .button.primary {
        background: var(--color-surface-selected, #ddeadf);
        border-color: var(--color-border-strong, rgba(28, 26, 13, 0.48));
      }

      .field {
        display: grid;
        gap: var(--space-stack-xs, 4px);
      }

      .text-field {
        inline-size: min(100%, 22rem);
        min-block-size: 2.75rem;
        padding: 0 0.95rem;
        border-radius: var(--radius-md, 4px);
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        background: var(--color-surface-page, #fffefa);
        color: var(--color-text-primary, #18181b);
        font: inherit;
      }

      .choice {
        display: inline-flex;
        align-items: center;
        gap: var(--space-inline-sm, 4px);
      }

      .choice input {
        accent-color: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
      }

      .switch {
        position: relative;
        inline-size: 3rem;
        block-size: 1.75rem;
        border-radius: 999px;
        background: var(--color-surface-selected, #ddeadf);
        border: 1px solid var(--color-border-strong, rgba(28, 26, 13, 0.48));
      }

      .switch::after {
        content: "";
        position: absolute;
        inset-block-start: 2px;
        inset-inline-start: calc(100% - 1.45rem);
        inline-size: 1.3rem;
        block-size: 1.3rem;
        border-radius: 50%;
        background: var(--color-surface-card, #faf9f5);
        box-shadow: var(--shadow-card, 0 1px 2px rgba(28, 26, 13, 0.15), 0 5px 10px rgba(28, 26, 13, 0.06));
      }

      .tab-row {
        padding-block-end: 0.3rem;
        border-block-end: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
      }

      .tab {
        padding: 0.6rem 0.85rem;
        border-radius: var(--radius-md, 4px);
        color: var(--color-text-secondary, #414651);
      }

      .tab.active {
        background: var(--color-surface-selected, #ddeadf);
        color: var(--color-text-primary, #18181b);
      }

      .slider {
        inline-size: min(100%, 20rem);
        accent-color: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
      }

      .card h3 {
        font-size: 1.05rem;
      }

      .menu {
        max-inline-size: 20rem;
        background: var(--color-surface-floating, #f0efe6);
        box-shadow: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
      }

      .menu-list {
        display: grid;
        gap: 0.2rem;
      }

      .menu-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-inline-md, 8px);
        padding: 0.7rem 0.8rem;
        border-radius: 12px;
      }

      .menu-item.active {
        background: var(--color-surface-selected, #ddeadf);
      }

      .grid-frame {
        display: grid;
        gap: 0.6rem;
      }

      .grid-meta {
        font-size: 0.92rem;
      }

      @container (min-width: 62rem) {
        .panel-grid {
          grid-template-columns: 1.2fr 0.8fr;
        }

        .control-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    </style>
    <div class="system">
      <section class="hero">
        <p class="eyebrow">Applied System</p>
        <h1>Use a small set of representative shapes to tune the whole visual language.</h1>
        <p class="meta">
          These are not all final components yet. This page exists so we can refine token hierarchy,
          spacing rhythm, focus treatment, surface depth, and interaction emphasis before the full set lands.
        </p>
      </section>

      <div class="panel-grid">
        <section class="preview-bar">
          <div class="control-grid">
            <article class="panel">
              <div class="button-row">
                <button class="button primary" type="button">Primary action</button>
                <button class="button" type="button">Secondary</button>
              </div>
              <div class="field">
                <label class="field-label" for="foundation-search">Text field</label>
                <input id="foundation-search" class="text-field" type="text" value="Filter visible rows" />
                <p class="helper">Neutral control shell, placeholder contrast, and focus treatment need to feel cohesive.</p>
              </div>
            </article>

            <article class="panel">
              <div class="choice-row">
                <label class="choice"><input type="checkbox" checked /> Checkbox</label>
                <label class="choice"><input type="radio" name="foundation-radio" checked /> Radio</label>
                <span class="choice"><span class="switch" aria-hidden="true"></span> Toggle</span>
              </div>
              <div class="tab-row" aria-label="Foundation tabs">
                <span class="tab active">Overview</span>
                <span class="tab">Density</span>
                <span class="tab">States</span>
              </div>
              <div class="field">
                <label class="field-label" for="foundation-slider">Slider</label>
                <input id="foundation-slider" class="slider" type="range" min="0" max="100" value="56" />
              </div>
            </article>
          </div>

          <article class="card">
            <p class="eyebrow">Card</p>
            <h2>Selected surfaces, text hierarchy, and shadow usage should agree with the controls.</h2>
            <p class="caption">
              This contained surface uses the same foundational tokens as the grid wrapper, so if the relationship
              feels off here, it will spread everywhere else.
            </p>
          </article>

          <article class="grid-frame">
            <p class="eyebrow">Composite Check</p>
            <p class="grid-meta">
              The data grid is already a composite of the reference set, so it should become our earliest
              dogfooding target once the smaller controls exist as real components.
            </p>
            <violet-data-grid id="foundations-grid"></violet-data-grid>
          </article>
        </section>

        <aside class="menu">
          <div>
            <p class="eyebrow">Floating Layer</p>
            <h2>Menu / popover shell</h2>
          </div>
          <div class="menu-list">
            <div class="menu-item active">
              <span>Selected view</span>
              <span class="menu-label">⌘1</span>
            </div>
            <div class="menu-item">
              <span>Compact density</span>
              <span class="menu-label">⌘2</span>
            </div>
            <div class="menu-item">
              <span>Token audit</span>
              <span class="menu-label">⌘3</span>
            </div>
          </div>
          <p class="caption">
            Floating surfaces should read differently from cards and pages, but still feel like they belong to the same system.
          </p>
        </aside>
      </div>
    </div>
  `;

  const grid = root.querySelector("#foundations-grid") as
    | (HTMLElement & {
        columns: VioletDataGridColumn<CultivationRow>[];
        rows: VioletDataGridRow<CultivationRow>[];
        selectionMode: "none" | "single" | "multiple";
        stickyHeader: boolean;
        filterState: { query: string };
        selectedRowIds: string[];
      })
    | null;

  if (grid) {
    grid.columns = gridColumns;
    grid.rows = gridRows;
    grid.selectionMode = "multiple";
    grid.stickyHeader = true;
    grid.filterState = { query: "" };
    grid.selectedRowIds = ["black-currant"];
  }

  return root;
}

function renderRadiusLab(): HTMLElement {
  const root = document.createElement("section");
  root.setAttribute("data-story", "violet-radius-lab");

  const initialValues = Object.fromEntries(
    radiusTokens.map((token) => [token.id, String(token.value)]),
  );

  root.innerHTML = `
    <style>
      :host, [data-story="violet-radius-lab"] {
        ${buildRegistryCssVars(violetTokenRegistry.tokens)}
        color: var(--color-text-primary, #18181b);
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: #f8f9fa;
        display: block;
        min-block-size: 100vh;
      }

      .lab {
        display: grid;
        padding: 0;
        container-type: inline-size;
      }

      h2, h3, p { margin: 0; }

      .layout {
        display: grid;
        gap: 0.5rem;
        min-inline-size: 0;
      }

      /* --- Tools sidebar --- */

      .editor {
        display: grid;
        gap: 0;
        align-content: start;
        border-block-end: 1px solid #d0d7e2;
        min-inline-size: 0;
        overflow-x: hidden;
      }

      .editor-header {
        display: flex;
        align-items: center;
        padding: 0.4rem 0.65rem;
        border-block-end: 1px solid #e1e4e8;
        background: #f1f3f5;
      }

      .tool-title {
        margin: 0;
        font: 600 0.75rem/1.3 "SFMono-Regular", "Consolas", monospace;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #57606a;
      }

      .token-form {
        display: grid;
        gap: 0;
        min-inline-size: 0;
      }

      .token-row {
        display: grid;
        gap: 0.22rem;
        padding: 0.24rem 0.65rem;
        border-block-end: 1px solid #eaecef;
        background: transparent;
        transition: background 80ms ease;
        min-inline-size: 0;
      }

      .token-row:last-child {
        border-block-end: none;
      }

      .token-row:hover {
        background: #f0f3f6;
      }

      .token-main {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 5rem;
        align-items: center;
        gap: 0.32rem;
        min-inline-size: 0;
      }

      .token-copy {
        display: grid;
        gap: 0.1rem;
        min-inline-size: 0;
      }

      .token-id {
        font: 400 0.78rem/1.3 "SFMono-Regular", "Consolas", monospace;
        color: #24292f;
      }

      .token-help {
        color: #656d76;
        font-size: 0.68rem;
        line-height: 1.3;
      }

      .tool-input-wrap {
        display: grid;
        justify-items: stretch;
        min-inline-size: 0;
      }

      .tool-input {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 1.5rem;
        padding: 0 0.35rem;
        border-radius: 3px;
        border: 1px solid #c8d0db;
        background: #ffffff;
        color: #24292f;
        font: 0.75rem/1.3 "SFMono-Regular", "Consolas", monospace;
        text-align: end;
        font-variant-numeric: tabular-nums;
      }

      .tool-input:focus-visible {
        outline: 2px solid #3b82f6;
        outline-offset: 1px;
      }

      .action-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        padding: 0.35rem 0.65rem;
        border-block-start: 1px solid #e1e4e8;
      }

      .tool-button {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        min-block-size: 1.6rem;
        padding: 0 0.5rem;
        border-radius: 3px;
        border: 1px solid #d0d7e2;
        background: #ffffff;
        color: #57606a;
        font: 0.75rem/1.2 "IBM Plex Sans", "Segoe UI", sans-serif;
        cursor: pointer;
      }

      .tool-button.primary {
        background: #0969da;
        border-color: #0969da;
        color: #ffffff;
      }

      .tool-button:focus-visible {
        outline: 2px solid #3b82f6;
        outline-offset: 1px;
      }

      .output {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 15rem;
        padding: 0.35rem 0.65rem;
        border-radius: 0;
        border: none;
        border-block-start: 1px solid #e1e4e8;
        background: #f6f8fa;
        color: #24292f;
        font: 0.72rem/1.4 "SFMono-Regular", "Consolas", monospace;
        resize: vertical;
      }

      .copy-status {
        padding: 0.25rem 0.65rem;
        margin: 0;
        font-size: 0.68rem;
        line-height: 1.3;
        color: #656d76;
        border-block-start: 1px solid #eaecef;
      }

      /* --- Preview canvas --- */

      .preview {
        display: grid;
        gap: 0.75rem;
        padding: 0;
        border: none;
        border-radius: 0;
        background: transparent;
        position: sticky;
        top: 0.9rem;
        align-content: start;
      }

      .section-title {
        display: grid;
        gap: 0.1rem;
      }

      .section-title h3 {
        font: 600 0.75rem/1.3 "SFMono-Regular", "Consolas", monospace;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #57606a;
      }

      .preview-grid {
        display: grid;
        gap: 0.75rem;
      }

      .preview-panel {
        display: grid;
        gap: 0.75rem;
        padding: 0.8rem;
        border: 1px solid #e2e6ed;
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-card, #faf9f5);
      }

      .preview-note {
        color: var(--color-text-secondary, #414651);
        font-size: 0.76rem;
        line-height: 1.4;
      }

      .button {
        display: inline-flex;
        align-items: center;
        gap: var(--space-inline-sm, 4px);
        min-block-size: 2.15rem;
        padding: 0 0.8rem;
        border-radius: var(--radius-md, 4px);
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        background: var(--color-surface-card, #faf9f5);
        color: var(--color-text-primary, #18181b);
        font: 0.86rem/1.2 "IBM Plex Sans", "Segoe UI", sans-serif;
      }

      .button.primary {
        background: var(--color-surface-selected, #ddeadf);
        border-color: var(--color-border-strong, rgba(28, 26, 13, 0.48));
      }

      .preview-field {
        inline-size: 8rem;
        min-block-size: 2rem;
        padding: 0 0.65rem;
        border-radius: var(--radius-sm, 2px);
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        background: var(--color-surface-card, #faf9f5);
        color: var(--color-text-primary, #18181b);
        font: inherit;
      }

      .chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-inline-sm, 4px);
      }

      .chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-block-size: 1.8rem;
        padding: 0 0.65rem;
        border-radius: var(--radius-sm, 2px);
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        background: var(--color-surface-page, #fffefa);
        font-size: 0.82rem;
      }

      .pill-chip {
        border-radius: var(--radius-round, 9999px);
        background: var(--color-surface-selected, #ddeadf);
      }

      .round-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: 1.9rem;
        block-size: 1.9rem;
        border-radius: var(--radius-round, 9999px);
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        background: var(--color-surface-selected, #ddeadf);
        color: var(--color-text-primary, #18181b);
        font: 600 0.74rem/1 "IBM Plex Sans", "Segoe UI", sans-serif;
      }

      .shape-set {
        display: grid;
        gap: 0.75rem;
      }

      .shape-row {
        display: grid;
        gap: 0.5rem;
      }

      .shape-row h3 {
        font: 600 0.75rem/1.3 "SFMono-Regular", "Consolas", monospace;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #57606a;
      }

      .shape-card,
      .shape-panel,
      .shape-menu {
        padding: 0.85rem;
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        background: var(--color-surface-card, #faf9f5);
      }

      .shape-card {
        border-radius: var(--radius-lg, 6px);
      }

      .shape-panel {
        border-radius: var(--radius-md, 4px);
      }

      .shape-menu {
        border-radius: var(--radius-lg, 6px);
        box-shadow: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
      }

      .surface-stack {
        display: grid;
        gap: 0.75rem;
      }

      @container (min-width: 56rem) {
        .layout {
          grid-template-columns: minmax(18rem, 22rem) minmax(0, 1fr);
          align-items: start;
        }

        .editor {
          border-block-end: none;
          overflow-y: auto;
        }

        .surface-stack {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    </style>
    <div class="lab">
      <div class="layout">
        <section class="editor">
          <div class="editor-header">
            <p class="tool-title">Radius tokens</p>
          </div>
          <div class="token-form"></div>
          <div class="action-row">
            <button class="tool-button primary" type="button" data-action="copy">Copy value set</button>
            <button class="tool-button" type="button" data-action="reset">Reset</button>
          </div>
          <textarea class="output" readonly data-output aria-label="Current token value set"></textarea>
          <p class="copy-status" data-copy-status>Copy the edited set to send back for registry updates.</p>
        </section>

        <section class="preview">
          <div class="section-title">
            <h3>Representative shapes</h3>
          </div>

          <div class="preview-grid">
            <section class="preview-panel">
              <div class="shape-row">
                <h3>Compact pieces</h3>
                <div class="chip-row">
                  <span class="chip">Tag</span>
                  <span class="chip pill-chip">Round</span>
                  <button class="round-button" type="button" aria-label="Round control">R</button>
                  <span class="chip">Density</span>
                  <span class="chip">State</span>
                </div>
              </div>

              <div class="shape-row">
                <h3>Default controls</h3>
                <div class="action-row">
                  <button class="button primary" type="button">Primary action</button>
                  <button class="button" type="button">Secondary</button>
                </div>
                <input class="preview-field" type="text" value="Radius lab field" aria-label="Radius lab field" />
              </div>
            </section>

            <section class="preview-panel">
              <div class="surface-stack">
                <div class="shape-row">
                  <h3>Contained panel</h3>
                  <div class="shape-panel">
                    <p class="preview-note">Default panel geometry for cards, panels, and grid wrappers.</p>
                  </div>
                </div>

                <div class="shape-row">
                  <h3>Soft container</h3>
                  <div class="shape-card">
                    <p class="preview-note">Larger, softer container that should feel distinct from the default panel.</p>
                  </div>
                </div>

                <div class="shape-row">
                  <h3>Floating layer</h3>
                  <div class="shape-menu">
                    <p class="preview-note">Floating menu shell with the larger radius applied.</p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  `;

  const form = root.querySelector(".token-form");
  const output = root.querySelector(
    "[data-output]",
  ) as HTMLTextAreaElement | null;
  const copyStatus = root.querySelector(
    "[data-copy-status]",
  ) as HTMLParagraphElement | null;
  const copyButton = root.querySelector(
    '[data-action="copy"]',
  ) as HTMLButtonElement | null;
  const resetButton = root.querySelector(
    '[data-action="reset"]',
  ) as HTMLButtonElement | null;

  if (!form || !output || !copyStatus || !copyButton || !resetButton) {
    return root;
  }

  const currentValues = new Map<string, string>(
    radiusTokens.map((token) => [
      token.id,
      initialValues[token.id] ?? String(token.value),
    ]),
  );

  const writeOutput = (): string => {
    const snapshot = Object.fromEntries(
      radiusTokens.map((token) => [
        token.id,
        currentValues.get(token.id) ?? String(token.value),
      ]),
    );
    const text = JSON.stringify(snapshot, null, 2);
    output.value = text;
    return text;
  };

  const applyValue = (tokenId: string, value: string): void => {
    currentValues.set(tokenId, value);
    root.style.setProperty(tokenIdToCssVar(tokenId), value);
    writeOutput();
  };

  for (const token of radiusTokens) {
    const row = document.createElement("label");
    row.className = "token-row";
    const inputId = `radius-lab-${token.id.replace(/\./g, "-")}`;
    row.innerHTML = `
      <div class="token-main">
        <div class="token-copy">
          <div class="token-id">${token.id}</div>
          <div class="token-help">${token.metadata.cssProperty}</div>
        </div>
        <div class="tool-input-wrap">
          <input
            id="${inputId}"
            class="tool-input"
            type="text"
            value="${String(token.value)}"
            data-token-id="${token.id}"
            title="${token.metadata.cssProperty}"
          />
        </div>
      </div>
    `;

    const input = row.querySelector("input");
    if (input) {
      input.addEventListener("input", (event) => {
        const nextValue = (event.target as HTMLInputElement).value;
        applyValue(token.id, nextValue);
      });
    }

    form.append(row);
  }

  writeOutput();

  copyButton.addEventListener("click", async () => {
    const text = writeOutput();
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent =
        "Copied the current radius value set to your clipboard.";
    } catch {
      copyStatus.textContent =
        "Clipboard copy failed, but the current value set is available in the output box below.";
      output.focus();
      output.select();
    }
  });

  resetButton.addEventListener("click", () => {
    for (const token of radiusTokens) {
      const value = initialValues[token.id] ?? String(token.value);
      currentValues.set(token.id, value);
      root.style.setProperty(tokenIdToCssVar(token.id), value);
      const input = root.querySelector(
        `[data-token-id="${token.id}"]`,
      ) as HTMLInputElement | null;
      if (input) {
        input.value = value;
      }
    }
    copyStatus.textContent =
      "Radius values reset to the current registry defaults.";
    writeOutput();
  });

  return root;
}

function renderSpacingLab(): HTMLElement {
  const root = document.createElement("section");
  root.setAttribute("data-story", "violet-spacing-lab");

  const initialValues = Object.fromEntries(
    spacingRampTokens.map((token) => [token.id, String(token.value)]),
  );

  const getReferencedRampId = (tokenId: string): string => {
    // The export holds resolved values, so a semantic spacing token maps to the ramp step with
    // the same light value.
    const token = spacingSemanticTokens.find((entry) => entry.id === tokenId);
    const rampToken = spacingRampTokens.find((entry) => String(entry.value) === String(token?.value));

    return rampToken?.id ?? tokenId;
  };

  const getResolvedSpacingValue = (tokenId: string, currentRampValues: Map<string, string>): string => {
    const rampId = getReferencedRampId(tokenId);
    return currentRampValues.get(rampId) ?? "";
  };

  root.innerHTML = `
    <style>
      :host, [data-story="violet-spacing-lab"] {
        ${buildRegistryCssVars(violetTokenRegistry.tokens)}
        color: var(--color-text-primary, #18181b);
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: #f8f9fa;
        display: block;
        min-block-size: 100vh;
      }

      h3, p { margin: 0; }

      .lab {
        display: grid;
        padding: 0;
        container-type: inline-size;
      }

      .layout {
        display: grid;
        gap: 0.5rem;
        min-inline-size: 0;
      }

      .editor {
        display: grid;
        gap: 0;
        align-content: start;
        border-block-end: 1px solid #d0d7e2;
        min-inline-size: 0;
        overflow-x: hidden;
      }

      .editor-header {
        display: flex;
        align-items: center;
        padding: 0.4rem 0.65rem;
        border-block-end: 1px solid #e1e4e8;
        background: #f1f3f5;
      }

      .tool-title,
      .section-title h3,
      .shape-row h3 {
        margin: 0;
        font: 600 0.75rem/1.3 "SFMono-Regular", "Consolas", monospace;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #57606a;
      }

      .token-form {
        display: grid;
        gap: 0;
        min-inline-size: 0;
      }

      .token-row {
        display: grid;
        gap: 0.22rem;
        padding: 0.24rem 0.65rem;
        border-block-end: 1px solid #eaecef;
        background: transparent;
        transition: background 80ms ease;
        min-inline-size: 0;
      }

      .token-row:last-child {
        border-block-end: none;
      }

      .token-row:hover {
        background: #f0f3f6;
      }

      .token-main {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 5rem;
        align-items: center;
        gap: 0.32rem;
        min-inline-size: 0;
      }

      .token-copy {
        display: grid;
        gap: 0.1rem;
        min-inline-size: 0;
      }

      .token-id {
        font: 400 0.78rem/1.3 "SFMono-Regular", "Consolas", monospace;
        color: #24292f;
      }

      .token-help {
        color: #656d76;
        font-size: 0.68rem;
        line-height: 1.3;
      }

      .tool-input-wrap {
        display: grid;
        justify-items: stretch;
        min-inline-size: 0;
      }

      .tool-input {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 1.5rem;
        padding: 0 0.35rem;
        border-radius: 3px;
        border: 1px solid #c8d0db;
        background: #ffffff;
        color: #24292f;
        font: 0.75rem/1.3 "SFMono-Regular", "Consolas", monospace;
        text-align: end;
        font-variant-numeric: tabular-nums;
      }

      .tool-input:focus-visible {
        outline: 2px solid #3b82f6;
        outline-offset: 1px;
      }

      .action-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        padding: 0.35rem 0.65rem;
        border-block-start: 1px solid #e1e4e8;
      }

      .tool-button {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        min-block-size: 1.6rem;
        padding: 0 0.5rem;
        border-radius: 3px;
        border: 1px solid #d0d7e2;
        background: #ffffff;
        color: #57606a;
        font: 0.75rem/1.2 "IBM Plex Sans", "Segoe UI", sans-serif;
        cursor: pointer;
      }

      .tool-button.primary {
        background: #0969da;
        border-color: #0969da;
        color: #ffffff;
      }

      .output {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 15rem;
        padding: 0.35rem 0.65rem;
        border-radius: 0;
        border: none;
        border-block-start: 1px solid #e1e4e8;
        background: #f6f8fa;
        color: #24292f;
        font: 0.72rem/1.4 "SFMono-Regular", "Consolas", monospace;
        resize: vertical;
      }

      .copy-status {
        padding: 0.25rem 0.65rem;
        margin: 0;
        font-size: 0.68rem;
        line-height: 1.3;
        color: #656d76;
        border-block-start: 1px solid #eaecef;
      }

      .preview {
        display: grid;
        gap: 0.75rem;
        padding: 0;
        border: none;
        border-radius: 0;
        background: transparent;
        position: sticky;
        top: 0.9rem;
        align-content: start;
      }

      .section-title {
        display: grid;
        gap: 0.1rem;
      }

      .preview-grid {
        display: grid;
        gap: 0.75rem;
      }

      .preview-panel {
        display: grid;
        gap: 0.75rem;
        padding: 0.8rem;
        border: 1px solid #e2e6ed;
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-page, #fffefa);
      }

      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-block-size: 2rem;
        padding: 0 0.75rem;
        border-radius: var(--radius-md, 4px);
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        background: var(--color-surface-card, #faf9f5);
        color: var(--color-text-primary, #18181b);
        font: 0.84rem/1.2 "IBM Plex Sans", "Segoe UI", sans-serif;
      }

      .button.primary {
        background: var(--color-surface-selected, #ddeadf);
      }

      .inline-row-sm,
      .inline-row-md {
        display: flex;
        flex-wrap: wrap;
      }

      .inline-row-sm {
        gap: var(--space-inline-sm, 4px);
      }

      .inline-row-md {
        gap: var(--space-inline-md, 8px);
      }

      .stack-xs,
      .stack-sm {
        display: grid;
      }

      .stack-xs {
        gap: var(--space-stack-xs, 4px);
      }

      .stack-sm {
        gap: var(--space-stack-sm, 8px);
      }

      .spacing-card {
        display: grid;
        padding: 0.85rem;
        border: 1px solid #e2e6ed;
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-card, #faf9f5);
      }

      .mini-label {
        font: 600 0.72rem/1.25 "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--color-text-secondary, #414651);
      }

      .mini-copy {
        font-size: 0.82rem;
        line-height: 1.4;
        color: var(--color-text-secondary, #414651);
      }

      .rule {
        block-size: 1px;
        background: #e2e6ed;
      }

      @container (min-width: 56rem) {
        .layout {
          grid-template-columns: minmax(18rem, 22rem) minmax(0, 1fr);
          align-items: start;
        }

        .editor {
          border-block-end: none;
          overflow-y: auto;
        }

        .stack-layout {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    </style>
    <div class="lab">
      <div class="layout">
        <section class="editor">
          <div class="editor-header">
            <p class="tool-title">Spacing tokens</p>
          </div>
          <div class="token-form"></div>
          <div class="action-row">
            <button class="tool-button primary" type="button" data-action="copy">Copy value set</button>
            <button class="tool-button" type="button" data-action="reset">Reset</button>
          </div>
          <textarea class="output" readonly data-output aria-label="Current token value set"></textarea>
          <p class="copy-status" data-copy-status>Copy the edited set to send back for registry updates.</p>
        </section>

        <section class="preview">
          <div class="section-title">
            <h3>Representative spacing</h3>
          </div>

          <div class="preview-grid">
            <section class="preview-panel">
              <div class="shape-row stack-xs">
                <h3>Inline rhythm</h3>
                <div class="inline-row-sm">
                  <span class="button">Tag</span>
                  <span class="button">Chip</span>
                  <span class="button">State</span>
                </div>
                <div class="inline-row-md">
                  <button class="button primary" type="button">Primary action</button>
                  <button class="button" type="button">Secondary</button>
                  <button class="button" type="button">Tertiary</button>
                </div>
              </div>
            </section>

            <section class="preview-panel stack-layout">
              <div class="shape-row stack-sm">
                <h3>Tight stacks</h3>
                <div class="spacing-card stack-xs">
                  <div class="mini-label">Field label</div>
                  <div class="mini-copy">Helper text that sits close to its related control.</div>
                  <div class="rule"></div>
                  <div class="mini-copy">Dense metadata line with tighter vertical rhythm.</div>
                </div>
              </div>

              <div class="shape-row stack-sm">
                <h3>Default stacks</h3>
                <div class="spacing-card stack-sm">
                  <div class="mini-label">Section title</div>
                  <div class="mini-copy">Comfortable spacing for grouped content that still belongs together.</div>
                  <button class="button primary" type="button">Follow-up action</button>
                </div>
              </div>

              <div class="shape-row stack-sm">
                <h3>Layout spacing</h3>
                <div class="spacing-card" style="display:grid; gap: var(--space-layout-sm, 12px);">
                  <div class="spacing-card" style="padding: 0.7rem;">Compact region</div>
                  <div class="spacing-card" style="padding: 0.7rem; gap: var(--space-layout-md, 24px); display:grid;">
                    <div class="mini-label">Major region</div>
                    <div class="mini-copy">Layout spacing should read larger than component stack spacing.</div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  `;

  const form = root.querySelector(".token-form");
  const output = root.querySelector("[data-output]") as HTMLTextAreaElement | null;
  const copyStatus = root.querySelector("[data-copy-status]") as HTMLParagraphElement | null;
  const copyButton = root.querySelector('[data-action="copy"]') as HTMLButtonElement | null;
  const resetButton = root.querySelector('[data-action="reset"]') as HTMLButtonElement | null;

  if (!form || !output || !copyStatus || !copyButton || !resetButton) {
    return root;
  }

  const currentRampValues = new Map<string, string>(
    spacingRampTokens.map((token) => [token.id, initialValues[token.id] ?? String(token.value)]),
  );

  const writeOutput = (): string => {
    const snapshot = Object.fromEntries(
      spacingRampTokens.map((token) => [token.id, currentRampValues.get(token.id) ?? String(token.value)]),
    );
    const text = JSON.stringify(snapshot, null, 2);
    output.value = text;
    return text;
  };

  const syncSemanticInputs = (): void => {
    for (const token of spacingSemanticTokens) {
      const input = root.querySelector(`[data-token-id="${token.id}"]`) as HTMLInputElement | null;
      if (input) {
        input.value = getResolvedSpacingValue(token.id, currentRampValues);
      }
    }
  };

  const applyValue = (tokenId: string, value: string): void => {
    const rampId = getReferencedRampId(tokenId);
    currentRampValues.set(rampId, value);
    root.style.setProperty(tokenIdToCssVar(rampId), value);
    syncSemanticInputs();
    writeOutput();
  };

  for (const token of spacingSemanticTokens) {
    const row = document.createElement("label");
    row.className = "token-row";
    const inputId = `spacing-lab-${token.id.replace(/\./g, "-")}`;
    row.innerHTML = `
      <div class="token-main">
        <div class="token-copy">
          <div class="token-id">${token.id}</div>
          <div class="token-help">${token.metadata.cssProperty}</div>
        </div>
        <div class="tool-input-wrap">
          <input
            id="${inputId}"
            class="tool-input"
            type="text"
            value="${getResolvedSpacingValue(token.id, currentRampValues)}"
            data-token-id="${token.id}"
            title="${token.metadata.cssProperty}"
          />
        </div>
      </div>
    `;

    const input = row.querySelector("input");
    if (input) {
      input.addEventListener("input", (event) => {
        const nextValue = (event.target as HTMLInputElement).value;
        applyValue(token.id, nextValue);
      });
    }

    form.append(row);
  }

  writeOutput();
  syncSemanticInputs();

  copyButton.addEventListener("click", async () => {
    const text = writeOutput();
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = "Copied the current spacing value set to your clipboard.";
    } catch {
      copyStatus.textContent =
        "Clipboard copy failed, but the current value set is available in the output box below.";
      output.focus();
      output.select();
    }
  });

  resetButton.addEventListener("click", () => {
    for (const token of spacingRampTokens) {
      const value = initialValues[token.id] ?? String(token.value);
      currentRampValues.set(token.id, value);
      root.style.setProperty(tokenIdToCssVar(token.id), value);
    }
    syncSemanticInputs();
    copyStatus.textContent = "Spacing values reset to the current registry defaults.";
    writeOutput();
  });

  return root;
}

function renderDensityLab(): HTMLElement {
  const root = document.createElement("section");
  root.setAttribute("data-story", "violet-density-lab");

  const initialValues = Object.fromEntries(
    targetRampTokens.map((token) => [token.id, String(token.value)]),
  );

  root.innerHTML = `
    <style>
      :host, [data-story="violet-density-lab"] {
        ${buildRegistryCssVars(violetTokenRegistry.tokens)}
        color: var(--color-text-primary, #18181b);
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: #f8f9fa;
        display: block;
        min-block-size: 100vh;
      }

      h3, p { margin: 0; }

      .lab {
        display: grid;
        padding: 0;
        container-type: inline-size;
      }

      .layout {
        display: grid;
        gap: 0.5rem;
        min-inline-size: 0;
      }

      .editor {
        display: grid;
        gap: 0;
        align-content: start;
        border-block-end: 1px solid #d0d7e2;
        min-inline-size: 0;
        overflow-x: hidden;
      }

      .editor-header {
        display: flex;
        align-items: center;
        padding: 0.4rem 0.65rem;
        border-block-end: 1px solid #e1e4e8;
        background: #f1f3f5;
      }

      .tool-title,
      .section-title h3,
      .shape-row h3,
      .density-label {
        margin: 0;
        font: 600 0.75rem/1.3 "SFMono-Regular", "Consolas", monospace;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #57606a;
      }

      .token-form {
        display: grid;
        gap: 0;
        min-inline-size: 0;
      }

      .token-row {
        display: grid;
        gap: 0.22rem;
        padding: 0.24rem 0.65rem;
        border-block-end: 1px solid #eaecef;
        background: transparent;
        transition: background 80ms ease;
        min-inline-size: 0;
      }

      .token-row:hover {
        background: #f0f3f6;
      }

      .token-main {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 5rem;
        align-items: center;
        gap: 0.32rem;
        min-inline-size: 0;
      }

      .token-copy {
        display: grid;
        gap: 0.1rem;
        min-inline-size: 0;
      }

      .token-id {
        font: 400 0.78rem/1.3 "SFMono-Regular", "Consolas", monospace;
        color: #24292f;
      }

      .token-help {
        color: #656d76;
        font-size: 0.68rem;
        line-height: 1.3;
      }

      .tool-input-wrap {
        display: grid;
        justify-items: stretch;
        min-inline-size: 0;
      }

      .tool-input {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 1.5rem;
        padding: 0 0.35rem;
        border-radius: 3px;
        border: 1px solid #c8d0db;
        background: #ffffff;
        color: #24292f;
        font: 0.75rem/1.3 "SFMono-Regular", "Consolas", monospace;
        text-align: end;
        font-variant-numeric: tabular-nums;
      }

      .tool-input:focus-visible {
        outline: 2px solid #3b82f6;
        outline-offset: 1px;
      }

      .action-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        padding: 0.35rem 0.65rem;
        border-block-start: 1px solid #e1e4e8;
      }

      .tool-button {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        min-block-size: 1.6rem;
        padding: 0 0.5rem;
        border-radius: 3px;
        border: 1px solid #d0d7e2;
        background: #ffffff;
        color: #57606a;
        font: 0.75rem/1.2 "IBM Plex Sans", "Segoe UI", sans-serif;
        cursor: pointer;
      }

      .tool-button.primary {
        background: #0969da;
        border-color: #0969da;
        color: #ffffff;
      }

      .output {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 12rem;
        padding: 0.35rem 0.65rem;
        border-radius: 0;
        border: none;
        border-block-start: 1px solid #e1e4e8;
        background: #f6f8fa;
        color: #24292f;
        font: 0.72rem/1.4 "SFMono-Regular", "Consolas", monospace;
        resize: vertical;
      }

      .copy-status {
        padding: 0.25rem 0.65rem;
        margin: 0;
        font-size: 0.68rem;
        line-height: 1.3;
        color: #656d76;
        border-block-start: 1px solid #eaecef;
      }

      .preview {
        display: grid;
        gap: 0.75rem;
        padding: 0;
        border: none;
        border-radius: 0;
        background: transparent;
        position: sticky;
        top: 0.9rem;
        align-content: start;
      }

      .section-title {
        display: grid;
        gap: 0.1rem;
      }

      .preview-grid {
        display: grid;
        gap: 0.75rem;
      }

      .preview-panel {
        display: grid;
        gap: 0.75rem;
        padding: 0.8rem;
        border: 1px solid #e2e6ed;
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-page, #fffefa);
      }

      .density-row {
        display: grid;
        gap: 0.6rem;
        padding: 0.8rem;
        border: 1px solid rgba(28, 26, 13, 0.08);
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-card, #faf9f5);
      }

      .density-row[data-density="compact"] {
        --violet-target-size: var(--size-target-compact);
        --violet-control-type-size: calc(var(--type-body-md-size, 14px) - 1px);
        --violet-control-label-size: calc(var(--type-label-sm-size, 12px) - 1px);
        --violet-control-body-size: calc(var(--type-body-md-size, 14px) - 1px);
        --violet-control-caption-size: calc(var(--type-caption-xs-size, 11px) - 1px);
      }

      .density-row[data-density="natural"] {
        --violet-target-size: var(--size-target-natural);
        --violet-control-type-size: var(--type-body-md-size, 14px);
        --violet-control-label-size: var(--type-label-sm-size, 12px);
        --violet-control-body-size: var(--type-body-md-size, 14px);
        --violet-control-caption-size: var(--type-caption-xs-size, 11px);
      }

      .density-row[data-density="comfortable"] {
        --violet-target-size: var(--size-target-comfortable);
        --violet-control-type-size: var(--type-body-md-size, 14px);
        --violet-control-label-size: var(--type-label-sm-size, 12px);
        --violet-control-body-size: var(--type-body-md-size, 14px);
        --violet-control-caption-size: var(--type-caption-xs-size, 11px);
      }

      .density-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.75rem;
      }

      .density-note {
        color: var(--color-text-secondary, #414651);
        font-size: 0.85rem;
        line-height: 1.4;
      }

      .control-row {
        display: grid;
        gap: 0.75rem;
        align-items: start;
      }

      .pointer-panel {
        display: grid;
        gap: 0.5rem;
        padding: 0.8rem;
        border: 1px dashed rgba(28, 26, 13, 0.16);
        border-radius: var(--radius-md, 4px);
        background: rgba(255, 255, 255, 0.55);
      }

      .pointer-chip-row {
        display: flex;
        gap: var(--space-inline-sm);
        flex-wrap: wrap;
      }

      .pointer-chip {
        display: inline-flex;
        align-items: center;
        min-block-size: 1.7rem;
        padding: 0 0.5rem;
        border-radius: var(--radius-round, 9999px);
        background: var(--color-surface-subtle, #f0efe6);
        color: var(--color-text-secondary, #414651);
        font: 500 0.75rem/1.2 Montserrat, sans-serif;
      }

      @container (min-width: 56rem) {
        .layout {
          grid-template-columns: minmax(18rem, 22rem) minmax(0, 1fr);
          align-items: start;
        }

        .editor {
          border-block-end: none;
          overflow-y: auto;
        }

        .control-row {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    </style>
    <div class="lab">
      <div class="layout">
        <section class="editor">
          <div class="editor-header">
            <p class="tool-title">Density target tokens</p>
          </div>
          <div class="token-form"></div>
          <div class="action-row">
            <button class="tool-button primary" type="button" data-action="copy">Copy value set</button>
            <button class="tool-button" type="button" data-action="reset">Reset</button>
          </div>
          <textarea class="output" readonly data-output aria-label="Current token value set"></textarea>
          <p class="copy-status" data-copy-status>Copy the edited set to send back for registry updates.</p>
        </section>

        <section class="preview">
          <div class="section-title">
            <h3>Representative density</h3>
          </div>

          <div class="preview-grid">
            <section class="preview-panel">
              <div class="pointer-panel">
                <h3>Auto and override model</h3>
                <p class="density-note">Fine pointers default to compact, any coarse pointer upgrades to comfortable, and <code>--violet-target-size</code> can override both with a user-selected target.</p>
                <div class="pointer-chip-row">
                  <span class="pointer-chip">compact: 24px</span>
                  <span class="pointer-chip">natural: 32px</span>
                  <span class="pointer-chip">comfortable: 44px</span>
                </div>
              </div>
            </section>

            <section class="preview-panel">
              <div class="control-row">
                <div class="density-row" data-density="compact">
                  <div class="density-head">
                    <h3>Compact</h3>
                    <p class="density-label">24px target</p>
                  </div>
                  <p class="density-note">Mouse and stylus optimized. Binary controls stay visually smaller inside the larger click row.</p>
                  <violet-button appearance="secondary">Compact action</violet-button>
                  <violet-text-field label="Plant name" placeholder="Search cultivated rows"></violet-text-field>
                  <violet-checkbox>Track seed lot</violet-checkbox>
                </div>

                <div class="density-row" data-density="natural">
                  <div class="density-head">
                    <h3>Natural</h3>
                    <p class="density-label">32px target</p>
                  </div>
                  <p class="density-note">Balanced default. The authored baseline for most application UI without becoming explicitly touch-sized.</p>
                  <violet-button appearance="secondary">Natural action</violet-button>
                  <violet-text-field label="Plant name" placeholder="Search cultivated rows"></violet-text-field>
                  <violet-checkbox>Track seed lot</violet-checkbox>
                </div>

                <div class="density-row" data-density="comfortable">
                  <div class="density-head">
                    <h3>Comfortable</h3>
                    <p class="density-label">44px target</p>
                  </div>
                  <p class="density-note">Touch-friendly target sizing. Visual controls grow more slowly than the full hit area.</p>
                  <violet-button appearance="primary">Comfortable action</violet-button>
                  <violet-text-field label="Plant name" placeholder="Search cultivated rows"></violet-text-field>
                  <violet-checkbox>Track seed lot</violet-checkbox>
                </div>

                <div class="density-row">
                  <div class="density-head">
                    <h3>Auto default</h3>
                    <p class="density-label">Pointer-driven</p>
                  </div>
                  <p class="density-note">This row leaves the target unset so the current browser pointer environment decides the default density.</p>
                  <violet-button appearance="quiet">Auto action</violet-button>
                  <violet-text-field label="Plant name" placeholder="Current pointer decides"></violet-text-field>
                  <violet-checkbox>Auto mode checkbox</violet-checkbox>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  `;

  const form = root.querySelector(".token-form");
  const output = root.querySelector("[data-output]") as HTMLTextAreaElement | null;
  const copyStatus = root.querySelector("[data-copy-status]") as HTMLParagraphElement | null;
  const copyButton = root.querySelector('[data-action="copy"]') as HTMLButtonElement | null;
  const resetButton = root.querySelector('[data-action="reset"]') as HTMLButtonElement | null;

  if (!form || !output || !copyStatus || !copyButton || !resetButton) {
    return root;
  }

  const currentValues = new Map<string, string>(
    targetRampTokens.map((token) => [token.id, initialValues[token.id] ?? String(token.value)]),
  );

  const writeOutput = (): string => {
    const snapshot = Object.fromEntries(
      targetRampTokens.map((token) => [token.id, currentValues.get(token.id) ?? String(token.value)]),
    );
    const text = JSON.stringify(snapshot, null, 2);
    output.value = text;
    return text;
  };

  const applyValue = (tokenId: string, value: string): void => {
    currentValues.set(tokenId, value);
    root.style.setProperty(tokenIdToCssVar(tokenId), value);
    writeOutput();
  };

  for (const token of targetRampTokens) {
    const row = document.createElement("label");
    row.className = "token-row";
    const inputId = `density-lab-${token.id.replace(/\./g, "-")}`;
    row.innerHTML = `
      <div class="token-main">
        <div class="token-copy">
          <div class="token-id">${token.id}</div>
          <div class="token-help">${token.metadata.cssProperty}</div>
        </div>
        <div class="tool-input-wrap">
          <input
            id="${inputId}"
            class="tool-input"
            type="text"
            value="${currentValues.get(token.id) ?? String(token.value)}"
            data-token-id="${token.id}"
            title="${token.metadata.cssProperty}"
          />
        </div>
      </div>
    `;

    const input = row.querySelector("input");
    if (input) {
      input.addEventListener("input", (event) => {
        const nextValue = (event.target as HTMLInputElement).value;
        applyValue(token.id, nextValue);
      });
    }

    form.append(row);
  }

  writeOutput();

  copyButton.addEventListener("click", async () => {
    const text = writeOutput();
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = "Copied the current density target set to your clipboard.";
    } catch {
      copyStatus.textContent =
        "Clipboard copy failed, but the current value set is available in the output box below.";
      output.focus();
      output.select();
    }
  });

  resetButton.addEventListener("click", () => {
    for (const token of targetRampTokens) {
      const value = initialValues[token.id] ?? String(token.value);
      currentValues.set(token.id, value);
      root.style.setProperty(tokenIdToCssVar(token.id), value);
      const input = root.querySelector(`[data-token-id="${token.id}"]`) as HTMLInputElement | null;
      if (input) {
        input.value = value;
      }
    }
    copyStatus.textContent = "Density targets reset to the current registry defaults.";
    writeOutput();
  });

  return root;
}

function renderTypographyLab(): HTMLElement {
  const root = document.createElement("section");
  root.setAttribute("data-story", "violet-typography-lab");

  const initialValues = Object.fromEntries(
    [...fontScaleTokens, ...lineScaleTokens, ...weightTokens].map((token) => [
      token.id,
      String(token.value),
    ]),
  );

  const fontFamilyDefaults = {
    body: '"Montserrat", "Segoe UI", sans-serif',
    title: '"Bitter", Georgia, serif',
    eyebrow: '"Montserrat", "Segoe UI", sans-serif',
    mono: '"Space Mono", monospace',
  };

  root.innerHTML = `
    <style>
      :host, [data-story="violet-typography-lab"] {
        ${buildRegistryCssVars(violetTokenRegistry.tokens)}
        --font-family-body: ${fontFamilyDefaults.body};
        --font-family-title: ${fontFamilyDefaults.title};
        --font-family-eyebrow: ${fontFamilyDefaults.eyebrow};
        --font-family-mono: ${fontFamilyDefaults.mono};
        color: var(--color-text-primary, #18181b);
        font-family: var(--font-family-body);
        background: #f8f9fa;
        display: block;
        min-block-size: 100vh;
      }

      h3, p, pre { margin: 0; }

      .lab {
        display: grid;
        padding: 0;
        container-type: inline-size;
      }

      .layout {
        display: grid;
        gap: 0.5rem;
        min-inline-size: 0;
      }

      .editor {
        display: grid;
        gap: 0;
        align-content: start;
        border-block-end: 1px solid #d0d7e2;
        min-inline-size: 0;
        overflow-x: hidden;
      }

      .editor-header {
        display: flex;
        align-items: center;
        padding: 0.4rem 0.65rem;
        border-block-end: 1px solid #e1e4e8;
        background: #f1f3f5;
      }

      .tool-title,
      .section-title h3,
      .group-title,
      .preview-block h3 {
        margin: 0;
        font: 600 0.75rem/1.3 "IBM Plex Mono", monospace;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #57606a;
      }

      .token-form {
        display: grid;
        gap: 0;
        min-inline-size: 0;
      }

      .token-group {
        display: grid;
        gap: 0;
      }

      .group-title {
        padding: 0.4rem 0.65rem;
        border-block-end: 1px solid #e1e4e8;
        background: #f6f8fa;
      }

      .token-row {
        display: grid;
        gap: 0.24rem;
        padding: 0.3rem 0.65rem;
        border-block-end: 1px solid #eaecef;
        background: transparent;
        min-inline-size: 0;
      }

      .token-row:hover {
        background: #f0f3f6;
      }

      .token-main {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 8rem;
        align-items: center;
        gap: 0.5rem;
        min-inline-size: 0;
      }

      .token-copy {
        display: grid;
        gap: 0.1rem;
        min-inline-size: 0;
      }

      .token-id {
        font: 400 0.78rem/1.3 "IBM Plex Mono", monospace;
        color: #24292f;
      }

      .token-help {
        color: #656d76;
        font-size: 0.68rem;
        line-height: 1.3;
      }

      .tool-input-wrap {
        display: grid;
        min-inline-size: 0;
      }

      .tool-input {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 1.75rem;
        padding: 0 0.45rem;
        border-radius: 3px;
        border: 1px solid #c8d0db;
        background: #ffffff;
        color: #24292f;
        font: 0.75rem/1.3 "IBM Plex Mono", monospace;
      }

      .tool-input {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      .tool-input:focus-visible {
        outline: 2px solid #3b82f6;
        outline-offset: 1px;
      }

      .action-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        padding: 0.35rem 0.65rem;
        border-block-start: 1px solid #e1e4e8;
      }

      .tool-button {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        min-block-size: 1.6rem;
        padding: 0 0.5rem;
        border-radius: 3px;
        border: 1px solid #d0d7e2;
        background: #ffffff;
        color: #57606a;
        font: 0.75rem/1.2 "IBM Plex Sans", "Segoe UI", sans-serif;
        cursor: pointer;
      }

      .tool-button.primary {
        background: #0969da;
        border-color: #0969da;
        color: #ffffff;
      }

      .output {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 15rem;
        padding: 0.35rem 0.65rem;
        border-radius: 0;
        border: none;
        border-block-start: 1px solid #e1e4e8;
        background: #f6f8fa;
        color: #24292f;
        font: 0.72rem/1.4 "IBM Plex Mono", monospace;
        resize: vertical;
      }

      .copy-status {
        padding: 0.25rem 0.65rem;
        margin: 0;
        font-size: 0.68rem;
        line-height: 1.3;
        color: #656d76;
        border-block-start: 1px solid #eaecef;
      }

      .preview {
        display: grid;
        gap: 0.75rem;
        padding: 0;
        background: transparent;
        position: sticky;
        top: 0.9rem;
        align-content: start;
      }

      .section-title {
        display: grid;
        gap: 0.1rem;
      }

      .preview-grid {
        display: grid;
        gap: 0.75rem;
      }

      .preview-panel {
        display: grid;
        gap: 0.75rem;
      }

      .preview-stage {
        display: grid;
        gap: var(--space-layout-sm, 12px);
        padding: 0.9rem;
        border: 1px solid #e2e6ed;
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-page, #fffefa);
      }

      .preview-block {
        display: grid;
        gap: var(--space-stack-xs, 4px);
        padding: 0.85rem;
        border: 1px solid #e6e9ef;
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-card, #faf9f5);
      }

      .type-sample {
        margin: 0;
        color: var(--color-text-primary, #18181b);
      }

      .type-caption {
        font-family: var(--font-family-eyebrow);
        font-size: var(--type-caption-xs-size);
        line-height: var(--type-caption-xs-line);
        font-weight: var(--type-caption-xs-weight);
        color: var(--color-text-secondary, #414651);
        text-transform: uppercase;
        letter-spacing: 0.14em;
      }

      .type-label {
        font-family: var(--font-family-body);
        font-size: var(--type-label-sm-size);
        line-height: var(--type-label-sm-line);
        font-weight: var(--type-label-sm-weight);
      }

      .type-body {
        font-family: var(--font-family-body);
        font-size: var(--type-body-md-size);
        line-height: var(--type-body-md-line);
        font-weight: var(--type-body-md-weight);
      }

      .type-title-sm,
      .type-title-md {
        font-family: var(--font-family-title);
        letter-spacing: -0.01em;
      }

      .type-title-sm {
        font-size: var(--type-title-sm-size);
        line-height: var(--type-title-sm-line);
        font-weight: var(--type-title-sm-weight);
      }

      .type-title-md {
        font-size: var(--type-title-md-size);
        line-height: var(--type-title-md-line);
        font-weight: var(--type-title-md-weight);
      }

      .type-mono {
        font-family: var(--font-family-mono);
        font-size: var(--type-label-sm-size);
        line-height: var(--type-label-sm-line);
        font-weight: var(--weight-medium, 500);
        color: var(--color-text-secondary, #414651);
      }

      .meta-row {
        display: flex;
        gap: var(--space-inline-sm, 4px);
        flex-wrap: wrap;
      }

      .meta-chip {
        display: inline-flex;
        align-items: center;
        padding: 0.2rem 0.45rem;
        border: 1px solid #d8dee8;
        border-radius: var(--radius-round, 9999px);
        background: var(--color-surface-subtle, #f0efe6);
        color: var(--color-text-secondary, #414651);
        font-family: var(--font-family-mono);
        font-size: var(--type-caption-xs-size);
        line-height: var(--type-caption-xs-line);
        font-weight: var(--type-caption-xs-weight);
      }

      .mono-panel {
        display: grid;
        gap: var(--space-stack-xs, 4px);
        padding: 0.75rem;
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-subtle, #f0efe6);
      }

      .mono-code {
        font-family: var(--font-family-mono);
        font-size: var(--type-caption-xs-size);
        line-height: var(--type-caption-xs-line);
        font-weight: var(--weight-medium, 500);
        white-space: pre-wrap;
        color: var(--color-text-primary, #18181b);
      }

      @container (min-width: 56rem) {
        .layout {
          grid-template-columns: minmax(18rem, 22rem) minmax(0, 1fr);
          align-items: start;
        }

        .editor {
          border-block-end: none;
          overflow-y: auto;
        }

        .preview-grid {
          grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
          align-items: start;
        }
      }
    </style>
    <div class="lab">
      <div class="layout">
        <section class="editor">
          <div class="editor-header">
            <p class="tool-title">Type system</p>
          </div>
          <div class="token-form"></div>
          <div class="action-row">
            <button class="tool-button primary" type="button" data-action="copy">Copy value set</button>
            <button class="tool-button" type="button" data-action="reset">Reset</button>
          </div>
          <textarea class="output" readonly data-output aria-label="Current token value set"></textarea>
          <p class="copy-status" data-copy-status>Copy the edited set to send back for registry updates.</p>
        </section>

        <section class="preview">
          <div class="section-title">
            <h3>Representative type</h3>
          </div>

          <div class="preview-grid">
            <section class="preview-panel">
              <div class="preview-stage">
                <div class="preview-block">
                  <p class="type-caption type-sample">Garden notes / seasonal planning / spring beds</p>
                  <p class="type-title-md type-sample">A cultivated type system that feels stable, warm, and quietly distinctive.</p>
                  <p class="type-body type-sample">Body copy should stay effortless to read across cards, forms, and data-heavy views while titles carry more personality and gravity.</p>
                </div>

                <div class="preview-block">
                  <p class="type-label type-sample">Field label</p>
                  <p class="type-body type-sample">This is the default body style sitting under a compact label, using the main reading sans-serif.</p>
                  <div class="meta-row">
                    <span class="meta-chip">DATE PLANTED</span>
                    <span class="meta-chip">SEED LOT 14B</span>
                  </div>
                </div>
              </div>
            </section>

            <section class="preview-panel">
              <div class="preview-stage">
                <div class="preview-block">
                  <p class="type-title-sm type-sample">Section title</p>
                  <p class="type-body type-sample">Smaller headings should still feel meaningfully stronger than body text and labels.</p>
                  <p class="type-mono type-sample">GDD 284 / BED A-4 / 03.19.2026</p>
                </div>

                <div class="preview-block">
                  <p class="type-label type-sample">Monospace example</p>
                  <div class="mono-panel">
                    <p class="mono-code">variety: midnight-roma
lot: 14B
status: seedling
dtm: 78</p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  `;

  const form = root.querySelector(".token-form");
  const output = root.querySelector("[data-output]") as HTMLTextAreaElement | null;
  const copyStatus = root.querySelector("[data-copy-status]") as HTMLParagraphElement | null;
  const copyButton = root.querySelector('[data-action="copy"]') as HTMLButtonElement | null;
  const resetButton = root.querySelector('[data-action="reset"]') as HTMLButtonElement | null;

  if (!form || !output || !copyStatus || !copyButton || !resetButton) {
    return root;
  }

  const currentValues = new Map<string, string>(
    [...fontScaleTokens, ...lineScaleTokens, ...weightTokens].map((token) => [
      token.id,
      initialValues[token.id] ?? String(token.value),
    ]),
  );

  const groups = [
    { title: "Font size", tokens: fontScaleTokens },
    { title: "Line height", tokens: lineScaleTokens },
    { title: "Weight", tokens: weightTokens },
  ];

  const writeOutput = (): string => {
    const snapshot = Object.fromEntries(
      [...fontScaleTokens, ...lineScaleTokens, ...weightTokens].map((token) => [
        token.id,
        currentValues.get(token.id) ?? String(token.value),
      ]),
    );
    const text = JSON.stringify(snapshot, null, 2);
    output.value = text;
    return text;
  };

  const applyValue = (tokenId: string, value: string): void => {
    currentValues.set(tokenId, value);
    root.style.setProperty(tokenIdToCssVar(tokenId), value);
    writeOutput();
  };

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "token-group";
    section.innerHTML = `<div class="group-title">${group.title}</div>`;

    for (const token of group.tokens) {
      const row = document.createElement("label");
      row.className = "token-row";
      const inputId = `typography-lab-${token.id.replace(/\./g, "-")}`;
      row.innerHTML = `
        <div class="token-main">
          <div class="token-copy">
            <div class="token-id">${token.id}</div>
            <div class="token-help">${token.metadata.cssProperty}</div>
          </div>
          <div class="tool-input-wrap">
            <input
              id="${inputId}"
              class="tool-input"
              type="text"
              value="${currentValues.get(token.id) ?? String(token.value)}"
              data-token-id="${token.id}"
              title="${token.metadata.cssProperty}"
            />
          </div>
        </div>
      `;

      const input = row.querySelector("input");
      if (input) {
        input.addEventListener("input", (event) => {
          const nextValue = (event.target as HTMLInputElement).value;
          applyValue(token.id, nextValue);
        });
      }

      section.append(row);
    }

    form.append(section);
  }

  writeOutput();

  copyButton.addEventListener("click", async () => {
    const text = writeOutput();
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent =
        "Copied the current typography configuration to your clipboard.";
    } catch {
      copyStatus.textContent =
        "Clipboard copy failed, but the current value set is available in the output box below.";
      output.focus();
      output.select();
    }
  });

  resetButton.addEventListener("click", () => {
    for (const token of [...fontScaleTokens, ...lineScaleTokens, ...weightTokens]) {
      const value = initialValues[token.id] ?? String(token.value);
      currentValues.set(token.id, value);
      root.style.setProperty(tokenIdToCssVar(token.id), value);
      const input = root.querySelector(`[data-token-id="${token.id}"]`) as HTMLInputElement | null;
      if (input) {
        input.value = value;
      }
    }

    copyStatus.textContent =
      "Typography settings reset to the current registry defaults.";
    writeOutput();
  });

  return root;
}

function renderSurfaceLab(): HTMLElement {
  const root = document.createElement("section");
  root.setAttribute("data-story", "violet-surface-lab");

  const initialValues = Object.fromEntries(
    surfaceTokens.map((token) => [token.id, String(token.value)]),
  );

  root.innerHTML = `
    <style>
      :host, [data-story="violet-surface-lab"] {
        ${buildRegistryCssVars(violetTokenRegistry.tokens)}
        color: var(--color-text-primary, #18181b);
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        background: #ffffff;
        display: block;
        min-block-size: 100vh;
      }

      h3, p { margin: 0; }

      .lab {
        display: grid;
        padding: 0;
        container-type: inline-size;
      }

      .layout {
        display: grid;
        gap: 0.5rem;
        min-inline-size: 0;
      }

      .editor {
        display: grid;
        gap: 0;
        align-content: start;
        border-block-end: 1px solid #d0d7e2;
        min-inline-size: 0;
        overflow-x: hidden;
      }

      .editor-header {
        display: flex;
        align-items: center;
        padding: 0.4rem 0.65rem;
        border-block-end: 1px solid #e1e4e8;
        background: #f1f3f5;
      }

      .tool-title,
      .section-title h3,
      .shape-row h3 {
        margin: 0;
        font: 600 0.75rem/1.3 "SFMono-Regular", "Consolas", monospace;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #57606a;
      }

      .token-form {
        display: grid;
        gap: 0;
        min-inline-size: 0;
      }

      .token-row {
        display: grid;
        gap: 0.24rem;
        padding: 0.3rem 0.65rem;
        border-block-end: 1px solid #eaecef;
        background: transparent;
        min-inline-size: 0;
      }

      .token-row:last-child {
        border-block-end: none;
      }

      .token-row:hover {
        background: #f0f3f6;
      }

      .token-main {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 6.25rem;
        align-items: center;
        gap: 0.5rem;
        min-inline-size: 0;
      }

      .token-copy {
        display: grid;
        gap: 0.1rem;
        min-inline-size: 0;
      }

      .token-id {
        font: 400 0.78rem/1.3 "SFMono-Regular", "Consolas", monospace;
        color: #24292f;
      }

      .token-help {
        color: #656d76;
        font-size: 0.68rem;
        line-height: 1.3;
      }

      .tool-input-wrap {
        display: grid;
        gap: 0.24rem;
        justify-items: stretch;
        min-inline-size: 0;
      }

      .surface-swatch {
        inline-size: 100%;
        block-size: 1rem;
        border-radius: 3px;
        border: 1px solid #c8d0db;
      }

      .tool-input {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 1.5rem;
        padding: 0 0.35rem;
        border-radius: 3px;
        border: 1px solid #c8d0db;
        background: #ffffff;
        color: #24292f;
        font: 0.75rem/1.3 "SFMono-Regular", "Consolas", monospace;
      }

      .tool-input:focus-visible {
        outline: 2px solid #3b82f6;
        outline-offset: 1px;
      }

      .action-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        padding: 0.35rem 0.65rem;
        border-block-start: 1px solid #e1e4e8;
      }

      .tool-button {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        min-block-size: 1.6rem;
        padding: 0 0.5rem;
        border-radius: 3px;
        border: 1px solid #d0d7e2;
        background: #ffffff;
        color: #57606a;
        font: 0.75rem/1.2 "IBM Plex Sans", "Segoe UI", sans-serif;
        cursor: pointer;
      }

      .tool-button.primary {
        background: #0969da;
        border-color: #0969da;
        color: #ffffff;
      }

      .output {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 15rem;
        padding: 0.35rem 0.65rem;
        border-radius: 0;
        border: none;
        border-block-start: 1px solid #e1e4e8;
        background: #f6f8fa;
        color: #24292f;
        font: 0.72rem/1.4 "SFMono-Regular", "Consolas", monospace;
        resize: vertical;
      }

      .copy-status {
        padding: 0.25rem 0.65rem;
        margin: 0;
        font-size: 0.68rem;
        line-height: 1.3;
        color: #656d76;
        border-block-start: 1px solid #eaecef;
      }

      .preview {
        display: grid;
        gap: 0.75rem;
        padding: 0;
        border: none;
        border-radius: 0;
        background: transparent;
        position: sticky;
        top: 0.9rem;
        align-content: start;
      }

      .section-title {
        display: grid;
        gap: 0.1rem;
      }

      .preview-grid {
        display: grid;
        gap: 0.75rem;
      }

      .preview-panel {
        display: grid;
        gap: 0.75rem;
        padding: 0;
        border: none;
        border-radius: 0;
        background: transparent;
      }

      .shape-row {
        display: grid;
        gap: 0.5rem;
      }

      .surface-stage {
        display: grid;
        gap: var(--space-stack-sm, 8px);
        padding: 0.9rem;
        border: 1px solid #e2e6ed;
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-page, #fffefa);
      }

      .surface-card {
        display: grid;
        gap: var(--space-stack-xs, 4px);
        padding: 0.9rem;
        border: 1px solid #e2e6ed;
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-card, #faf9f5);
      }

      .surface-subtle {
        display: grid;
        gap: var(--space-stack-xs, 4px);
        padding: 0.75rem;
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-subtle, #f0efe6);
      }

      .surface-selected {
        display: grid;
        gap: var(--space-stack-xs, 4px);
        padding: 0.75rem;
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-selected, #ddeadf);
      }

      .surface-floating {
        display: grid;
        gap: var(--space-stack-xs, 4px);
        padding: 0.85rem;
        border-radius: var(--radius-lg, 6px);
        border: 1px solid #e2e6ed;
        background: var(--color-surface-floating, #f0efe6);
        box-shadow: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
        max-inline-size: 18rem;
      }

      .mini-label {
        font: 600 0.72rem/1.25 "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--color-text-secondary, #414651);
      }

      .mini-copy {
        font-size: 0.82rem;
        line-height: 1.4;
        color: var(--color-text-secondary, #414651);
      }

      .surface-layout {
        display: grid;
        gap: var(--space-layout-sm, 12px);
      }

      @container (min-width: 56rem) {
        .layout {
          grid-template-columns: minmax(18rem, 22rem) minmax(0, 1fr);
          align-items: start;
        }

        .editor {
          border-block-end: none;
          overflow-y: auto;
        }

        .surface-layout {
          grid-template-columns: minmax(0, 1.35fr) minmax(0, 0.9fr);
        }
      }
    </style>
    <div class="lab">
      <div class="layout">
        <section class="editor">
          <div class="editor-header">
            <p class="tool-title">Surface tokens</p>
          </div>
          <div class="token-form"></div>
          <div class="action-row">
            <button class="tool-button primary" type="button" data-action="copy">Copy value set</button>
            <button class="tool-button" type="button" data-action="reset">Reset</button>
          </div>
          <textarea class="output" readonly data-output aria-label="Current token value set"></textarea>
          <p class="copy-status" data-copy-status>Copy the edited set to send back for registry updates.</p>
        </section>

        <section class="preview">
          <div class="section-title">
            <h3>Representative surfaces</h3>
          </div>

          <div class="preview-grid">
            <section class="preview-panel">
              <div class="shape-row">
                <h3>Nested hierarchy</h3>
                <div class="surface-stage">
                  <div class="surface-card">
                    <div class="mini-label">Card surface</div>
                    <div class="mini-copy">Contained UI should step above the page but still feel neutral.</div>
                    <div class="surface-subtle">
                      <div class="mini-label">Subtle surface</div>
                      <div class="mini-copy">Recessed structure for quieter support content.</div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section class="preview-panel">
              <div class="shape-row">
                <h3>State and floating layers</h3>
                <div class="surface-stage">
                  <div class="surface-layout">
                    <div class="surface-selected">
                      <div class="mini-label">Selected surface</div>
                      <div class="mini-copy">Persistent selection should stay distinct from resting and subtle surfaces.</div>
                    </div>
                    <div class="surface-floating">
                      <div class="mini-label">Floating surface</div>
                      <div class="mini-copy">Menus and overlays should lift above the page without fighting the page context beneath them.</div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  `;

  const form = root.querySelector(".token-form");
  const output = root.querySelector("[data-output]") as HTMLTextAreaElement | null;
  const copyStatus = root.querySelector("[data-copy-status]") as HTMLParagraphElement | null;
  const copyButton = root.querySelector('[data-action="copy"]') as HTMLButtonElement | null;
  const resetButton = root.querySelector('[data-action="reset"]') as HTMLButtonElement | null;

  if (!form || !output || !copyStatus || !copyButton || !resetButton) {
    return root;
  }

  const currentValues = new Map<string, string>(
    surfaceTokens.map((token) => [token.id, initialValues[token.id] ?? String(token.value)]),
  );

  const writeOutput = (): string => {
    const snapshot = Object.fromEntries(
      surfaceTokens.map((token) => [token.id, currentValues.get(token.id) ?? String(token.value)]),
    );
    const text = JSON.stringify(snapshot, null, 2);
    output.value = text;
    return text;
  };

  const applyValue = (tokenId: string, value: string): void => {
    currentValues.set(tokenId, value);
    root.style.setProperty(tokenIdToCssVar(tokenId), value);
    const swatch = root.querySelector(`[data-swatch-id="${tokenId}"]`) as HTMLElement | null;
    if (swatch) {
      swatch.style.background = value;
    }
    writeOutput();
  };

  for (const token of surfaceTokens) {
    const row = document.createElement("label");
    row.className = "token-row";
    const inputId = `surface-lab-${token.id.replace(/\./g, "-")}`;
    row.innerHTML = `
      <div class="token-main">
        <div class="token-copy">
          <div class="token-id">${token.id}</div>
          <div class="token-help">${token.metadata.cssProperty}</div>
        </div>
        <div class="tool-input-wrap">
          <div class="surface-swatch" data-swatch-id="${token.id}" style="background:${String(token.value)}"></div>
          <input
            id="${inputId}"
            class="tool-input"
            type="text"
            value="${String(token.value)}"
            data-token-id="${token.id}"
            title="${token.metadata.cssProperty}"
          />
        </div>
      </div>
    `;

    const input = row.querySelector("input");
    if (input) {
      input.addEventListener("input", (event) => {
        const nextValue = (event.target as HTMLInputElement).value;
        applyValue(token.id, nextValue);
      });
    }

    form.append(row);
  }

  writeOutput();

  copyButton.addEventListener("click", async () => {
    const text = writeOutput();
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = "Copied the current surface value set to your clipboard.";
    } catch {
      copyStatus.textContent =
        "Clipboard copy failed, but the current value set is available in the output box below.";
      output.focus();
      output.select();
    }
  });

  resetButton.addEventListener("click", () => {
    for (const token of surfaceTokens) {
      const value = initialValues[token.id] ?? String(token.value);
      currentValues.set(token.id, value);
      root.style.setProperty(tokenIdToCssVar(token.id), value);
      const input = root.querySelector(`[data-token-id="${token.id}"]`) as HTMLInputElement | null;
      if (input) {
        input.value = value;
      }
      const swatch = root.querySelector(`[data-swatch-id="${token.id}"]`) as HTMLElement | null;
      if (swatch) {
        swatch.style.background = value;
      }
    }
    copyStatus.textContent = "Surface values reset to the current registry defaults.";
    writeOutput();
  });

  return root;
}

function renderTextAndStructureLab(): HTMLElement {
  const root = document.createElement("section");
  root.setAttribute("data-story", "violet-text-structure-lab");

  const initialValues = Object.fromEntries(
    textStructureTokens.map((token) => [token.id, String(token.value)]),
  );

  root.innerHTML = `
    <style>
      :host, [data-story="violet-text-structure-lab"] {
        ${buildRegistryCssVars(violetTokenRegistry.tokens)}
        --font-family-body: "Montserrat", "Segoe UI", sans-serif;
        --font-family-title: "Bitter", Georgia, serif;
        --font-family-eyebrow: "Montserrat", "Segoe UI", sans-serif;
        --font-family-mono: "Space Mono", monospace;
        color: var(--color-text-primary, #18181b);
        font-family: var(--font-family-body);
        background: #f8f9fa;
        display: block;
        min-block-size: 100vh;
      }

      h3, p { margin: 0; }

      .lab {
        display: grid;
        padding: 0;
        container-type: inline-size;
      }

      .layout {
        display: grid;
        gap: 0.5rem;
        min-inline-size: 0;
      }

      .editor {
        display: grid;
        gap: 0;
        align-content: start;
        border-block-end: 1px solid #d0d7e2;
        min-inline-size: 0;
        overflow-x: hidden;
      }

      .editor-header {
        display: flex;
        align-items: center;
        padding: 0.4rem 0.65rem;
        border-block-end: 1px solid #e1e4e8;
        background: #f1f3f5;
      }

      .tool-title,
      .section-title h3,
      .group-title,
      .mini-label {
        margin: 0;
        font: 600 0.75rem/1.3 "IBM Plex Mono", monospace;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #57606a;
      }

      .token-form {
        display: grid;
        gap: 0;
        min-inline-size: 0;
      }

      .token-group {
        display: grid;
        gap: 0;
      }

      .group-title {
        padding: 0.4rem 0.65rem;
        border-block-end: 1px solid #e1e4e8;
        background: #f6f8fa;
      }

      .token-row {
        display: grid;
        gap: 0.24rem;
        padding: 0.3rem 0.65rem;
        border-block-end: 1px solid #eaecef;
        background: transparent;
        min-inline-size: 0;
      }

      .token-row:hover {
        background: #f0f3f6;
      }

      .token-main {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 4.2rem 6.25rem;
        align-items: center;
        gap: 0.5rem;
        min-inline-size: 0;
      }

      .token-copy {
        display: grid;
        gap: 0.1rem;
        min-inline-size: 0;
      }

      .token-id {
        font: 400 0.78rem/1.3 "IBM Plex Mono", monospace;
        color: #24292f;
      }

      .token-help {
        color: #656d76;
        font-size: 0.68rem;
        line-height: 1.3;
      }

      .tool-input-wrap {
        display: grid;
        min-inline-size: 0;
      }

      .tool-input {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 1.75rem;
        padding: 0 0.45rem;
        border-radius: 3px;
        border: 1px solid #c8d0db;
        background: #ffffff;
        color: #24292f;
        font: 0.75rem/1.3 "IBM Plex Mono", monospace;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      .tool-input:focus-visible {
        outline: 2px solid #3b82f6;
        outline-offset: 1px;
      }

      .token-swatch {
        inline-size: 100%;
        block-size: 1.4rem;
        border-radius: 3px;
        border: 1px solid #c8d0db;
      }

      .action-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        padding: 0.35rem 0.65rem;
        border-block-start: 1px solid #e1e4e8;
      }

      .tool-button {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        min-block-size: 1.6rem;
        padding: 0 0.5rem;
        border-radius: 3px;
        border: 1px solid #d0d7e2;
        background: #ffffff;
        color: #57606a;
        font: 0.75rem/1.2 "IBM Plex Sans", "Segoe UI", sans-serif;
        cursor: pointer;
      }

      .tool-button.primary {
        background: #0969da;
        border-color: #0969da;
        color: #ffffff;
      }

      .output {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 15rem;
        padding: 0.35rem 0.65rem;
        border-radius: 0;
        border: none;
        border-block-start: 1px solid #e1e4e8;
        background: #f6f8fa;
        color: #24292f;
        font: 0.72rem/1.4 "IBM Plex Mono", monospace;
        resize: vertical;
      }

      .copy-status {
        padding: 0.25rem 0.65rem;
        margin: 0;
        font-size: 0.68rem;
        line-height: 1.3;
        color: #656d76;
        border-block-start: 1px solid #eaecef;
      }

      .preview {
        display: grid;
        gap: 0.75rem;
        padding: 0;
        background: transparent;
        position: sticky;
        top: 0.9rem;
        align-content: start;
      }

      .section-title {
        display: grid;
        gap: 0.1rem;
      }

      .preview-grid {
        display: grid;
        gap: 0.75rem;
      }

      .preview-panel {
        display: grid;
        gap: 0.75rem;
      }

      .preview-stage {
        display: grid;
        gap: var(--space-layout-sm, 12px);
        padding: 0.9rem;
        border: 1px solid #e2e6ed;
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-page, #fffefa);
      }

      .preview-block {
        display: grid;
        gap: var(--space-stack-xs, 4px);
        padding: 0.85rem;
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-card, #faf9f5);
      }

      .text-card {
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
      }

      .text-heading {
        font-family: var(--font-family-title);
        font-size: var(--type-title-sm-size, 18px);
        line-height: var(--type-title-sm-line, 24px);
        font-weight: var(--type-title-sm-weight, 600);
        color: var(--color-text-primary, #18181b);
      }

      .text-body {
        font-family: var(--font-family-body);
        font-size: var(--type-body-md-size, 14px);
        line-height: var(--type-body-md-line, 20px);
        font-weight: var(--type-body-md-weight, 400);
        color: var(--color-text-primary, #18181b);
      }

      .text-secondary {
        font-family: var(--font-family-body);
        font-size: var(--type-body-md-size, 14px);
        line-height: var(--type-body-md-line, 20px);
        color: var(--color-text-secondary, #414651);
      }

      .text-muted {
        font-family: var(--font-family-body);
        font-size: var(--type-caption-xs-size, 11px);
        line-height: var(--type-caption-xs-line, 14px);
        color: var(--color-text-muted, #616775);
      }

      .eyebrow {
        font-family: var(--font-family-eyebrow);
        font-size: var(--type-caption-xs-size, 11px);
        line-height: var(--type-caption-xs-line, 14px);
        font-weight: var(--type-caption-xs-weight, 500);
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--color-text-secondary, #414651);
      }

      .structure-stack {
        display: grid;
        gap: var(--space-stack-sm, 8px);
      }

      .rule-subtle,
      .rule-strong {
        block-size: 1px;
        inline-size: 100%;
      }

      .rule-subtle {
        background: var(--color-border-subtle, rgba(28, 26, 13, 0.10));
      }

      .rule-strong {
        background: var(--color-border-strong, rgba(28, 26, 13, 0.48));
      }

      .selected-row {
        display: grid;
        gap: var(--space-stack-xs, 4px);
        padding: 0.75rem;
        border: 1px solid var(--color-border-strong, rgba(28, 26, 13, 0.48));
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-selected, #ddeadf);
      }

      .focused-field {
        display: grid;
        gap: var(--space-stack-xs, 4px);
        padding: 0.7rem 0.75rem;
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-card, #faf9f5);
        box-shadow: 0 0 0 2px var(--color-focus-ring, rgba(24, 24, 27, 0.5));
      }

      .pill {
        display: inline-flex;
        align-items: center;
        align-self: start;
        padding: 0.2rem 0.45rem;
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        border-radius: var(--radius-round, 9999px);
        background: var(--color-surface-subtle, #f0efe6);
        color: var(--color-text-secondary, #414651);
        font-family: var(--font-family-mono);
        font-size: var(--type-caption-xs-size, 11px);
        line-height: var(--type-caption-xs-line, 14px);
        font-weight: 500;
      }

      @container (min-width: 56rem) {
        .layout {
          grid-template-columns: minmax(18rem, 22rem) minmax(0, 1fr);
          align-items: start;
        }

        .editor {
          border-block-end: none;
          overflow-y: auto;
        }

        .preview-grid {
          grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
          align-items: start;
        }
      }
    </style>
    <div class="lab">
      <div class="layout">
        <section class="editor">
          <div class="editor-header">
            <p class="tool-title">Text and structure</p>
          </div>
          <div class="token-form"></div>
          <div class="action-row">
            <button class="tool-button primary" type="button" data-action="copy">Copy value set</button>
            <button class="tool-button" type="button" data-action="reset">Reset</button>
          </div>
          <textarea class="output" readonly data-output aria-label="Current token value set"></textarea>
          <p class="copy-status" data-copy-status>Copy the edited set to send back for registry updates.</p>
        </section>

        <section class="preview">
          <div class="section-title">
            <h3>Representative text and structure</h3>
          </div>

          <div class="preview-grid">
            <section class="preview-panel">
              <div class="preview-stage">
                <div class="preview-block text-card">
                  <p class="eyebrow">Garden planning / spring beds</p>
                  <p class="text-heading">Text hierarchy should stay calm, readable, and clearly layered.</p>
                  <p class="text-body">Primary text should do the main reading work without feeling too dark or too heavy against the surface system.</p>
                  <p class="text-secondary">Secondary text should support the main message while staying visibly subordinate.</p>
                  <p class="text-muted">Muted text should remain legible for helpers, metadata, and low-emphasis information.</p>
                </div>

                <div class="preview-block structure-stack">
                  <div class="pill">DATE PLANTED</div>
                  <div class="rule-subtle"></div>
                  <p class="text-secondary">Subtle borders should separate without pulling focus away from the content.</p>
                  <div class="rule-strong"></div>
                  <p class="text-body">Strong borders should read as deliberate structure, not the default divider everywhere.</p>
                </div>
              </div>
            </section>

            <section class="preview-panel">
              <div class="preview-stage">
                <div class="selected-row">
                  <p class="mini-label">Selected state</p>
                  <p class="text-body">Midnight Roma tomato</p>
                  <p class="text-secondary">Selection should work with stronger structure without looking like focus.</p>
                </div>

                <div class="focused-field">
                  <p class="mini-label">Focused field</p>
                  <p class="text-body">Focus needs a distinct ring that does not get confused with borders or selection.</p>
                  <p class="text-muted">Keyboard focus should be obvious even in dense UI.</p>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  `;

  const form = root.querySelector(".token-form");
  const output = root.querySelector("[data-output]") as HTMLTextAreaElement | null;
  const copyStatus = root.querySelector("[data-copy-status]") as HTMLParagraphElement | null;
  const copyButton = root.querySelector('[data-action="copy"]') as HTMLButtonElement | null;
  const resetButton = root.querySelector('[data-action="reset"]') as HTMLButtonElement | null;

  if (!form || !output || !copyStatus || !copyButton || !resetButton) {
    return root;
  }

  const currentValues = new Map<string, string>(
    textStructureTokens.map((token) => [token.id, initialValues[token.id] ?? String(token.value)]),
  );

  const groups = [
    {
      title: "Text",
      tokens: textStructureTokens.filter((token) => token.id.startsWith("color.text.")),
    },
    {
      title: "Structure",
      tokens: textStructureTokens.filter(
        (token) => token.id.startsWith("color.border.") || token.id.startsWith("color.focus."),
      ),
    },
  ];

  const writeOutput = (): string => {
    const snapshot = Object.fromEntries(
      textStructureTokens.map((token) => [token.id, currentValues.get(token.id) ?? String(token.value)]),
    );
    const text = JSON.stringify(snapshot, null, 2);
    output.value = text;
    return text;
  };

  const applyValue = (tokenId: string, value: string): void => {
    currentValues.set(tokenId, value);
    root.style.setProperty(tokenIdToCssVar(tokenId), value);
    const swatch = root.querySelector(`[data-swatch-id="${tokenId}"]`) as HTMLElement | null;
    if (swatch) {
      swatch.style.background = value;
    }
    writeOutput();
  };

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "token-group";
    section.innerHTML = `<div class="group-title">${group.title}</div>`;

    for (const token of group.tokens) {
      const row = document.createElement("label");
      row.className = "token-row";
      const inputId = `text-structure-lab-${token.id.replace(/\./g, "-")}`;
      row.innerHTML = `
        <div class="token-main">
          <div class="token-copy">
            <div class="token-id">${token.id}</div>
            <div class="token-help">${token.metadata.cssProperty}</div>
          </div>
          <div class="token-swatch" data-swatch-id="${token.id}" style="background:${tokenValueToCssValue(token.value)};"></div>
          <div class="tool-input-wrap">
            <input
              id="${inputId}"
              class="tool-input"
              type="text"
              value="${currentValues.get(token.id) ?? String(token.value)}"
              data-token-id="${token.id}"
              title="${token.metadata.cssProperty}"
            />
          </div>
        </div>
      `;

      const input = row.querySelector("input");
      if (input) {
        input.addEventListener("input", (event) => {
          const nextValue = (event.target as HTMLInputElement).value;
          applyValue(token.id, nextValue);
        });
      }

      section.append(row);
    }

    form.append(section);
  }

  writeOutput();

  copyButton.addEventListener("click", async () => {
    const text = writeOutput();
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent =
        "Copied the current text and structure value set to your clipboard.";
    } catch {
      copyStatus.textContent =
        "Clipboard copy failed, but the current value set is available in the output box below.";
      output.focus();
      output.select();
    }
  });

  resetButton.addEventListener("click", () => {
    for (const token of textStructureTokens) {
      const value = initialValues[token.id] ?? String(token.value);
      currentValues.set(token.id, value);
      root.style.setProperty(tokenIdToCssVar(token.id), value);
      const input = root.querySelector(`[data-token-id="${token.id}"]`) as HTMLInputElement | null;
      if (input) {
        input.value = value;
      }
      const swatch = root.querySelector(`[data-swatch-id="${token.id}"]`) as HTMLElement | null;
      if (swatch) {
        swatch.style.background = value;
      }
    }
    copyStatus.textContent = "Text and structure values reset to the current registry defaults.";
    writeOutput();
  });

  return root;
}

function renderElevationLab(): HTMLElement {
  const root = document.createElement("section");
  root.setAttribute("data-story", "violet-elevation-lab");

  const initialValues = Object.fromEntries(
    shadowTokens.map((token) => [token.id, String(token.value)]),
  );

  root.innerHTML = `
    <style>
      :host, [data-story="violet-elevation-lab"] {
        ${buildRegistryCssVars(violetTokenRegistry.tokens)}
        --font-family-body: "Montserrat", "Segoe UI", sans-serif;
        --font-family-title: "Bitter", Georgia, serif;
        color: var(--color-text-primary, #18181b);
        font-family: var(--font-family-body);
        background: #f8f9fa;
        display: block;
        min-block-size: 100vh;
      }

      h3, p { margin: 0; }

      .lab {
        display: grid;
        padding: 0;
        container-type: inline-size;
      }

      .layout {
        display: grid;
        gap: 0.5rem;
        min-inline-size: 0;
      }

      .editor {
        display: grid;
        gap: 0;
        align-content: start;
        border-block-end: 1px solid #d0d7e2;
        min-inline-size: 0;
        overflow-x: hidden;
      }

      .editor-header {
        display: flex;
        align-items: center;
        padding: 0.4rem 0.65rem;
        border-block-end: 1px solid #e1e4e8;
        background: #f1f3f5;
      }

      .tool-title,
      .section-title h3,
      .group-title,
      .mini-label {
        margin: 0;
        font: 600 0.75rem/1.3 "IBM Plex Mono", monospace;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #57606a;
      }

      .token-form {
        display: grid;
        gap: 0;
        min-inline-size: 0;
      }

      .token-group {
        display: grid;
        gap: 0;
      }

      .group-title {
        padding: 0.4rem 0.65rem;
        border-block-end: 1px solid #e1e4e8;
        background: #f6f8fa;
      }

      .token-row {
        display: grid;
        gap: 0.24rem;
        padding: 0.3rem 0.65rem;
        border-block-end: 1px solid #eaecef;
        background: transparent;
        min-inline-size: 0;
      }

      .token-row:hover {
        background: #f0f3f6;
      }

      .token-main {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 13rem;
        align-items: center;
        gap: 0.5rem;
        min-inline-size: 0;
      }

      .token-copy {
        display: grid;
        gap: 0.1rem;
        min-inline-size: 0;
      }

      .token-id {
        font: 400 0.78rem/1.3 "IBM Plex Mono", monospace;
        color: #24292f;
      }

      .token-help {
        color: #656d76;
        font-size: 0.68rem;
        line-height: 1.3;
      }

      .tool-input-wrap {
        display: grid;
        min-inline-size: 0;
      }

      .tool-input {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 1.75rem;
        padding: 0 0.45rem;
        border-radius: 3px;
        border: 1px solid #c8d0db;
        background: #ffffff;
        color: #24292f;
        font: 0.72rem/1.3 "IBM Plex Mono", monospace;
      }

      .tool-input:focus-visible {
        outline: 2px solid #3b82f6;
        outline-offset: 1px;
      }

      .action-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        padding: 0.35rem 0.65rem;
        border-block-start: 1px solid #e1e4e8;
      }

      .tool-button {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        min-block-size: 1.6rem;
        padding: 0 0.5rem;
        border-radius: 3px;
        border: 1px solid #d0d7e2;
        background: #ffffff;
        color: #57606a;
        font: 0.75rem/1.2 "IBM Plex Sans", "Segoe UI", sans-serif;
        cursor: pointer;
      }

      .tool-button.primary {
        background: #0969da;
        border-color: #0969da;
        color: #ffffff;
      }

      .output {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 15rem;
        padding: 0.35rem 0.65rem;
        border-radius: 0;
        border: none;
        border-block-start: 1px solid #e1e4e8;
        background: #f6f8fa;
        color: #24292f;
        font: 0.72rem/1.4 "IBM Plex Mono", monospace;
        resize: vertical;
      }

      .copy-status {
        padding: 0.25rem 0.65rem;
        margin: 0;
        font-size: 0.68rem;
        line-height: 1.3;
        color: #656d76;
        border-block-start: 1px solid #eaecef;
      }

      .preview {
        display: grid;
        gap: 0.75rem;
        padding: 0;
        background: transparent;
        position: sticky;
        top: 0.9rem;
        align-content: start;
      }

      .section-title {
        display: grid;
        gap: 0.1rem;
      }

      .preview-grid {
        display: grid;
        gap: 0.75rem;
      }

      .preview-panel {
        display: grid;
        gap: 0.75rem;
      }

      .preview-stage {
        display: grid;
        gap: var(--space-layout-sm, 12px);
        padding: 1rem;
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-page, #fffefa);
        background: linear-gradient(180deg, rgba(255, 254, 250, 1) 0%, rgba(240, 239, 230, 0.85) 100%);
      }

      .elevation-card,
      .elevation-floating,
      .elevation-control {
        display: grid;
        gap: var(--space-stack-xs, 4px);
        padding: 0.95rem;
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-card, #faf9f5);
      }

      .elevation-card {
        box-shadow: var(--shadow-card);
      }

      .elevation-control {
        box-shadow: var(--shadow-control);
      }

      .elevation-floating {
        max-inline-size: 20rem;
        justify-self: start;
        box-shadow: var(--shadow-floating);
        background: var(--color-surface-floating, #f0efe6);
      }

      .elevation-stack {
        display: grid;
        gap: var(--space-layout-sm, 12px);
      }

      .text-heading {
        font-family: var(--font-family-title);
        font-size: var(--type-title-sm-size, 18px);
        line-height: var(--type-title-sm-line, 24px);
        font-weight: var(--type-title-sm-weight, 600);
        color: var(--color-text-primary, #18181b);
      }

      .text-body {
        font-family: var(--font-family-body);
        font-size: var(--type-body-md-size, 14px);
        line-height: var(--type-body-md-line, 20px);
        color: var(--color-text-secondary, #414651);
      }

      .surface-note {
        font-family: var(--font-family-body);
        font-size: var(--type-caption-xs-size, 11px);
        line-height: var(--type-caption-xs-line, 14px);
        color: var(--color-text-muted, #616775);
      }

      .control-strip {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-inline-sm, 4px);
      }

      .control-button,
      .control-chip,
      .control-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-block-size: 2.3rem;
        padding: 0.55rem 0.82rem;
        border: 1px solid var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-card, #faf9f5);
        color: var(--color-text-primary, #18181b);
        box-shadow: var(--shadow-control);
        font-family: var(--font-family-body);
        font-size: var(--type-body-md-size, 14px);
        line-height: var(--type-body-md-line, 20px);
      }

      .control-chip {
        border-radius: var(--radius-round, 9999px);
        padding-inline: 0.85rem;
      }

      .control-toggle {
        justify-content: flex-start;
        inline-size: 2.85rem;
        block-size: 1.65rem;
        min-block-size: 1.65rem;
        padding: 0.12rem;
        border-radius: var(--radius-round, 9999px);
      }

      .control-toggle::after {
        content: "";
        inline-size: 1.15rem;
        block-size: 1.15rem;
        border-radius: 999px;
        background: #fff;
        box-shadow: 0 1px 1px rgba(28, 26, 13, 0.16);
        transform: translateX(1.2rem);
      }

      @container (min-width: 56rem) {
        .layout {
          grid-template-columns: minmax(18rem, 22rem) minmax(0, 1fr);
          align-items: start;
        }

        .editor {
          border-block-end: none;
          overflow-y: auto;
        }

        .preview-grid {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          align-items: start;
        }
      }
    </style>
    <div class="lab">
      <div class="layout">
        <section class="editor">
          <div class="editor-header">
            <p class="tool-title">Elevation</p>
          </div>
          <div class="token-form"></div>
          <div class="action-row">
            <button class="tool-button primary" type="button" data-action="copy">Copy value set</button>
            <button class="tool-button" type="button" data-action="reset">Reset</button>
          </div>
          <textarea class="output" readonly data-output aria-label="Current token value set"></textarea>
          <p class="copy-status" data-copy-status>Copy the edited set to send back for registry updates.</p>
        </section>

        <section class="preview">
          <div class="section-title">
            <h3>Representative elevation</h3>
          </div>

          <div class="preview-grid">
            <section class="preview-panel">
              <div class="preview-stage">
                <div class="elevation-stack">
                  <div class="elevation-control">
                    <p class="mini-label">Control lift</p>
                    <div class="control-strip">
                      <span class="control-button">Control button</span>
                      <span class="control-chip">Density</span>
                      <span class="control-toggle" aria-hidden="true"></span>
                    </div>
                  </div>
                  <p class="surface-note">Control elevation should stay tight and tactile, giving buttons and toggles a little edge pop without looking like miniature cards.</p>
                </div>
              </div>
            </section>

            <section class="preview-panel">
              <div class="preview-stage">
                <div class="elevation-stack">
                  <div class="elevation-card">
                    <p class="mini-label">Resting card</p>
                    <p class="text-heading">A quiet lift with a little edge definition.</p>
                    <p class="text-body">The tighter shadow should help the edge read, while the wider lighter shadow gives the surface some air.</p>
                  </div>
                  <p class="surface-note">Resting elevation should feel present without turning every card into a floating overlay.</p>
                </div>
              </div>
            </section>

            <section class="preview-panel">
              <div class="preview-stage">
                <div class="elevation-stack">
                  <div class="elevation-floating">
                    <p class="mini-label">Floating layer</p>
                    <p class="text-heading">Menus and overlays need a stronger lift.</p>
                    <p class="text-body">The near-edge shadow gives outline pop; the wider lighter shadow creates the spread and multi-light feeling.</p>
                  </div>
                  <p class="surface-note">Floating elevation should clearly sit above the page and contained cards, but still stay soft enough for the warm surface system.</p>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  `;

  const form = root.querySelector(".token-form");
  const output = root.querySelector("[data-output]") as HTMLTextAreaElement | null;
  const copyStatus = root.querySelector("[data-copy-status]") as HTMLParagraphElement | null;
  const copyButton = root.querySelector('[data-action="copy"]') as HTMLButtonElement | null;
  const resetButton = root.querySelector('[data-action="reset"]') as HTMLButtonElement | null;

  if (!form || !output || !copyStatus || !copyButton || !resetButton) {
    return root;
  }

  const currentValues = new Map<string, string>(
    shadowTokens.map((token) => [token.id, initialValues[token.id] ?? String(token.value)]),
  );

  const writeOutput = (): string => {
    const snapshot = Object.fromEntries(
      shadowTokens.map((token) => [token.id, currentValues.get(token.id) ?? String(token.value)]),
    );
    const text = JSON.stringify(snapshot, null, 2);
    output.value = text;
    return text;
  };

  const applyValue = (tokenId: string, value: string): void => {
    currentValues.set(tokenId, value);
    root.style.setProperty(tokenIdToCssVar(tokenId), value);
    writeOutput();
  };

  const section = document.createElement("section");
  section.className = "token-group";
  section.innerHTML = `<div class="group-title">Shadow tokens</div>`;

  for (const token of shadowTokens) {
    const row = document.createElement("label");
    row.className = "token-row";
    const inputId = `elevation-lab-${token.id.replace(/\./g, "-")}`;
    row.innerHTML = `
      <div class="token-main">
        <div class="token-copy">
          <div class="token-id">${token.id}</div>
          <div class="token-help">${token.metadata.cssProperty}</div>
        </div>
        <div class="tool-input-wrap">
          <input
            id="${inputId}"
            class="tool-input"
            type="text"
            value="${currentValues.get(token.id) ?? String(token.value)}"
            data-token-id="${token.id}"
            title="${token.metadata.cssProperty}"
          />
        </div>
      </div>
    `;

    const input = row.querySelector("input");
    if (input) {
      input.addEventListener("input", (event) => {
        const nextValue = (event.target as HTMLInputElement).value;
        applyValue(token.id, nextValue);
      });
    }

    section.append(row);
  }

  form.append(section);
  writeOutput();

  copyButton.addEventListener("click", async () => {
    const text = writeOutput();
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent =
        "Copied the current elevation value set to your clipboard.";
    } catch {
      copyStatus.textContent =
        "Clipboard copy failed, but the current value set is available in the output box below.";
      output.focus();
      output.select();
    }
  });

  resetButton.addEventListener("click", () => {
    for (const token of shadowTokens) {
      const value = initialValues[token.id] ?? String(token.value);
      currentValues.set(token.id, value);
      root.style.setProperty(tokenIdToCssVar(token.id), value);
      const input = root.querySelector(`[data-token-id="${token.id}"]`) as HTMLInputElement | null;
      if (input) {
        input.value = value;
      }
    }
    copyStatus.textContent = "Elevation values reset to the current registry defaults.";
    writeOutput();
  });

  return root;
}

function renderMotionLab(): HTMLElement {
  const root = document.createElement("section");
  root.setAttribute("data-story", "violet-motion-lab");

  const initialValues = Object.fromEntries(
    motionTokens.map((token) => [token.id, String(token.value)]),
  );

  root.innerHTML = `
    <style>
      :host, [data-story="violet-motion-lab"] {
        ${buildRegistryCssVars(violetTokenRegistry.tokens)}
        --font-family-body: "Montserrat", "Segoe UI", sans-serif;
        --font-family-title: "Bitter", Georgia, serif;
        color: var(--color-text-primary, #18181b);
        font-family: var(--font-family-body);
        background: #f8f9fa;
        display: block;
        min-block-size: 100vh;
      }

      h3, p { margin: 0; }

      .lab {
        display: grid;
        padding: 0;
        container-type: inline-size;
      }

      .layout {
        display: grid;
        gap: 0.5rem;
        min-inline-size: 0;
      }

      .editor {
        display: grid;
        gap: 0;
        align-content: start;
        border-block-end: 1px solid #d0d7e2;
        min-inline-size: 0;
        overflow-x: hidden;
      }

      .editor-header {
        display: flex;
        align-items: center;
        padding: 0.4rem 0.65rem;
        border-block-end: 1px solid #e1e4e8;
        background: #f1f3f5;
      }

      .tool-title,
      .section-title h3,
      .group-title,
      .mini-label {
        margin: 0;
        font: 600 0.75rem/1.3 "IBM Plex Mono", monospace;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #57606a;
      }

      .token-form {
        display: grid;
        gap: 0;
        min-inline-size: 0;
      }

      .token-group {
        display: grid;
        gap: 0;
      }

      .group-title {
        padding: 0.4rem 0.65rem;
        border-block-end: 1px solid #e1e4e8;
        background: #f6f8fa;
      }

      .token-row {
        display: grid;
        gap: 0.24rem;
        padding: 0.3rem 0.65rem;
        border-block-end: 1px solid #eaecef;
        background: transparent;
        min-inline-size: 0;
      }

      .token-row:hover {
        background: #f0f3f6;
      }

      .token-main {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 13rem;
        align-items: center;
        gap: 0.5rem;
        min-inline-size: 0;
      }

      .token-copy {
        display: grid;
        gap: 0.1rem;
        min-inline-size: 0;
      }

      .token-id {
        font: 400 0.78rem/1.3 "IBM Plex Mono", monospace;
        color: #24292f;
      }

      .token-help {
        color: #656d76;
        font-size: 0.68rem;
        line-height: 1.3;
      }

      .tool-input-wrap {
        display: grid;
        min-inline-size: 0;
      }

      .tool-input {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 1.75rem;
        padding: 0 0.45rem;
        border-radius: 3px;
        border: 1px solid #c8d0db;
        background: #ffffff;
        color: #24292f;
        font: 0.72rem/1.3 "IBM Plex Mono", monospace;
      }

      .tool-input:focus-visible {
        outline: 2px solid #3b82f6;
        outline-offset: 1px;
      }

      .action-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        padding: 0.35rem 0.65rem;
        border-block-start: 1px solid #e1e4e8;
      }

      .tool-button {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        min-block-size: 1.6rem;
        padding: 0 0.5rem;
        border-radius: 3px;
        border: 1px solid #d0d7e2;
        background: #ffffff;
        color: #57606a;
        font: 0.75rem/1.2 "IBM Plex Sans", "Segoe UI", sans-serif;
        cursor: pointer;
      }

      .tool-button.primary {
        background: #0969da;
        border-color: #0969da;
        color: #ffffff;
      }

      .output {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 15rem;
        padding: 0.35rem 0.65rem;
        border-radius: 0;
        border: none;
        border-block-start: 1px solid #e1e4e8;
        background: #f6f8fa;
        color: #24292f;
        font: 0.72rem/1.4 "IBM Plex Mono", monospace;
        resize: vertical;
      }

      .copy-status {
        padding: 0.25rem 0.65rem;
        margin: 0;
        font-size: 0.68rem;
        line-height: 1.3;
        color: #656d76;
        border-block-start: 1px solid #eaecef;
      }

      .preview {
        display: grid;
        gap: 0.75rem;
        padding: 0;
        background: transparent;
        position: sticky;
        top: 0.9rem;
        align-content: start;
      }

      .section-title {
        display: grid;
        gap: 0.1rem;
      }

      .preview-grid {
        display: grid;
        gap: 0.75rem;
      }

      .preview-panel {
        display: grid;
        gap: 0.75rem;
      }

      .preview-stage {
        display: grid;
        gap: var(--space-layout-sm, 12px);
        padding: 1rem;
        border-radius: var(--radius-md, 4px);
        background: var(--color-surface-page, #fffefa);
        min-inline-size: 0;
      }

      .motion-button-row,
      .motion-tab-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-inline-sm, 4px);
      }

      .motion-button,
      .motion-tab {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-block-size: 2.35rem;
        padding: 0.55rem 0.88rem;
        border-radius: var(--radius-md, 4px);
        border: 1px solid transparent;
        font-family: var(--font-family-body);
        font-size: var(--type-body-md-size, 14px);
        line-height: var(--type-body-md-line, 20px);
        transition:
          transform var(--duration-fast, 120ms) var(--easing-standard, cubic-bezier(0.2, 0, 0, 1)),
          box-shadow var(--duration-base, 180ms) var(--easing-standard, cubic-bezier(0.2, 0, 0, 1)),
          background-color var(--duration-fast, 120ms) var(--easing-standard, cubic-bezier(0.2, 0, 0, 1)),
          border-color var(--duration-fast, 120ms) var(--easing-standard, cubic-bezier(0.2, 0, 0, 1)),
          color var(--duration-fast, 120ms) var(--easing-standard, cubic-bezier(0.2, 0, 0, 1));
      }

      .motion-button.primary {
        background: var(--color-action-primary-background);
        color: var(--color-action-primary-text);
        box-shadow: var(--shadow-control);
      }

      .motion-button.secondary {
        background: var(--color-action-secondary-background);
        color: var(--color-action-secondary-text);
        border-color: var(--color-action-secondary-border);
        box-shadow: var(--shadow-control);
      }

      .motion-button.is-active {
        transform: translateY(-1px);
        box-shadow: var(--shadow-card);
      }

      .focus-shell {
        display: grid;
        gap: var(--space-stack-xs, 4px);
      }

      .focus-field {
        display: flex;
        align-items: center;
        min-block-size: 2.7rem;
        padding: 0.72rem 0.85rem;
        border-radius: var(--radius-md, 4px);
        border: 1px solid var(--color-field-border);
        background: var(--color-field-background);
        transition:
          box-shadow var(--duration-base, 180ms) var(--easing-standard, cubic-bezier(0.2, 0, 0, 1)),
          border-color var(--duration-base, 180ms) var(--easing-standard, cubic-bezier(0.2, 0, 0, 1)),
          transform var(--duration-fast, 120ms) var(--easing-standard, cubic-bezier(0.2, 0, 0, 1));
      }

      .focus-field.is-active {
        border-color: color-mix(in srgb, var(--color-focus-ring) 48%, var(--color-field-border));
        box-shadow: 0 0 0 2px var(--color-focus-ring);
        transform: translateY(-1px);
      }

      .motion-tab {
        background: transparent;
        color: var(--color-text-secondary);
        border-color: transparent;
        border-bottom-color: var(--color-border-subtle);
        border-radius: 0;
        padding-inline: 0.2rem 0.35rem;
      }

      .motion-tab.is-active {
        color: var(--color-text-primary);
        border-bottom-color: var(--color-action-primary-background);
        transform: translateY(-1px);
      }

      .menu-shell {
        display: grid;
        gap: 0.4rem;
        max-inline-size: 16rem;
        padding: 0.85rem;
        border-radius: var(--radius-lg, 6px);
        background: var(--color-surface-floating);
        box-shadow: var(--shadow-floating);
        opacity: 0;
        transform: translateY(8px) scale(0.985);
      }

      .menu-shell.is-active {
        animation: menu-enter var(--duration-slow, 280ms) var(--easing-emphasized, cubic-bezier(0.16, 1, 0.3, 1)) forwards;
      }

      .menu-item {
        padding: 0.58rem 0.72rem;
        border-radius: var(--radius-md, 4px);
        background: #fff;
        border: 1px solid var(--color-border-subtle);
      }

      .menu-item.active {
        background: var(--color-surface-selected);
      }

      .scroll-shell {
        display: grid;
        gap: 0;
        block-size: 12rem;
        overflow: auto;
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-lg, 6px);
        background: var(--color-surface-card);
      }

      .scroll-bar {
        position: sticky;
        inset-block-start: 0;
        z-index: var(--z-index-raised, 1);
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.7rem 0.85rem;
        background: color-mix(in srgb, var(--color-surface-card) 92%, white);
        border-bottom: 1px solid rgba(28, 26, 13, 0.06);
        transition:
          transform var(--duration-base, 180ms) var(--easing-emphasized, cubic-bezier(0.16, 1, 0.3, 1)),
          box-shadow var(--duration-base, 180ms) var(--easing-emphasized, cubic-bezier(0.16, 1, 0.3, 1)),
          background-color var(--duration-base, 180ms) var(--easing-standard, cubic-bezier(0.2, 0, 0, 1));
      }

      .scroll-shell.is-bumped .scroll-bar {
        transform: translateY(1px);
        box-shadow: var(--shadow-control);
        background: color-mix(in srgb, var(--color-surface-card) 84%, white);
      }

      .scroll-content {
        display: grid;
        gap: var(--space-stack-sm, 8px);
        padding: 0.8rem;
      }

      .scroll-item {
        padding: 0.72rem 0.78rem;
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-md, 4px);
        background: #fff;
      }

      .surface-note {
        font-family: var(--font-family-body);
        font-size: var(--type-caption-xs-size, 11px);
        line-height: var(--type-caption-xs-line, 14px);
        color: var(--color-text-muted, #616775);
      }

      @keyframes menu-enter {
        from {
          opacity: 0;
          transform: translateY(8px) scale(0.985);
        }

        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .motion-button,
        .motion-tab,
        .focus-field,
        .scroll-bar {
          transition: none;
        }

        .menu-shell {
          animation: none !important;
          opacity: 1;
          transform: none;
        }
      }

      @container (min-width: 56rem) {
        .layout {
          grid-template-columns: minmax(18rem, 22rem) minmax(0, 1fr);
          align-items: start;
        }

        .editor {
          border-block-end: none;
          overflow-y: auto;
        }

        .preview-grid {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          align-items: start;
        }
      }
    </style>
    <div class="lab">
      <div class="layout">
        <section class="editor">
          <div class="editor-header">
            <p class="tool-title">Motion</p>
          </div>
          <div class="token-form"></div>
          <div class="action-row">
            <button class="tool-button primary" type="button" data-action="copy">Copy value set</button>
            <button class="tool-button" type="button" data-action="reset">Reset</button>
            <button class="tool-button" type="button" data-action="replay">Replay preview</button>
          </div>
          <textarea class="output" readonly data-output aria-label="Current token value set"></textarea>
          <p class="copy-status" data-copy-status>Copy the edited motion value set to send back for registry updates.</p>
        </section>

        <section class="preview">
          <div class="section-title">
            <h3>Representative motion</h3>
          </div>

          <div class="preview-grid">
            <section class="preview-panel">
              <div class="preview-stage">
                <p class="mini-label">Action feedback</p>
                <div class="motion-button-row">
                  <button class="motion-button primary" type="button" data-demo="button-primary">Primary action</button>
                  <button class="motion-button secondary" type="button" data-demo="button-secondary">Secondary action</button>
                </div>
                <p class="surface-note">Small interactions should feel quick and tactile, not twitchy.</p>
              </div>
            </section>

            <section class="preview-panel">
              <div class="preview-stage">
                <p class="mini-label">Focus and selection</p>
                <div class="focus-shell">
                  <div class="focus-field" data-demo="focus-field">Focused planting field</div>
                  <div class="motion-tab-row">
                    <span class="motion-tab" data-demo="tab-active">Overview</span>
                    <span class="motion-tab">Schedule</span>
                    <span class="motion-tab">Inventory</span>
                  </div>
                </div>
                <p class="surface-note">Default motion should help focus and selection settle into place without calling too much attention to itself.</p>
              </div>
            </section>

            <section class="preview-panel">
              <div class="preview-stage">
                <p class="mini-label">Overlay enter</p>
                <div class="menu-shell" data-demo="menu-shell">
                  <div class="menu-item active">Selected view</div>
                  <div class="menu-item">Upcoming tasks</div>
                  <div class="menu-item">Archive list</div>
                </div>
                <p class="surface-note">Larger transitions can carry a little more lift, but should still stay calm and soft.</p>
              </div>
            </section>

            <section class="preview-panel">
              <div class="preview-stage">
                <p class="mini-label">Scroll bump</p>
                <div class="scroll-shell" data-demo="scroll-shell" tabindex="0" aria-label="Scrollable planning notes preview">
                  <div class="scroll-bar">Pinned planning summary <span>12 beds</span></div>
                  <div class="scroll-content">
                    <div class="scroll-item">Romancesco bed prep and watering notes</div>
                    <div class="scroll-item">Midnight Roma tomato pruning reminder</div>
                    <div class="scroll-item">Black currant feeding schedule</div>
                    <div class="scroll-item">Seedling inventory check for tray 14B</div>
                    <div class="scroll-item">Soil amendment follow-up for the east bed</div>
                    <div class="scroll-item">Next sowing date for spring lettuce</div>
                  </div>
                </div>
                <p class="surface-note">A scroll bump should feel like a tiny structural lift, not a whole new layer snapping into view.</p>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  `;

  const form = root.querySelector(".token-form");
  const output = root.querySelector("[data-output]") as HTMLTextAreaElement | null;
  const copyStatus = root.querySelector("[data-copy-status]") as HTMLParagraphElement | null;
  const copyButton = root.querySelector('[data-action="copy"]') as HTMLButtonElement | null;
  const resetButton = root.querySelector('[data-action="reset"]') as HTMLButtonElement | null;
  const replayButton = root.querySelector('[data-action="replay"]') as HTMLButtonElement | null;
  const scrollShell = root.querySelector('[data-demo="scroll-shell"]') as HTMLDivElement | null;

  if (!form || !output || !copyStatus || !copyButton || !resetButton || !replayButton) {
    return root;
  }

  const currentValues = new Map<string, string>(
    motionTokens.map((token) => [token.id, initialValues[token.id] ?? String(token.value)]),
  );

  const writeOutput = (): string => {
    const snapshot = Object.fromEntries(
      motionTokens.map((token) => [token.id, currentValues.get(token.id) ?? String(token.value)]),
    );
    const text = JSON.stringify(snapshot, null, 2);
    output.value = text;
    return text;
  };

  const applyValue = (tokenId: string, value: string): void => {
    currentValues.set(tokenId, value);
    root.style.setProperty(tokenIdToCssVar(tokenId), value);
    writeOutput();
  };

  const groups = [
    {
      title: "Durations",
      tokens: motionTokens.filter((token) => token.id.startsWith("duration.")),
    },
    {
      title: "Easing",
      tokens: motionTokens.filter((token) => token.id.startsWith("easing.")),
    },
  ];

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "token-group";
    section.innerHTML = `<div class="group-title">${group.title}</div>`;

    for (const token of group.tokens) {
      const row = document.createElement("label");
      row.className = "token-row";
      const inputId = `motion-lab-${token.id.replace(/\./g, "-")}`;
      row.innerHTML = `
        <div class="token-main">
          <div class="token-copy">
            <div class="token-id">${token.id}</div>
            <div class="token-help">${token.metadata.cssProperty}</div>
          </div>
          <div class="tool-input-wrap">
            <input
              id="${inputId}"
              class="tool-input"
              type="text"
              value="${currentValues.get(token.id) ?? String(token.value)}"
              data-token-id="${token.id}"
              title="${token.metadata.cssProperty}"
            />
          </div>
        </div>
      `;

      const input = row.querySelector("input");
      if (input) {
        input.addEventListener("input", (event) => {
          const nextValue = (event.target as HTMLInputElement).value;
          applyValue(token.id, nextValue);
        });
      }

      section.append(row);
    }

    form.append(section);
  }

  writeOutput();

  const replayPreview = (): void => {
    const primaryButton = root.querySelector('[data-demo="button-primary"]') as HTMLElement | null;
    const secondaryButton = root.querySelector('[data-demo="button-secondary"]') as HTMLElement | null;
    const focusField = root.querySelector('[data-demo="focus-field"]') as HTMLElement | null;
    const activeTab = root.querySelector('[data-demo="tab-active"]') as HTMLElement | null;
    const menuShell = root.querySelector('[data-demo="menu-shell"]') as HTMLElement | null;
    const scrollDemoShell = root.querySelector('[data-demo="scroll-shell"]') as HTMLDivElement | null;

    primaryButton?.classList.remove("is-active");
    secondaryButton?.classList.remove("is-active");
    focusField?.classList.remove("is-active");
    activeTab?.classList.remove("is-active");
    menuShell?.classList.remove("is-active");

    if (scrollDemoShell) {
      scrollDemoShell.scrollTop = 0;
      scrollDemoShell.classList.remove("is-bumped");
    }

    void root.offsetWidth;

    window.setTimeout(() => {
      primaryButton?.classList.add("is-active");
    }, 70);

    window.setTimeout(() => {
      focusField?.classList.add("is-active");
    }, 150);

    window.setTimeout(() => {
      activeTab?.classList.add("is-active");
    }, 220);

    window.setTimeout(() => {
      menuShell?.classList.add("is-active");
    }, 300);

    window.setTimeout(() => {
      window.setTimeout(() => {
        secondaryButton?.classList.add("is-active");
      }, 0);
    }, 380);

    if (scrollDemoShell) {
      window.setTimeout(() => {
        scrollDemoShell.scrollTo({ top: 36, behavior: "smooth" });
      }, 480);
    }
  };

  copyButton.addEventListener("click", async () => {
    const text = writeOutput();
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent =
        "Copied the current motion value set to your clipboard.";
    } catch {
      copyStatus.textContent =
        "Clipboard copy failed, but the current value set is available in the output box below.";
      output.focus();
      output.select();
    }
  });

  resetButton.addEventListener("click", () => {
    for (const token of motionTokens) {
      const value = initialValues[token.id] ?? String(token.value);
      currentValues.set(token.id, value);
      root.style.setProperty(tokenIdToCssVar(token.id), value);
      const input = root.querySelector(`[data-token-id="${token.id}"]`) as HTMLInputElement | null;
      if (input) {
        input.value = value;
      }
    }
    copyStatus.textContent = "Motion values reset to the current registry defaults.";
    writeOutput();
    replayPreview();
  });

  replayButton.addEventListener("click", () => {
    replayPreview();
    copyStatus.textContent = "Replayed the motion preview.";
  });

  if (scrollShell) {
    const updateScrollBump = (): void => {
      scrollShell.classList.toggle("is-bumped", scrollShell.scrollTop > 2);
    };

    scrollShell.addEventListener("scroll", updateScrollBump);
    updateScrollBump();
  }

  window.setTimeout(() => {
    replayPreview();
  }, 80);

  return root;
}

function renderActionAndStateLab(): HTMLElement {
  const root = document.createElement("section");
  root.setAttribute("data-story", "violet-action-state-lab");

  const initialValues = Object.fromEntries(
    actionStateTokens.map((token) => [token.id, String(token.value)]),
  );

  root.innerHTML = `
    <style>
      :host, [data-story="violet-action-state-lab"] {
        ${buildRegistryCssVars(violetTokenRegistry.tokens)}
        --font-family-body: "Montserrat", "Segoe UI", sans-serif;
        --font-family-title: "Bitter", Georgia, serif;
        --font-family-mono: "Space Mono", monospace;
        color: var(--color-text-primary, #18181b);
        font-family: var(--font-family-body);
        background: #f8f9fa;
        display: block;
        min-block-size: 100vh;
      }

      h3, p { margin: 0; }

      .lab, .layout, .token-form, .token-group, .preview, .preview-grid, .preview-panel, .preview-stage, .action-stack, .state-stack, .token-copy, .tool-input-wrap {
        display: grid;
        min-inline-size: 0;
      }

      .lab { padding: 0; container-type: inline-size; }
      .layout { gap: 0.5rem; }

      .editor {
        display: grid;
        gap: 0;
        align-content: start;
        border-block-end: 1px solid #d0d7e2;
        min-inline-size: 0;
        overflow-x: hidden;
      }

      .editor-header {
        display: flex;
        align-items: center;
        padding: 0.4rem 0.65rem;
        border-block-end: 1px solid #e1e4e8;
        background: #f1f3f5;
      }

      .tool-title,
      .section-title h3,
      .group-title,
      .mini-label {
        margin: 0;
        font: 600 0.75rem/1.3 "IBM Plex Mono", monospace;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #57606a;
      }

      .group-title {
        padding: 0.4rem 0.65rem;
        border-block-end: 1px solid #e1e4e8;
        background: #f6f8fa;
      }

      .token-row {
        display: grid;
        gap: 0.24rem;
        padding: 0.3rem 0.65rem;
        border-block-end: 1px solid #eaecef;
        background: transparent;
      }

      .token-row:hover { background: #f0f3f6; }

      .token-main {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 4.2rem 7rem;
        align-items: center;
        gap: 0.5rem;
      }

      .token-copy { gap: 0.1rem; }

      .token-id {
        font: 400 0.78rem/1.3 "IBM Plex Mono", monospace;
        color: #24292f;
      }

      .token-help {
        color: #656d76;
        font-size: 0.68rem;
        line-height: 1.3;
      }

      .token-swatch {
        inline-size: 100%;
        block-size: 1.4rem;
        border-radius: 3px;
        border: 1px solid #c8d0db;
      }

      .tool-input {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 1.75rem;
        padding: 0 0.45rem;
        border-radius: 3px;
        border: 1px solid #c8d0db;
        background: #ffffff;
        color: #24292f;
        font: 0.72rem/1.3 "IBM Plex Mono", monospace;
      }

      .tool-input:focus-visible {
        outline: 2px solid #3b82f6;
        outline-offset: 1px;
      }

      .action-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        padding: 0.35rem 0.65rem;
        border-block-start: 1px solid #e1e4e8;
      }

      .tool-button {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        min-block-size: 1.6rem;
        padding: 0 0.5rem;
        border-radius: 3px;
        border: 1px solid #d0d7e2;
        background: #ffffff;
        color: #57606a;
        font: 0.75rem/1.2 "IBM Plex Sans", "Segoe UI", sans-serif;
        cursor: pointer;
      }

      .tool-button.primary {
        background: #0969da;
        border-color: #0969da;
        color: #ffffff;
      }

      .output {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 15rem;
        padding: 0.35rem 0.65rem;
        border: none;
        border-block-start: 1px solid #e1e4e8;
        background: #f6f8fa;
        color: #24292f;
        font: 0.72rem/1.4 "IBM Plex Mono", monospace;
        resize: vertical;
      }

      .copy-status {
        padding: 0.25rem 0.65rem;
        margin: 0;
        font-size: 0.68rem;
        line-height: 1.3;
        color: #656d76;
        border-block-start: 1px solid #eaecef;
      }

      .preview {
        gap: 0.75rem;
        padding: 0;
        background: transparent;
        position: sticky;
        top: 0.9rem;
        align-content: start;
      }

      .section-title { gap: 0.1rem; }
      .preview-grid { gap: 0.75rem; }
      .preview-panel { gap: 0.75rem; }

      .preview-stage {
        gap: var(--space-layout-sm, 12px);
        padding: 1rem;
        border-radius: var(--radius-md, 4px);
        background: linear-gradient(180deg, rgba(255, 254, 250, 1) 0%, rgba(240, 239, 230, 0.9) 100%);
      }

      .action-stack,
      .state-stack {
        gap: var(--space-layout-sm, 12px);
      }

      .button-row {
        display: flex;
        gap: var(--space-inline-sm, 4px);
        flex-wrap: wrap;
      }

      .action-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-block-size: 2.1rem;
        padding: 0 0.8rem;
        border-radius: var(--radius-md, 4px);
        font: 500 var(--type-label-sm-size, 12px)/var(--type-label-sm-line, 16px) "Montserrat", "Segoe UI", sans-serif;
        border: 1px solid transparent;
      }

      .action-button.primary {
        background: var(--color-action-primary-background);
        color: var(--color-action-primary-text);
      }

      .action-button.primary.hover { background: var(--color-action-primary-hover); }
      .action-button.primary.pressed { background: var(--color-action-primary-pressed); }

      .action-button.secondary {
        background: var(--color-action-secondary-background);
        color: var(--color-action-secondary-text);
        border-color: var(--color-action-secondary-border);
      }

      .action-button.secondary.hover { background: var(--color-action-secondary-hover); }
      .action-button.secondary.pressed { background: var(--color-action-secondary-pressed); }

      .state-card {
        display: grid;
        gap: var(--space-stack-xs, 4px);
        padding: 0.85rem;
        border-radius: var(--radius-md, 4px);
      }

      .state-card.success {
        background: var(--color-state-success-background);
        color: var(--color-state-success-text);
        border: 1px solid var(--color-state-success-border);
      }

      .state-card.warning {
        background: var(--color-state-warning-background);
        color: var(--color-state-warning-text);
        border: 1px solid var(--color-state-warning-border);
      }

      .state-card.danger {
        background: var(--color-state-danger-background);
        color: var(--color-state-danger-text);
        border: 1px solid var(--color-state-danger-border);
      }

      .text-heading {
        font-family: "Bitter", Georgia, serif;
        font-size: var(--type-title-sm-size, 18px);
        line-height: var(--type-title-sm-line, 24px);
        font-weight: var(--type-title-sm-weight, 600);
      }

      .text-body {
        font-family: "Montserrat", "Segoe UI", sans-serif;
        font-size: var(--type-body-md-size, 14px);
        line-height: var(--type-body-md-line, 20px);
      }

      @container (min-width: 56rem) {
        .layout {
          grid-template-columns: minmax(18rem, 22rem) minmax(0, 1fr);
          align-items: start;
        }

        .editor {
          border-block-end: none;
          overflow-y: auto;
        }

        .preview-grid {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          align-items: start;
        }
      }
    </style>
    <div class="lab">
      <div class="layout">
        <section class="editor">
          <div class="editor-header">
            <p class="tool-title">Actions and state</p>
          </div>
          <div class="token-form"></div>
          <div class="action-row">
            <button class="tool-button primary" type="button" data-action="copy">Copy value set</button>
            <button class="tool-button" type="button" data-action="reset">Reset</button>
          </div>
          <textarea class="output" readonly data-output aria-label="Current token value set"></textarea>
          <p class="copy-status" data-copy-status>Copy the edited set to send back for registry updates.</p>
        </section>

        <section class="preview">
          <div class="section-title">
            <h3>Representative actions and state</h3>
          </div>

          <div class="preview-grid">
            <section class="preview-panel">
              <div class="preview-stage">
                <div class="action-stack">
                  <div>
                    <p class="mini-label">Primary action</p>
                    <div class="button-row">
                      <button class="action-button primary" type="button">Resting</button>
                      <button class="action-button primary hover" type="button">Hover</button>
                      <button class="action-button primary pressed" type="button">Pressed</button>
                    </div>
                  </div>
                  <div>
                    <p class="mini-label">Secondary action</p>
                    <div class="button-row">
                      <button class="action-button secondary" type="button">Resting</button>
                      <button class="action-button secondary hover" type="button">Hover</button>
                      <button class="action-button secondary pressed" type="button">Pressed</button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section class="preview-panel">
              <div class="preview-stage">
                <div class="state-stack">
                  <div class="state-card success">
                    <p class="mini-label">Success state</p>
                    <p class="text-body">Plan saved and bed updates were applied successfully.</p>
                  </div>
                  <div class="state-card warning">
                    <p class="mini-label">Warning state</p>
                    <p class="text-body">This planting date is close to the last expected frost.</p>
                  </div>
                  <div class="state-card danger">
                    <p class="mini-label">Danger state</p>
                    <p class="text-body">This field needs a valid quantity before checkout can continue.</p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  `;

  const form = root.querySelector(".token-form");
  const output = root.querySelector("[data-output]") as HTMLTextAreaElement | null;
  const copyStatus = root.querySelector("[data-copy-status]") as HTMLParagraphElement | null;
  const copyButton = root.querySelector('[data-action="copy"]') as HTMLButtonElement | null;
  const resetButton = root.querySelector('[data-action="reset"]') as HTMLButtonElement | null;

  if (!form || !output || !copyStatus || !copyButton || !resetButton) {
    return root;
  }

  const currentValues = new Map<string, string>(
    actionStateTokens.map((token) => [token.id, initialValues[token.id] ?? String(token.value)]),
  );

  const groups = [
    {
      title: "Actions",
      tokens: actionStateTokens.filter((token) => token.id.startsWith("color.action.")),
    },
    {
      title: "State",
      tokens: actionStateTokens.filter((token) => token.id.startsWith("color.state.")),
    },
  ];

  const writeOutput = (): string => {
    const snapshot = Object.fromEntries(
      actionStateTokens.map((token) => [token.id, currentValues.get(token.id) ?? String(token.value)]),
    );
    const text = JSON.stringify(snapshot, null, 2);
    output.value = text;
    return text;
  };

  const applyValue = (tokenId: string, value: string): void => {
    currentValues.set(tokenId, value);
    root.style.setProperty(tokenIdToCssVar(tokenId), value);
    const swatch = root.querySelector(`[data-swatch-id="${tokenId}"]`) as HTMLElement | null;
    if (swatch) {
      swatch.style.background = value;
    }
    writeOutput();
  };

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "token-group";
    section.innerHTML = `<div class="group-title">${group.title}</div>`;

    for (const token of group.tokens) {
      const row = document.createElement("label");
      row.className = "token-row";
      const inputId = `action-state-lab-${token.id.replace(/\./g, "-")}`;
      row.innerHTML = `
        <div class="token-main">
          <div class="token-copy">
            <div class="token-id">${token.id}</div>
            <div class="token-help">${token.metadata.cssProperty}</div>
          </div>
          <div class="token-swatch" data-swatch-id="${token.id}" style="background:${tokenValueToCssValue(token.value)};"></div>
          <div class="tool-input-wrap">
            <input
              id="${inputId}"
              class="tool-input"
              type="text"
              value="${currentValues.get(token.id) ?? String(token.value)}"
              data-token-id="${token.id}"
              title="${token.metadata.cssProperty}"
            />
          </div>
        </div>
      `;

      const input = row.querySelector("input");
      if (input) {
        input.addEventListener("input", (event) => {
          const nextValue = (event.target as HTMLInputElement).value;
          applyValue(token.id, nextValue);
        });
      }

      section.append(row);
    }

    form.append(section);
  }

  writeOutput();

  copyButton.addEventListener("click", async () => {
    const text = writeOutput();
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = "Copied the current action and state value set to your clipboard.";
    } catch {
      copyStatus.textContent =
        "Clipboard copy failed, but the current value set is available in the output box below.";
      output.focus();
      output.select();
    }
  });

  resetButton.addEventListener("click", () => {
    for (const token of actionStateTokens) {
      const value = initialValues[token.id] ?? String(token.value);
      currentValues.set(token.id, value);
      root.style.setProperty(tokenIdToCssVar(token.id), value);
      const input = root.querySelector(`[data-token-id="${token.id}"]`) as HTMLInputElement | null;
      if (input) {
        input.value = value;
      }
      const swatch = root.querySelector(`[data-swatch-id="${token.id}"]`) as HTMLElement | null;
      if (swatch) {
        swatch.style.background = value;
      }
    }
    copyStatus.textContent = "Action and state values reset to the current registry defaults.";
    writeOutput();
  });

  return root;
}

function renderFormInputLab(): HTMLElement {
  const root = document.createElement("section");
  root.setAttribute("data-story", "violet-form-input-lab");

  const initialValues = Object.fromEntries(
    fieldTokens.map((token) => [token.id, typeof token.value === "string" ? token.value : tokenValueToCssValue(token.value)]),
  );

  root.innerHTML = `
    <style>
      :host, [data-story="violet-form-input-lab"] {
        ${buildRegistryCssVars(violetTokenRegistry.tokens)}
        --font-family-body: "Montserrat", "Segoe UI", sans-serif;
        color: var(--color-text-primary, #18181b);
        font-family: var(--font-family-body);
        background: #f8f9fa;
        display: block;
        min-block-size: 100vh;
      }

      h3, p { margin: 0; }
      .lab, .layout, .token-form, .token-group, .preview, .preview-grid, .preview-panel, .preview-stage, .field-stack, .token-copy, .tool-input-wrap {
        display: grid;
        min-inline-size: 0;
      }
      .lab { padding: 0; container-type: inline-size; }
      .layout { gap: 0.5rem; }

      .editor {
        display: grid;
        gap: 0;
        align-content: start;
        border-block-end: 1px solid #d0d7e2;
        min-inline-size: 0;
        overflow-x: hidden;
      }

      .editor-header {
        display: flex;
        align-items: center;
        padding: 0.4rem 0.65rem;
        border-block-end: 1px solid #e1e4e8;
        background: #f1f3f5;
      }

      .tool-title,
      .section-title h3,
      .group-title,
      .mini-label {
        margin: 0;
        font: 600 0.75rem/1.3 "IBM Plex Mono", monospace;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #57606a;
      }

      .group-title {
        padding: 0.4rem 0.65rem;
        border-block-end: 1px solid #e1e4e8;
        background: #f6f8fa;
      }

      .token-row {
        display: grid;
        gap: 0.24rem;
        padding: 0.3rem 0.65rem;
        border-block-end: 1px solid #eaecef;
        background: transparent;
      }

      .token-row:hover { background: #f0f3f6; }

      .token-main {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 4.2rem 7rem;
        align-items: center;
        gap: 0.5rem;
      }

      .token-copy { gap: 0.1rem; }

      .token-id {
        font: 400 0.78rem/1.3 "IBM Plex Mono", monospace;
        color: #24292f;
      }

      .token-help {
        color: #656d76;
        font-size: 0.68rem;
        line-height: 1.3;
      }

      .token-swatch {
        inline-size: 100%;
        block-size: 1.4rem;
        border-radius: 3px;
        border: 1px solid #c8d0db;
      }

      .tool-input {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 1.75rem;
        padding: 0 0.45rem;
        border-radius: 3px;
        border: 1px solid #c8d0db;
        background: #ffffff;
        color: #24292f;
        font: 0.72rem/1.3 "IBM Plex Mono", monospace;
      }

      .tool-input:focus-visible {
        outline: 2px solid #3b82f6;
        outline-offset: 1px;
      }

      .action-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        padding: 0.35rem 0.65rem;
        border-block-start: 1px solid #e1e4e8;
      }

      .tool-button {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        min-block-size: 1.6rem;
        padding: 0 0.5rem;
        border-radius: 3px;
        border: 1px solid #d0d7e2;
        background: #ffffff;
        color: #57606a;
        font: 0.75rem/1.2 "IBM Plex Sans", "Segoe UI", sans-serif;
        cursor: pointer;
      }

      .tool-button.primary {
        background: #0969da;
        border-color: #0969da;
        color: #ffffff;
      }

      .output {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 15rem;
        padding: 0.35rem 0.65rem;
        border: none;
        border-block-start: 1px solid #e1e4e8;
        background: #f6f8fa;
        color: #24292f;
        font: 0.72rem/1.4 "IBM Plex Mono", monospace;
        resize: vertical;
      }

      .copy-status {
        padding: 0.25rem 0.65rem;
        margin: 0;
        font-size: 0.68rem;
        line-height: 1.3;
        color: #656d76;
        border-block-start: 1px solid #eaecef;
      }

      .preview {
        gap: 0.75rem;
        padding: 0;
        background: transparent;
        position: sticky;
        top: 0.9rem;
        align-content: start;
      }

      .section-title { gap: 0.1rem; }
      .preview-grid { gap: 0.75rem; }
      .preview-panel { gap: 0.75rem; }

      .preview-stage {
        gap: var(--space-layout-sm, 12px);
        padding: 1rem;
        border-radius: var(--radius-md, 4px);
        background: linear-gradient(180deg, rgba(255, 254, 250, 1) 0%, rgba(240, 239, 230, 0.9) 100%);
      }

      .field-stack { gap: var(--space-layout-sm, 12px); }

      .field-shell {
        display: grid;
        gap: var(--space-stack-xs, 4px);
      }

      .field-label {
        font: 500 var(--type-label-sm-size, 12px)/var(--type-label-sm-line, 16px) "Montserrat", "Segoe UI", sans-serif;
        color: var(--color-text-secondary, #414651);
      }

      .field-control,
      .field-area {
        border-radius: var(--radius-md, 4px);
        background: var(--color-field-background);
        color: var(--color-field-text);
        border: 1px solid var(--color-field-border);
        font: 400 var(--type-body-md-size, 14px)/var(--type-body-md-line, 20px) "Montserrat", "Segoe UI", sans-serif;
      }

      .field-control {
        min-block-size: 2.25rem;
        padding: 0 0.75rem;
        display: flex;
        align-items: center;
      }

      .field-area {
        min-block-size: 5.5rem;
        padding: 0.7rem 0.75rem;
      }

      .field-placeholder {
        color: var(--color-field-placeholder);
      }

      .field-hover .field-control {
        border-color: var(--color-field-border-hover);
      }

      .field-focus .field-control {
        border-color: var(--color-field-border-focus);
        box-shadow: 0 0 0 2px var(--color-field-border-focus);
      }

      .field-readonly .field-control {
        background: var(--color-field-background-readonly);
      }

      .field-invalid .field-control {
        border-color: var(--color-field-border-invalid);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-field-border-invalid) 55%, transparent);
      }

      .field-note {
        font: 400 var(--type-caption-xs-size, 11px)/var(--type-caption-xs-line, 14px) "Montserrat", "Segoe UI", sans-serif;
        color: var(--color-text-muted);
      }

      @container (min-width: 56rem) {
        .layout {
          grid-template-columns: minmax(18rem, 22rem) minmax(0, 1fr);
          align-items: start;
        }

        .editor {
          border-block-end: none;
          overflow-y: auto;
        }

        .preview-grid {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          align-items: start;
        }
      }
    </style>
    <div class="lab">
      <div class="layout">
        <section class="editor">
          <div class="editor-header">
            <p class="tool-title">Form and input</p>
          </div>
          <div class="token-form"></div>
          <div class="action-row">
            <button class="tool-button primary" type="button" data-action="copy">Copy value set</button>
            <button class="tool-button" type="button" data-action="reset">Reset</button>
          </div>
          <textarea class="output" readonly data-output aria-label="Current token value set"></textarea>
          <p class="copy-status" data-copy-status>Copy the edited set to send back for registry updates.</p>
        </section>

        <section class="preview">
          <div class="section-title">
            <h3>Representative form and input</h3>
          </div>

          <div class="preview-grid">
            <section class="preview-panel">
              <div class="preview-stage">
                <div class="field-stack">
                  <div class="field-shell">
                    <p class="field-label">Default field</p>
                    <div class="field-control">Midnight Roma tomato</div>
                    <p class="field-note">Default entry state with resting border.</p>
                  </div>
                  <div class="field-shell field-hover">
                    <p class="field-label">Hovered field</p>
                    <div class="field-control">Hover border treatment</div>
                  </div>
                  <div class="field-shell field-focus">
                    <p class="field-label">Focused field</p>
                    <div class="field-control">Focused value</div>
                  </div>
                </div>
              </div>
            </section>

            <section class="preview-panel">
              <div class="preview-stage">
                <div class="field-stack">
                  <div class="field-shell field-readonly">
                    <p class="field-label">Readonly field</p>
                    <div class="field-control">Seed lot 14B</div>
                  </div>
                  <div class="field-shell field-invalid">
                    <p class="field-label">Invalid field</p>
                    <div class="field-control"><span class="field-placeholder">Enter quantity</span></div>
                    <p class="field-note">Quantity is required before checkout can continue.</p>
                  </div>
                  <div class="field-shell">
                    <p class="field-label">Textarea</p>
                    <div class="field-area"><span class="field-placeholder">Add planting notes for this bed...</span></div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  `;

  const form = root.querySelector(".token-form");
  const output = root.querySelector("[data-output]") as HTMLTextAreaElement | null;
  const copyStatus = root.querySelector("[data-copy-status]") as HTMLParagraphElement | null;
  const copyButton = root.querySelector('[data-action="copy"]') as HTMLButtonElement | null;
  const resetButton = root.querySelector('[data-action="reset"]') as HTMLButtonElement | null;

  if (!form || !output || !copyStatus || !copyButton || !resetButton) {
    return root;
  }

  const currentValues = new Map<string, string>(
    fieldTokens.map((token) => [token.id, typeof token.value === "string" ? token.value : tokenValueToCssValue(token.value)]),
  );

  const groups = [
    {
      title: "Field surface",
      tokens: fieldTokens.filter((token) => token.id.startsWith("color.field.background")),
    },
    {
      title: "Field text",
      tokens: fieldTokens.filter((token) => token.id === "color.field.text" || token.id === "color.field.placeholder"),
    },
    {
      title: "Field border",
      tokens: fieldTokens.filter((token) => token.id.startsWith("color.field.border")),
    },
  ];

  const writeOutput = (): string => {
    const snapshot = Object.fromEntries(
      fieldTokens.map((token) => [token.id, currentValues.get(token.id) ?? (typeof token.value === "string" ? token.value : tokenValueToCssValue(token.value))]),
    );
    const text = JSON.stringify(snapshot, null, 2);
    output.value = text;
    return text;
  };

  const applyValue = (tokenId: string, value: string): void => {
    currentValues.set(tokenId, value);
    root.style.setProperty(tokenIdToCssVar(tokenId), value);
    const swatch = root.querySelector(`[data-swatch-id="${tokenId}"]`) as HTMLElement | null;
    if (swatch) {
      swatch.style.background = value;
    }
    writeOutput();
  };

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "token-group";
    section.innerHTML = `<div class="group-title">${group.title}</div>`;

    for (const token of group.tokens) {
      const row = document.createElement("label");
      row.className = "token-row";
      const inputId = `form-input-lab-${token.id.replace(/\./g, "-")}`;
      row.innerHTML = `
        <div class="token-main">
          <div class="token-copy">
            <div class="token-id">${token.id}</div>
            <div class="token-help">${token.metadata.cssProperty}</div>
          </div>
          <div class="token-swatch" data-swatch-id="${token.id}" style="background:${typeof token.value === "string" ? token.value : tokenValueToCssValue(token.value)};"></div>
          <div class="tool-input-wrap">
            <input
              id="${inputId}"
              class="tool-input"
              type="text"
              value="${currentValues.get(token.id) ?? (typeof token.value === "string" ? token.value : tokenValueToCssValue(token.value))}"
              data-token-id="${token.id}"
              title="${token.metadata.cssProperty}"
            />
          </div>
        </div>
      `;

      const input = row.querySelector("input");
      if (input) {
        input.addEventListener("input", (event) => {
          const nextValue = (event.target as HTMLInputElement).value;
          applyValue(token.id, nextValue);
        });
      }

      section.append(row);
    }

    form.append(section);
  }

  writeOutput();

  copyButton.addEventListener("click", async () => {
    const text = writeOutput();
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = "Copied the current form and input value set to your clipboard.";
    } catch {
      copyStatus.textContent =
        "Clipboard copy failed, but the current value set is available in the output box below.";
      output.focus();
      output.select();
    }
  });

  resetButton.addEventListener("click", () => {
    for (const token of fieldTokens) {
      const defaultValue = typeof token.value === "string" ? token.value : tokenValueToCssValue(token.value);
      const value = initialValues[token.id] ?? defaultValue;
      currentValues.set(token.id, value);
      root.style.setProperty(tokenIdToCssVar(token.id), value);
      const input = root.querySelector(`[data-token-id="${token.id}"]`) as HTMLInputElement | null;
      if (input) {
        input.value = value;
      }
      const swatch = root.querySelector(`[data-swatch-id="${token.id}"]`) as HTMLElement | null;
      if (swatch) {
        swatch.style.background = value;
      }
    }
    copyStatus.textContent = "Form and input values reset to the current registry defaults.";
    writeOutput();
  });

  return root;
}

function renderPaletteLab(): HTMLElement {
  const root = document.createElement("div");
  const registryCssVars = buildRegistryCssVars(violetTokenRegistry.tokens);
  const initialValues = Object.fromEntries(rawPaletteEntries.map((entry) => [entry.id, entry.hex]));

  root.className = "palette-lab";
  root.style.cssText = `
    ${registryCssVars}
    ${rawPaletteEntries.map((entry) => `--raw-${entry.id}: ${entry.hex};`).join("\n")}
  `;

  root.innerHTML = `
    <style>
      .palette-lab {
        min-block-size: 100vh;
        padding: 0;
        background: #fff;
        color: var(--color-text-primary);
        font-family: Montserrat, sans-serif;
      }

      .palette-lab *, .palette-lab *::before, .palette-lab *::after {
        box-sizing: border-box;
      }

      .palette-layout {
        display: grid;
        grid-template-columns: minmax(23rem, 28rem) minmax(0, 1fr);
        gap: 0.875rem;
        align-items: start;
      }

      .palette-rail {
        min-inline-size: 0;
        overflow-x: hidden;
        background: #f8f9fa;
        border-inline-end: 1px solid rgba(28, 26, 13, 0.08);
      }

      .palette-header,
      .palette-preview {
        padding: 0.95rem 1rem;
      }

      .palette-kicker,
      .section-title h3,
      .group-title,
      .preview-eyebrow,
      .kit-status {
        margin: 0;
        color: #556170;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.92rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .palette-title {
        margin: 0.15rem 0 0;
        color: var(--color-text-primary);
        font-family: Bitter, serif;
        font-size: 1.25rem;
        line-height: 1.1;
      }

      .token-form {
        display: grid;
        gap: 0.75rem;
        padding: 0 1rem 1rem;
      }

      .token-row {
        display: block;
        padding: 0 0 0.7rem;
        border-bottom: 1px solid rgba(28, 26, 13, 0.08);
      }

      .token-main {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 1.4rem 6rem;
        gap: 0.65rem;
        align-items: start;
        min-inline-size: 0;
      }

      .token-copy {
        min-inline-size: 0;
      }

      .token-id {
        margin: 0;
        color: var(--color-text-primary);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.98rem;
        font-weight: 500;
      }

      .token-help {
        margin-top: 0.22rem;
        color: var(--color-text-secondary);
        font-size: 0.92rem;
        line-height: 1.3;
      }

      .token-swatch {
        inline-size: 1.4rem;
        block-size: 1.4rem;
        border-radius: 999px;
        border: 1px solid rgba(28, 26, 13, 0.16);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.45);
      }

      .tool-input-wrap,
      .tool-output-wrap {
        min-inline-size: 0;
      }

      .tool-input,
      .tool-output {
        inline-size: 100%;
        min-inline-size: 0;
        padding: 0.42rem 0.55rem;
        border: 1px solid rgba(28, 26, 13, 0.16);
        border-radius: 0.28rem;
        background: #fff;
        color: var(--color-text-primary);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.94rem;
      }

      .tool-output {
        min-block-size: 15rem;
        resize: vertical;
        background: #fdfdfd;
      }

      .tool-actions {
        display: flex;
        gap: 0.45rem;
        padding: 0 1rem 0.75rem;
      }

      .tool-button {
        border: 1px solid rgba(28, 26, 13, 0.16);
        border-radius: 0.28rem;
        padding: 0.42rem 0.68rem;
        background: #fff;
        color: var(--color-text-primary);
        font: 500 0.94rem Montserrat, sans-serif;
        cursor: pointer;
      }

      .tool-button.primary {
        background: var(--color-action-primary-background);
        border-color: var(--color-action-primary-background);
        color: var(--color-action-primary-text);
      }

      .copy-status {
        margin: 0;
        padding: 0 1rem 0.7rem;
        color: var(--color-text-secondary);
        font-size: 0.88rem;
        line-height: 1.35;
      }

      .palette-preview {
        min-inline-size: 0;
      }

      .section-title {
        margin-bottom: 0.75rem;
      }

      .preview-grid {
        display: grid;
        gap: 0.875rem;
      }

      .preview-panel {
        border: 1px solid rgba(28, 26, 13, 0.1);
        border-radius: var(--radius-md);
        background: #fff;
        overflow: hidden;
      }

      .preview-stage {
        padding: 0.85rem;
      }

      .swatch-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
        gap: 0.75rem;
      }

      .swatch-card {
        border: 1px solid rgba(28, 26, 13, 0.1);
        border-radius: var(--radius-md);
        background: #fff;
        overflow: hidden;
      }

      .swatch-tone {
        block-size: 4.6rem;
        border-bottom: 1px solid rgba(28, 26, 13, 0.08);
      }

      .swatch-meta {
        display: grid;
        gap: 0.18rem;
        padding: 0.65rem 0.7rem 0.72rem;
      }

      .swatch-name {
        color: var(--color-text-primary);
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.92rem;
        font-weight: 500;
      }

      .swatch-value {
        color: var(--color-text-secondary);
        font-size: 0.9rem;
      }

      .mapping-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
        gap: 0.75rem;
      }

      .mapping-card {
        display: grid;
        gap: 0.45rem;
        min-block-size: 8rem;
        padding: 0.9rem;
        border-radius: var(--radius-md);
        border: 1px solid rgba(28, 26, 13, 0.08);
      }

      .mapping-label {
        margin: 0;
        color: #556170;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.84rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .mapping-copy {
        margin: 0;
        font-size: 0.96rem;
        line-height: 1.4;
      }

      .ink-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
        gap: 0.65rem;
      }

      .ink-chip {
        display: flex;
        align-items: center;
        justify-content: center;
        min-block-size: 3.25rem;
        padding: 0.6rem 0.75rem;
        border-radius: var(--radius-round);
        border: 1px solid rgba(28, 26, 13, 0.08);
        font-size: 0.92rem;
        font-weight: 500;
      }
    </style>

    <div class="palette-layout">
      <section class="palette-rail">
        <header class="palette-header">
          <p class="palette-kicker">Raw Palette</p>
          <h2 class="palette-title">Named colors and semantic cues</h2>
        </header>
        <div class="token-form"></div>
        <div class="tool-actions">
          <button class="tool-button primary" type="button" data-action="copy">Copy value set</button>
          <button class="tool-button" type="button" data-action="reset">Reset</button>
        </div>
        <div class="tool-output-wrap" style="padding: 0 1rem;">
          <textarea class="tool-output" data-output spellcheck="false" aria-label="Current raw palette value set"></textarea>
        </div>
        <p class="copy-status" data-copy-status>Copy the edited raw palette set to send back for proposal updates.</p>
      </section>

      <section class="palette-preview">
        <div class="section-title">
          <h3>Raw palette and semantic cues</h3>
        </div>

        <div class="preview-grid">
          <section class="preview-panel">
            <div class="preview-stage">
              <div class="preview-eyebrow">Raw swatches</div>
              <div class="swatch-grid">
                ${rawPaletteEntries.map((entry) => `
                  <article class="swatch-card">
                    <div class="swatch-tone" data-raw-tone="${entry.id}" style="background: var(--raw-${entry.id});"></div>
                    <div class="swatch-meta">
                      <div class="swatch-name">${entry.id}</div>
                      <div class="swatch-value" data-raw-value="${entry.id}">${entry.hex}</div>
                      <div class="swatch-value">${entry.roleHint}</div>
                    </div>
                  </article>
                `).join("")}
              </div>
            </div>
          </section>

          <section class="preview-panel">
            <div class="preview-stage">
              <div class="preview-eyebrow">Semantic mapping</div>
              <div class="mapping-grid">
                <article class="mapping-card" style="background: var(--raw-oat-blossom); color: var(--raw-black-pitch);">
                  <p class="mapping-label">Surface page</p>
                  <p class="mapping-copy">Broad warm canvas anchored by oat-blossom and kept light enough for quiet reading surfaces.</p>
                </article>
                <article class="mapping-card" style="background: color-mix(in srgb, var(--raw-oat-blossom) 45%, white); color: var(--raw-black-pitch);">
                  <p class="mapping-label">Surface card</p>
                  <p class="mapping-copy">Card surfaces should step brighter than the page without breaking the warm neutral family.</p>
                </article>
                <article class="mapping-card" style="background: var(--raw-dry-sage); color: var(--raw-black-pitch);">
                  <p class="mapping-label">Surface subtle</p>
                  <p class="mapping-copy">Recessed or quieter structural zones can borrow the dry-sage family for gentle definition.</p>
                </article>
                <article class="mapping-card" style="background: color-mix(in srgb, var(--raw-rain-mint) 18%, white); color: var(--raw-black-pitch);">
                  <p class="mapping-label">Surface selected</p>
                  <p class="mapping-copy">Selection can feel related to the green family without competing with the main action accent.</p>
                </article>
              </div>
            </div>
          </section>

          <section class="preview-panel">
            <div class="preview-stage">
              <div class="preview-eyebrow">Accent and ink family</div>
              <div class="ink-grid">
                <div class="ink-chip" style="background: var(--raw-ripe-tomato); color: var(--raw-black-pitch);">Ripe-tomato action</div>
                <div class="ink-chip" style="background: color-mix(in srgb, var(--raw-rain-mint) 28%, white); color: var(--raw-black-pitch);">Rain-mint accent</div>
                <div class="ink-chip" style="background: #fff; color: var(--raw-pine-teal);">Pine-teal ink</div>
                <div class="ink-chip" style="background: #fff; color: var(--raw-chestnut);">Chestnut ink</div>
                <div class="ink-chip" style="background: #fff; color: var(--raw-black-pitch);">Black-pitch body</div>
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  `;

  const form = root.querySelector(".token-form");
  const output = root.querySelector("[data-output]") as HTMLTextAreaElement | null;
  const copyStatus = root.querySelector("[data-copy-status]") as HTMLParagraphElement | null;
  const copyButton = root.querySelector('[data-action="copy"]') as HTMLButtonElement | null;
  const resetButton = root.querySelector('[data-action="reset"]') as HTMLButtonElement | null;

  if (!form || !output || !copyStatus || !copyButton || !resetButton) {
    return root;
  }

  const currentValues = new Map<string, string>(rawPaletteEntries.map((entry) => [entry.id, entry.hex]));

  const writeOutput = (): string => {
    const snapshot = Object.fromEntries(rawPaletteEntries.map((entry) => [entry.id, currentValues.get(entry.id) ?? entry.hex]));
    const text = JSON.stringify(snapshot, null, 2);
    output.value = text;
    return text;
  };

  const applyValue = (paletteId: string, value: string): void => {
    currentValues.set(paletteId, value);
    root.style.setProperty(`--raw-${paletteId}`, value);
    const swatch = root.querySelector(`[data-swatch-id="${paletteId}"]`) as HTMLElement | null;
    if (swatch) {
      swatch.style.background = value;
    }
    const tone = root.querySelector(`[data-raw-tone="${paletteId}"]`) as HTMLElement | null;
    if (tone) {
      tone.style.background = value;
    }
    const valueLabel = root.querySelector(`[data-raw-value="${paletteId}"]`) as HTMLElement | null;
    if (valueLabel) {
      valueLabel.textContent = value;
    }
    writeOutput();
  };

  for (const entry of rawPaletteEntries) {
    const row = document.createElement("label");
    row.className = "token-row";
    row.innerHTML = `
      <div class="token-main">
        <div class="token-copy">
          <div class="token-id">${entry.id}</div>
          <div class="token-help">${entry.roleHint}</div>
        </div>
        <div class="token-swatch" data-swatch-id="${entry.id}" style="background:${entry.hex};"></div>
        <div class="tool-input-wrap">
          <input
            class="tool-input"
            type="text"
            value="${entry.hex}"
            data-token-id="${entry.id}"
            title="${entry.roleHint}"
          />
        </div>
      </div>
    `;

    const input = row.querySelector("input");
    if (input) {
      input.addEventListener("input", (event) => {
        const nextValue = (event.target as HTMLInputElement).value;
        applyValue(entry.id, nextValue);
      });
    }

    form.append(row);
  }

  writeOutput();

  copyButton.addEventListener("click", async () => {
    const text = writeOutput();
    try {
      await navigator.clipboard.writeText(text);
      copyStatus.textContent = "Copied the current raw palette value set to your clipboard.";
    } catch {
      copyStatus.textContent =
        "Clipboard copy failed, but the current raw palette value set is available in the output box below.";
      output.focus();
      output.select();
    }
  });

  resetButton.addEventListener("click", () => {
    for (const entry of rawPaletteEntries) {
      const value = initialValues[entry.id] ?? entry.hex;
      currentValues.set(entry.id, value);
      root.style.setProperty(`--raw-${entry.id}`, value);
      const input = root.querySelector(`[data-token-id="${entry.id}"]`) as HTMLInputElement | null;
      if (input) {
        input.value = value;
      }
      const swatch = root.querySelector(`[data-swatch-id="${entry.id}"]`) as HTMLElement | null;
      if (swatch) {
        swatch.style.background = value;
      }
      const tone = root.querySelector(`[data-raw-tone="${entry.id}"]`) as HTMLElement | null;
      if (tone) {
        tone.style.background = value;
      }
      const valueLabel = root.querySelector(`[data-raw-value="${entry.id}"]`) as HTMLElement | null;
      if (valueLabel) {
        valueLabel.textContent = value;
      }
    }
    copyStatus.textContent = "Raw palette values reset to the current proposal defaults.";
    writeOutput();
  });

  return root;
}

function renderReferenceKitLab(): HTMLElement {
  const root = document.createElement("div");
  root.className = "reference-kit-lab";
  root.style.cssText = buildRegistryCssVars(violetTokenRegistry.tokens);

  root.innerHTML = `
    <style>
      .reference-kit-lab {
        min-block-size: 100vh;
        padding: 0;
        background: #fff;
        color: var(--color-text-primary);
        font-family: Montserrat, sans-serif;
      }

      .reference-kit-lab *, .reference-kit-lab *::before, .reference-kit-lab *::after {
        box-sizing: border-box;
      }

      .kit-layout {
        display: grid;
        grid-template-columns: minmax(22rem, 26rem) minmax(0, 1fr);
        gap: 0.875rem;
        align-items: start;
      }

      .kit-rail {
        min-inline-size: 0;
        padding: 1rem;
        background: #f8f9fa;
        border-inline-end: 1px solid rgba(28, 26, 13, 0.08);
      }

      .kit-kicker,
      .kit-section-title,
      .kit-status,
      .section-title h3 {
        margin: 0;
        color: #556170;
        font-family: "IBM Plex Mono", monospace;
        font-size: 0.92rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .kit-title {
        margin: 0.16rem 0 0.3rem;
        font-family: Bitter, serif;
        font-size: 1.24rem;
        line-height: 1.12;
      }

      .kit-note {
        margin: 0;
        color: var(--color-text-secondary);
        font-size: 0.95rem;
        line-height: 1.45;
      }

      .kit-list {
        display: grid;
        gap: 0.75rem;
        margin-top: 0.9rem;
      }

      .kit-item {
        display: grid;
        gap: 0.45rem;
        padding: 0.8rem 0;
        border-bottom: 1px solid rgba(28, 26, 13, 0.08);
      }

      .kit-item-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.75rem;
      }

      .kit-item-title {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
      }

      .kit-shape,
      .kit-why,
      .kit-validates {
        margin: 0;
        color: var(--color-text-secondary);
        font-size: 0.92rem;
        line-height: 1.35;
      }

      .kit-validates strong {
        color: var(--color-text-primary);
        font-weight: 600;
      }

      .kit-preview {
        min-inline-size: 0;
        padding: 1rem;
      }

      .section-title {
        margin-bottom: 0.75rem;
      }

      .kit-preview-grid {
        display: grid;
        gap: 0.875rem;
      }

      .kit-panel {
        border: 1px solid rgba(28, 26, 13, 0.1);
        border-radius: var(--radius-md);
        background: var(--color-surface-page);
        overflow: hidden;
      }

      .kit-stage {
        display: grid;
        gap: 0.9rem;
        padding: 0.95rem;
      }

      .kit-section-title {
        margin-bottom: 0.45rem;
      }

      .button-row,
      .compact-row,
      .tab-row,
      .toggle-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-inline-sm);
      }

      .demo-button,
      .demo-chip,
      .demo-tab {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-inline-sm);
        min-block-size: 2.4rem;
        padding: 0.58rem 0.92rem;
        border-radius: var(--radius-md);
        border: 1px solid transparent;
        font: 500 var(--type-body-md-size)/var(--type-body-md-line) Montserrat, sans-serif;
      }

      .demo-button.primary {
        background: var(--color-action-primary-background);
        color: var(--color-action-primary-text);
        box-shadow: var(--shadow-card);
      }

      .demo-button.secondary {
        background: var(--color-action-secondary-background);
        color: var(--color-action-secondary-text);
        border-color: var(--color-action-secondary-border);
      }

      .demo-button.quiet {
        background: transparent;
        color: var(--color-text-secondary);
        border-color: var(--color-border-subtle);
      }

      .field-shell {
        display: grid;
        gap: 0.3rem;
      }

      .field-label {
        margin: 0;
        color: var(--color-text-secondary);
        font-size: 0.92rem;
        font-weight: 500;
      }

      .field-control {
        display: flex;
        align-items: center;
        min-block-size: 2.7rem;
        padding: 0.7rem 0.82rem;
        border: 1px solid var(--color-field-border);
        border-radius: var(--radius-md);
        background: var(--color-field-background);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
      }

      .field-helper {
        margin: 0;
        color: var(--color-text-muted);
        font-size: 0.88rem;
      }

      .control-chip,
      .switch-track,
      .demo-menu-item,
      .demo-card,
      .demo-menu,
      .demo-slider,
      .demo-checkbox,
      .demo-radio {
        border: 1px solid var(--color-border-subtle);
      }

      .control-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
        gap: 0.75rem;
      }

      .control-card {
        display: grid;
        gap: 0.55rem;
        padding: 0.8rem;
        border-radius: var(--radius-md);
        background: var(--color-surface-card);
      }

      .demo-checkbox,
      .demo-radio {
        inline-size: 1rem;
        block-size: 1rem;
        border-radius: 0.22rem;
        background: #fff;
      }

      .demo-radio {
        border-radius: 999px;
      }

      .demo-checkbox.checked {
        background: var(--color-control-selected-background);
        border-color: var(--color-control-selected-border);
        box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-control-selected-foreground) 28%, white);
      }

      .demo-radio.checked {
        box-shadow: inset 0 0 0 4px var(--color-control-selected-foreground);
      }

      .switch-track {
        position: relative;
        inline-size: 2.55rem;
        block-size: 1.45rem;
        border-radius: var(--radius-round);
        background: var(--color-control-selected-background);
        border: 1px solid var(--color-control-selected-border);
      }

      .switch-track::after {
        content: "";
        position: absolute;
        inset-block-start: 0.12rem;
        inset-inline-start: 1.18rem;
        inline-size: 1.05rem;
        block-size: 1.05rem;
        border-radius: 999px;
        background: #fff;
        box-shadow: var(--shadow-card);
      }

      .demo-tab {
        background: transparent;
        color: var(--color-text-secondary);
        border-color: transparent;
        border-bottom-color: var(--color-border-subtle);
        border-radius: 0;
        padding-inline: 0.1rem 0.35rem;
      }

      .demo-tab.active {
        color: var(--color-text-primary);
        border-bottom-color: var(--color-action-primary-background);
        font-weight: 600;
      }

      .demo-slider {
        position: relative;
        block-size: 0.4rem;
        border-radius: var(--radius-round);
        background: color-mix(in srgb, var(--color-action-primary-background) 18%, white);
      }

      .demo-slider::before {
        content: "";
        position: absolute;
        inset: 0;
        inline-size: 58%;
        border-radius: inherit;
        background: var(--color-action-primary-background);
      }

      .demo-slider::after {
        content: "";
        position: absolute;
        inset-block-start: 50%;
        inset-inline-start: 58%;
        transform: translate(-50%, -50%);
        inline-size: 1rem;
        block-size: 1rem;
        border-radius: 999px;
        background: #fff;
        border: 2px solid var(--color-action-primary-background);
        box-shadow: var(--shadow-card);
      }

      .surface-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.1fr) minmax(14rem, 0.9fr);
        gap: 0.8rem;
      }

      .demo-card {
        display: grid;
        gap: 0.55rem;
        padding: 1rem;
        border-radius: var(--radius-lg);
        background: var(--color-surface-card);
        box-shadow: var(--shadow-card);
      }

      .demo-card h4,
      .demo-menu h4 {
        margin: 0;
        font: var(--type-title-sm-weight) var(--type-title-sm-size)/var(--type-title-sm-line) Bitter, serif;
        color: var(--color-text-primary);
      }

      .demo-card p,
      .demo-menu p {
        margin: 0;
        color: var(--color-text-secondary);
        font-size: 0.95rem;
        line-height: 1.45;
      }

      .demo-menu {
        display: grid;
        gap: 0.35rem;
        padding: 0.85rem;
        border-radius: var(--radius-lg);
        background: var(--color-surface-floating);
        box-shadow: var(--shadow-floating);
      }

      .demo-menu-item {
        display: flex;
        align-items: center;
        min-block-size: 2.4rem;
        padding: 0.58rem 0.78rem;
        border-radius: var(--radius-md);
        background: #fff;
      }

      .demo-menu-item.active {
        background: var(--color-surface-selected);
      }

      .data-grid-shell {
        padding: 0.9rem;
        border-radius: var(--radius-lg);
        background: var(--color-surface-card);
        box-shadow: var(--shadow-card);
      }
    </style>

    <div class="kit-layout">
      <section class="kit-rail">
        <p class="kit-kicker">Reference Kit</p>
        <h2 class="kit-title">The smallest set that shapes the whole system</h2>
        <p class="kit-note">These references should cover the major interaction and composition shapes before we expand the component library.</p>
        <div class="kit-list">
          ${referenceComponentSet.map((component) => `
            <article class="kit-item">
              <div class="kit-item-header">
                <h3 class="kit-item-title">${component.title}</h3>
                <span class="kit-status">${statusLabel(component.status)}</span>
              </div>
              <p class="kit-shape">${component.shape}</p>
              <p class="kit-validates"><strong>Validates:</strong> ${component.validates.join(", ")}</p>
              <p class="kit-why">${component.whyItMatters}</p>
            </article>
          `).join("")}
        </div>
      </section>

      <section class="kit-preview">
        <div class="section-title">
          <h3>Reference kit in one surface</h3>
        </div>

        <div class="kit-preview-grid">
          <section class="kit-panel">
            <div class="kit-stage">
              <div>
                <p class="kit-section-title">Action and field shell</p>
                <div class="button-row">
                  <button class="demo-button primary" type="button">Save bed plan</button>
                  <button class="demo-button secondary" type="button">Secondary action</button>
                  <button class="demo-button quiet" type="button">Quiet action</button>
                </div>
              </div>
              <div class="field-shell">
                <p class="field-label">Plant name</p>
                <div class="field-control">Midnight Roma tomato</div>
                <p class="field-helper">Neutral field styling should stay calm next to the main action.</p>
              </div>
            </div>
          </section>

          <section class="kit-panel">
            <div class="kit-stage">
              <p class="kit-section-title">Selection controls</p>
              <div class="control-grid">
                <div class="control-card">
                  <div class="toggle-row"><span class="demo-checkbox checked"></span><span>Checkbox</span></div>
                  <div class="toggle-row"><span class="demo-radio checked"></span><span>Radio</span></div>
                  <div class="toggle-row"><span class="switch-track"></span><span>Switch</span></div>
                </div>
                <div class="control-card">
                  <div class="tab-row">
                    <span class="demo-tab active">Overview</span>
                    <span class="demo-tab">Schedule</span>
                    <span class="demo-tab">Inventory</span>
                  </div>
                  <div class="field-shell">
                    <p class="field-label">Density</p>
                    <div class="demo-slider"></div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="kit-panel">
            <div class="kit-stage">
              <p class="kit-section-title">Surface and menu patterns</p>
              <div class="surface-grid">
                <article class="demo-card">
                  <h4>Seedling card</h4>
                  <p>Cards reconcile surface, spacing, type, and action emphasis outside of dense data views.</p>
                  <div class="compact-row">
                    <span class="demo-chip" style="background: var(--color-surface-subtle); border-radius: var(--radius-round); padding: 0.4rem 0.7rem;">Date planted</span>
                    <span class="demo-chip" style="background: var(--color-surface-selected); border-radius: var(--radius-round); padding: 0.4rem 0.7rem;">Selected</span>
                  </div>
                </article>

                <aside class="demo-menu">
                  <h4>Menu / popover</h4>
                  <div class="demo-menu-item active">Selected view</div>
                  <div class="demo-menu-item">Upcoming tasks</div>
                  <div class="demo-menu-item">Archive list</div>
                </aside>
              </div>
            </div>
          </section>

          <section class="kit-panel">
            <div class="kit-stage">
              <p class="kit-section-title">Dense structured data</p>
              <div class="data-grid-shell">
                <violet-data-grid
                  heading="Cultivation planning"
                  row-label="plant"
                  selectable
                  sticky-header
                ></violet-data-grid>
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  `;

  const grid = root.querySelector("violet-data-grid") as
    | (HTMLElement & {
        columns: typeof gridColumns;
        rows: typeof gridRows;
      })
    | null;
  if (grid) {
    grid.columns = gridColumns;
    grid.rows = gridRows;
  }

  return root;
}

const meta = {
  title: "Foundations/Overview",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Registry-driven token catalog and applied-system review surface for Violet foundations.",
      },
    },
  },
  render: () => renderFoundationsOverview(),
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  play: async ({ canvasElement }) => {
    const heading = canvasElement.querySelector("h1");
    await expect(heading?.textContent).toContain(
      "Token review needs a real catalog",
    );

    const tokenCards = canvasElement.querySelectorAll(".token-card");
    await expect(tokenCards.length).toBeGreaterThan(0);

    const componentCards = canvasElement.querySelectorAll(".component-card");
    await expect(componentCards.length).toBeGreaterThan(0);
  },
};

export const AppliedSystem: Story = {
  render: () => renderAppliedSystem(),
  play: async ({ canvasElement }) => {
    const grid = canvasElement.querySelector("violet-data-grid");
    await expect(Boolean(grid)).toBe(true);

    const primaryButton = canvasElement.querySelector(".button.primary");
    await expect(primaryButton?.textContent).toContain("Primary action");

    const menuItem = canvasElement.querySelector(".menu-item.active");
    await expect(menuItem?.textContent).toContain("Selected view");
  },
};

export const PaletteLab: Story = {
  render: () => renderPaletteLab(),
  play: async ({ canvasElement }) => {
    const inputs = canvasElement.querySelectorAll(".tool-input");
    await expect(inputs.length).toBeGreaterThan(0);

    const output = canvasElement.querySelector(
      "[data-output]",
    ) as HTMLTextAreaElement | null;
    await expect(output?.value).toContain("oat-blossom");
    await expect(output?.value).toContain("ripe-tomato");

    const previewTitle = canvasElement.querySelector(".section-title h3");
    await expect(previewTitle?.textContent).toContain("Raw palette and semantic cues");
  },
};

export const RadiusLab: Story = {
  render: () => renderRadiusLab(),
  play: async ({ canvasElement }) => {
    const inputs = canvasElement.querySelectorAll(".tool-input");
    await expect(inputs.length).toBeGreaterThan(0);

    const output = canvasElement.querySelector(
      "[data-output]",
    ) as HTMLTextAreaElement | null;
    await expect(output?.value).toContain("radius.md");

    const copyButton = canvasElement.querySelector('[data-action="copy"]');
    await expect(copyButton?.textContent).toContain("Copy value set");
  },
};

export const DensityLab: Story = {
  render: () => renderDensityLab(),
  play: async ({ canvasElement }) => {
    const inputs = canvasElement.querySelectorAll(".tool-input");
    await expect(inputs.length).toBeGreaterThan(0);

    const output = canvasElement.querySelector(
      "[data-output]",
    ) as HTMLTextAreaElement | null;
    await expect(output?.value).toContain("size.target.compact");
    await expect(output?.value).toContain("size.target.comfortable");

    const previewTitle = canvasElement.querySelector(".section-title h3");
    await expect(previewTitle?.textContent).toContain("Representative density");

    const densityRows = canvasElement.querySelectorAll(".density-row");
    await expect(densityRows.length).toBeGreaterThan(3);
  },
};

export const SpacingLab: Story = {
  render: () => renderSpacingLab(),
  play: async ({ canvasElement }) => {
    const inputs = canvasElement.querySelectorAll(".tool-input");
    await expect(inputs.length).toBeGreaterThan(0);

    const output = canvasElement.querySelector(
      "[data-output]",
    ) as HTMLTextAreaElement | null;
    await expect(output?.value).toContain("size.space.xs");

    const previewTitle = canvasElement.querySelector(".section-title h3");
    await expect(previewTitle?.textContent).toContain("Representative spacing");
  },
};

export const TypographyLab: Story = {
  render: () => renderTypographyLab(),
  play: async ({ canvasElement }) => {
    const inputs = canvasElement.querySelectorAll(".tool-input");
    await expect(inputs.length).toBeGreaterThan(0);

    const output = canvasElement.querySelector(
      "[data-output]",
    ) as HTMLTextAreaElement | null;
    await expect(output?.value).toContain("size.font.xs");
    await expect(output?.value).toContain("weight.semibold");

    const previewTitle = canvasElement.querySelector(".section-title h3");
    await expect(previewTitle?.textContent).toContain("Representative type");
  },
};

export const MotionLab: Story = {
  render: () => renderMotionLab(),
  play: async ({ canvasElement }) => {
    const inputs = canvasElement.querySelectorAll(".tool-input");
    await expect(inputs.length).toBeGreaterThan(0);

    const output = canvasElement.querySelector(
      "[data-output]",
    ) as HTMLTextAreaElement | null;
    await expect(output?.value).toContain("duration.fast");
    await expect(output?.value).toContain("easing.standard");

    const previewTitle = canvasElement.querySelector(".section-title h3");
    await expect(previewTitle?.textContent).toContain("Representative motion");

    const scrollShell = canvasElement.querySelector('[data-demo="scroll-shell"]');
    await expect(Boolean(scrollShell)).toBe(true);
  },
};

export const TextAndStructureLab: Story = {
  render: () => renderTextAndStructureLab(),
  play: async ({ canvasElement }) => {
    const inputs = canvasElement.querySelectorAll(".tool-input");
    await expect(inputs.length).toBeGreaterThan(0);

    const output = canvasElement.querySelector(
      "[data-output]",
    ) as HTMLTextAreaElement | null;
    await expect(output?.value).toContain("color.text.primary");
    await expect(output?.value).toContain("color.focus.ring");

    const previewTitle = canvasElement.querySelector(".section-title h3");
    await expect(previewTitle?.textContent).toContain("Representative text and structure");
  },
};

export const ActionAndStateLab: Story = {
  render: () => renderActionAndStateLab(),
  play: async ({ canvasElement }) => {
    const inputs = canvasElement.querySelectorAll(".tool-input");
    await expect(inputs.length).toBeGreaterThan(0);

    const output = canvasElement.querySelector(
      "[data-output]",
    ) as HTMLTextAreaElement | null;
    await expect(output?.value).toContain("color.action.primary.background");
    await expect(output?.value).toContain("color.state.danger.border");

    const previewTitle = canvasElement.querySelector(".section-title h3");
    await expect(previewTitle?.textContent).toContain("Representative actions and state");
  },
};

export const FormInputLab: Story = {
  render: () => renderFormInputLab(),
  play: async ({ canvasElement }) => {
    const inputs = canvasElement.querySelectorAll(".tool-input");
    await expect(inputs.length).toBeGreaterThan(0);

    const output = canvasElement.querySelector(
      "[data-output]",
    ) as HTMLTextAreaElement | null;
    await expect(output?.value).toContain("color.field.background");
    await expect(output?.value).toContain("color.field.border.invalid");

    const previewTitle = canvasElement.querySelector(".section-title h3");
    await expect(previewTitle?.textContent).toContain("Representative form and input");
  },
};

export const ElevationLab: Story = {
  render: () => renderElevationLab(),
  play: async ({ canvasElement }) => {
    const inputs = canvasElement.querySelectorAll(".tool-input");
    await expect(inputs.length).toBeGreaterThan(0);

    const output = canvasElement.querySelector(
      "[data-output]",
    ) as HTMLTextAreaElement | null;
    await expect(output?.value).toContain("shadow.control");
    await expect(output?.value).toContain("shadow.card");
    await expect(output?.value).toContain("shadow.floating");

    const previewTitle = canvasElement.querySelector(".section-title h3");
    await expect(previewTitle?.textContent).toContain("Representative elevation");
  },
};

export const SurfaceLab: Story = {
  render: () => renderSurfaceLab(),
  play: async ({ canvasElement }) => {
    const inputs = canvasElement.querySelectorAll(".tool-input");
    await expect(inputs.length).toBeGreaterThan(0);

    const output = canvasElement.querySelector(
      "[data-output]",
    ) as HTMLTextAreaElement | null;
    await expect(output?.value).toContain("color.surface.page");

    const previewTitle = canvasElement.querySelector(".section-title h3");
    await expect(previewTitle?.textContent).toContain("Representative surfaces");
  },
};

export const ReferenceKitLab: Story = {
  render: () => renderReferenceKitLab(),
  play: async ({ canvasElement }) => {
    const grid = canvasElement.querySelector("violet-data-grid");
    await expect(Boolean(grid)).toBe(true);

    const kitItems = canvasElement.querySelectorAll(".kit-item");
    await expect(kitItems.length).toBeGreaterThan(0);

    const previewTitle = canvasElement.querySelector(".section-title h3");
    await expect(previewTitle?.textContent).toContain("Reference kit in one surface");
  },
};
