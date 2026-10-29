import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, waitFor } from "storybook/test";

import "../tree-item/violet-tree-item";
import "./violet-tree";
import type { VioletTree } from "./violet-tree";

type VioletTreeStoryArgs = {
    appearance: "plain" | "framed";
    label: string;
    supportingText: string;
    errorText: string;
    value: string;
};

function renderTree(args: VioletTreeStoryArgs): string {
    return `
        <div style="max-inline-size: 32rem;">
            <violet-tree
                appearance="${args.appearance}"
                label="${args.label}"
                supporting-text="${args.supportingText}"
                error-text="${args.errorText}"
                value="${args.value}"
            >
                <violet-tree-item value="operations" expanded>
                    Operations
                    <violet-tree-item value="propagation" selected>Propagation</violet-tree-item>
                    <violet-tree-item value="irrigation">Irrigation</violet-tree-item>
                    <violet-tree-item value="harvest" expanded>
                        Harvest
                        <violet-tree-item value="packing">Packing</violet-tree-item>
                        <violet-tree-item value="shipping">Shipping</violet-tree-item>
                    </violet-tree-item>
                </violet-tree-item>
                <violet-tree-item value="inventory">Inventory</violet-tree-item>
                <violet-tree-item value="reports">Reports</violet-tree-item>
            </violet-tree>
        </div>
    `;
}

const meta = {
    title: "Components/Tree",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Single-selection Violet treeview with nested `violet-tree-item` children, roving focus, typeahead, and APG-style keyboard support.",
            },
        },
    },
    argTypes: {
        appearance: {
            control: "inline-radio",
            options: ["plain", "framed"],
        },
        value: {
            control: "text",
        },
        supportingText: {
            control: "text",
            name: "supporting-text",
        },
        errorText: {
            control: "text",
            name: "error-text",
        },
    },
    render: (args: VioletTreeStoryArgs) => renderTree(args),
} satisfies Meta<VioletTreeStoryArgs>;

export default meta;

type Story = StoryObj<VioletTreeStoryArgs>;

export const Overview: Story = {
    args: {
        label: "Operations tree",
        appearance: "plain",
        supportingText: "Use arrow keys to move, expand, and collapse branches.",
        errorText: "",
        value: "propagation",
    },
    play: async ({ canvasElement }) => {
        const tree = canvasElement.querySelector("violet-tree") as VioletTree | null;
        const items = Array.from(canvasElement.querySelectorAll("violet-tree-item")) as HTMLElement[];

        if (!tree || items.length < 3) {
            throw new Error("Expected violet-tree to render nested tree items.");
        }

        items[0]?.focus();
        items[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true }));

        await waitFor(() => {
            expect(items[1]?.getAttribute("tabindex")).toBe("0");
        });
    },
};

export const KeyboardSelection: Story = {
    args: {
        label: "Keyboard tree",
        appearance: "plain",
        supportingText: "Enter or Space selects the focused item.",
        errorText: "",
        value: "propagation",
    },
    play: async ({ canvasElement }) => {
        const tree = canvasElement.querySelector("violet-tree") as VioletTree | null;
        const items = Array.from(canvasElement.querySelectorAll("violet-tree-item")) as HTMLElement[];

        if (!tree || items.length < 2) {
            throw new Error("Expected violet-tree to render.");
        }

        items[0]?.focus();
        items[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true }));
        items[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true }));
        items[2]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));

        await waitFor(() => {
            expect(tree.value).toBe("irrigation");
        });
    },
};

export const CollapsedBranch: Story = {
    render: () => `
        <div style="max-inline-size: 32rem;">
            <violet-tree label="Compact tree" supporting-text="Right expands, left collapses.">
                <violet-tree-item value="workspace">
                    Workspace
                    <violet-tree-item value="blocks">Blocks</violet-tree-item>
                    <violet-tree-item value="zones">Zones</violet-tree-item>
                </violet-tree-item>
                <violet-tree-item value="analytics">Analytics</violet-tree-item>
            </violet-tree>
        </div>
    `,
    play: async ({ canvasElement }) => {
        const root = canvasElement.querySelector("violet-tree-item") as HTMLElement | null;

        if (!root) {
            throw new Error("Expected root tree item to render.");
        }

        root.focus();
        root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true }));

        await waitFor(() => {
            expect(root.getAttribute("aria-expanded")).toBe("true");
        });
    },
};

export const Framed: Story = {
    args: {
        label: "Contained tree",
        appearance: "framed",
        supportingText: "Optional contained surface when the tree needs its own boundary.",
        errorText: "",
        value: "propagation",
    },
};
