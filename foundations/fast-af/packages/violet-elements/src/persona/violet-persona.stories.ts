import { expect } from "@lushly-dev/specimen/test";
import type { Meta, StoryObj } from "@lushly-dev/specimen/types";

import "./violet-persona.define";
import type { VioletPersona } from "./violet-persona";

// An inline SVG portrait, so the story loads no remote image: Specimen's pages reach only the bench's origin.
const AVATAR_IMAGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" fill="#badecf"/><circle cx="48" cy="38" r="18" fill="#2c5e4b"/><path d="M14 96c4-22 18-32 34-32s30 10 34 32z" fill="#2c5e4b"/></svg>',
)}`;

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
  component: "violet-persona",
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
    // The initials are shown through CSS, from this attribute.
    await expect(root.querySelector(".fallback")?.getAttribute("data-initials")).toBe("LB");
  },
};

export const Image: Story = {
  args: {
    label: "Katri Athokas",
    src: AVATAR_IMAGE,
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
      row.append(
        renderPersona({ label: "Lydia Bauer", src: "", initials: "", decorative: false, size }),
      );
    }

    return row;
  },
};
