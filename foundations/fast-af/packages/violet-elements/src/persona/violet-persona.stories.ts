import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect } from "storybook/test";

import "./violet-persona";
import type { VioletPersona } from "./violet-persona";

type VioletPersonaStoryArgs = {
    label: string;
    src: string;
    initials: string;
    decorative: boolean;
    size: "xs" | "sm" | "md" | "lg" | "xl";
};

function renderPersona(args: VioletPersonaStoryArgs): HTMLElement {
    const element = document.createElement("violet-persona") as VioletPersona;
    element.label = args.label;
    element.src = args.src;
    element.initials = args.initials;
    element.decorative = args.decorative;
    element.size = args.size;
    return element;
}

const meta = {
    title: "Components/Persona",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Reusable Violet persona primitive for circular profile imagery with initials fallback and decorative mode when the surrounding UI already names the person.",
            },
        },
    },
    argTypes: {
        decorative: { control: "boolean" },
        size: {
            control: "inline-radio",
            options: ["xs", "sm", "md", "lg", "xl"],
        },
    },
    render: (args: VioletPersonaStoryArgs) => renderPersona(args),
} satisfies Meta<VioletPersonaStoryArgs>;

export default meta;

type Story = StoryObj<VioletPersonaStoryArgs>;

export const Overview: Story = {
    args: {
        label: "Lydia Bauer",
        src: "",
        initials: "",
        decorative: false,
        size: "sm",
    },
    play: async ({ canvasElement }) => {
        const persona = canvasElement.querySelector("violet-persona") as VioletPersona | null;
        const root = persona?.shadowRoot?.querySelector(".root") as HTMLElement | null;

        if (!persona || !root) {
            throw new Error("Expected violet-persona to render.");
        }

        await expect(root.getAttribute("role")).toBe("img");
        await expect(root.getAttribute("aria-label")).toBe("Lydia Bauer");
        await expect(root.textContent?.trim()).toBe("LB");
    },
};

export const Image: Story = {
    args: {
        label: "Katri Athokas",
        src: "https://fabricweb.azureedge.net/fabric-website/assets/images/avatar/KatriAthokas.jpg",
        initials: "",
        decorative: false,
        size: "md",
    },
};

export const Decorative: Story = {
    args: {
        label: "Decorative profile image",
        src: "",
        initials: "D",
        decorative: true,
        size: "sm",
    },
    play: async ({ canvasElement }) => {
        const persona = canvasElement.querySelector("violet-persona") as VioletPersona | null;
        const root = persona?.shadowRoot?.querySelector(".root") as HTMLElement | null;

        if (!persona || !root) {
            throw new Error("Expected decorative violet-persona to render.");
        }

        await expect(root.getAttribute("role")).toBe("presentation");
        await expect(root.getAttribute("aria-hidden")).toBe("true");
    },
};

export const Sizes: Story = {
    args: {
        label: "Persona sizes",
        src: "",
        initials: "",
        decorative: false,
        size: "sm",
    },
    render: () => {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "12px";
        row.style.flexWrap = "wrap";

        for (const size of ["xs", "sm", "md", "lg", "xl"] as const) {
            row.append(renderPersona({ label: "Lydia Bauer", src: "", initials: "", decorative: false, size }));
        }

        return row;
    },
};
