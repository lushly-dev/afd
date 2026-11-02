import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, waitFor } from "storybook/test";

import "../button/violet-button";
import "./violet-theme";
import type { VioletThemePreset } from "./generated/violet-theme.generated";

type ScopedThemeArgs = {
    preset: VioletThemePreset;
    accentBackground: string;
    accentText: string;
};

type VioletThemeElement = HTMLElement;

type VioletButtonElement = HTMLElement & {
    shadowRoot: ShadowRoot;
};

function renderScopedTheme(args: ScopedThemeArgs): HTMLElement {
    const scope = document.createElement("violet-theme") as VioletThemeElement;
    scope.setAttribute("preset", args.preset);
    scope.style.setProperty("--color-action-primary-background", args.accentBackground);
    scope.style.setProperty("--color-action-primary-hover", args.accentBackground);
    scope.style.setProperty("--color-action-primary-pressed", args.accentBackground);
    scope.style.setProperty("--color-action-primary-text", args.accentText);

    const card = document.createElement("div");
    card.style.display = "grid";
    card.style.gap = "0.75rem";
    card.style.padding = "1rem";
    card.style.border = "1px solid var(--color-border-subtle)";
    card.style.borderRadius = "var(--radius-md)";
    card.style.background = "var(--color-surface-card)";
    card.style.color = "var(--color-text-primary)";

    const heading = document.createElement("strong");
    heading.textContent = args.preset === "dark" ? "Dark scoped theme" : "Light scoped theme";
    card.append(heading);

    const button = document.createElement("violet-button");
    button.setAttribute("appearance", "primary");
    button.textContent = "Scoped action";
    card.append(button);

    const secondary = document.createElement("violet-button");
    secondary.setAttribute("appearance", "secondary");
    secondary.textContent = "Secondary action";
    card.append(secondary);

    scope.append(card);

    return scope;
}

const meta: Meta<ScopedThemeArgs> = {
    title: "Foundations/Theme",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Optional Violet theme host for subtree-scoped token overrides. Normal usage should still install the shared runtime theme once at the shell.",
            },
        },
    },
    argTypes: {
        preset: {
            control: "inline-radio",
            options: ["light", "dark", "high-contrast"],
        },
        accentBackground: { control: "color" },
        accentText: { control: "color" },
    },
    render: args => renderScopedTheme(args),
};

export default meta;

type Story = StoryObj<ScopedThemeArgs>;

export const Overview: Story = {
    args: {
        preset: "light",
        accentBackground: "#0c5a4d",
        accentText: "#ffffff",
    },
    play: async ({ canvasElement, args }) => {
        const scope = canvasElement.querySelector("violet-theme") as VioletThemeElement | null;
        const button = canvasElement.querySelector("violet-button") as VioletButtonElement | null;

        await waitFor(() => {
            expect(scope?.hasAttribute("data-violet-theme-root")).toBe(true);
            expect(scope?.getAttribute("data-violet-theme")).toBe(args.preset);
            expect(button?.shadowRoot?.querySelector(".control")).toBeTruthy();
        });

        const control = button?.shadowRoot?.querySelector(".control") as HTMLButtonElement | null;
        const computed = control ? getComputedStyle(control) : null;

        await expect(computed?.backgroundColor ?? "").toBe("rgb(12, 90, 77)");
        await expect(computed?.color ?? "").toBe("rgb(255, 255, 255)");
        await expect(scope?.style.getPropertyValue("--color-action-primary-background") ?? "").toBe(args.accentBackground);
    },
};

export const DarkScopedPreset: Story = {
    args: {
        preset: "dark",
        accentBackground: "#0c5a4d",
        accentText: "#ffffff",
    },
};
