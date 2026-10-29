import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent } from "storybook/test";

import "./violet-pagination";
import type { VioletPagination } from "./violet-pagination";

type VioletPaginationStoryArgs = {
    label: string;
    page: number;
    pageCount: number;
    siblingCount: number;
    boundaryCount: number;
    disabled: boolean;
};

function renderPagination(args: VioletPaginationStoryArgs): VioletPagination {
    const pagination = document.createElement("violet-pagination") as VioletPagination;
    pagination.label = args.label;
    pagination.page = args.page;
    pagination.pageCount = args.pageCount;
    pagination.siblingCount = args.siblingCount;
    pagination.boundaryCount = args.boundaryCount;
    pagination.disabled = args.disabled;
    return pagination;
}

const meta = {
    title: "Components/Pagination",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component: "Router-agnostic pagination navigation with current-page semantics and collapsed ranges.",
            },
        },
    },
    argTypes: {
        label: { control: "text" },
        page: { control: { type: "number", min: 1 } },
        pageCount: { control: { type: "number", min: 1 } },
        siblingCount: { control: { type: "number", min: 0 } },
        boundaryCount: { control: { type: "number", min: 0 } },
        disabled: { control: "boolean" },
    },
    render: (args: VioletPaginationStoryArgs) => renderPagination(args),
} satisfies Meta<VioletPaginationStoryArgs>;

export default meta;

type Story = StoryObj<VioletPaginationStoryArgs>;

export const Overview: Story = {
    args: {
        label: "Crop pages",
        page: 4,
        pageCount: 9,
        siblingCount: 1,
        boundaryCount: 1,
        disabled: false,
    },
    play: async ({ canvasElement }) => {
        const pagination = canvasElement.querySelector("violet-pagination") as VioletPagination | null;
        if (!pagination) {
            throw new Error("Expected pagination to render.");
        }

        const button = pagination.shadowRoot?.querySelector('[aria-label="Go to page 5"]') as HTMLButtonElement | null;
        if (!button) {
            throw new Error("Expected the page 5 button to render.");
        }
        await userEvent.click(button);

        const current = pagination.shadowRoot?.querySelector("[aria-current='page']");
        await expect(pagination.page).toBe(5);
        await expect(current?.textContent?.trim()).toBe("5");
    },
};

export const CompactWindow: Story = {
    args: {
        label: "Orders pages",
        page: 12,
        pageCount: 24,
        siblingCount: 0,
        boundaryCount: 1,
        disabled: false,
    },
};

export const Disabled: Story = {
    args: {
        label: "Archive pages",
        page: 2,
        pageCount: 5,
        siblingCount: 1,
        boundaryCount: 1,
        disabled: true,
    },
};
