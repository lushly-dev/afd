import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "../button/violet-button";
import type { VioletButton } from "../button/violet-button";
import "../file-upload/violet-file-upload";
import type { VioletFileUpload } from "../file-upload/violet-file-upload";
import "./violet-file-explorer";
import type {
    VioletFileExplorer,
    VioletFileExplorerFolderRequestDetail,
    VioletFileExplorerSelectionMode,
    VioletFileExplorerItem,
    VioletFileExplorerSelectionChangeDetail,
} from "./violet-file-explorer";

interface FileExplorerStoryArgs {
    label: string;
    rootLabel: string;
    selectionMode: VioletFileExplorerSelectionMode;
    currentFolderId: string;
    busy: boolean;
    loadError: string;
    width: string;
    height: string;
    items: VioletFileExplorerItem[];
}

const projectItems: VioletFileExplorerItem[] = [
    { id: "docs", name: "Documents", kind: "folder", meta: "3 items" },
    { id: "pictures", name: "Pictures", kind: "folder", meta: "1 item" },
    { id: "readme", name: "README.md", kind: "file", meta: "2 KB" },
    { id: "package", name: "package.json", kind: "file", meta: "1 KB" },
    { id: "locked", name: "secrets.env", kind: "file", meta: "Restricted", disabled: true },
    { id: "specs", name: "Specs", kind: "folder", parentId: "docs", meta: "1 item" },
    { id: "plan", name: "launch-plan.docx", kind: "file", parentId: "docs", meta: "84 KB" },
    { id: "budget", name: "budget.xlsx", kind: "file", parentId: "docs", meta: "212 KB" },
    { id: "api-spec", name: "api-spec.md", kind: "file", parentId: "specs", meta: "12 KB" },
    { id: "cover", name: "cover.png", kind: "file", parentId: "pictures", meta: "1.4 MB" },
];

function getExplorer(canvasElement: HTMLElement): VioletFileExplorer {
    const explorer = canvasElement.querySelector("violet-file-explorer") as VioletFileExplorer | null;
    if (!explorer) {
        throw new Error("Expected violet-file-explorer to render.");
    }
    return explorer;
}

function rows(explorer: VioletFileExplorer): HTMLElement[] {
    return Array.from(explorer.shadowRoot?.querySelectorAll<HTMLElement>(".row") ?? []);
}

function row(explorer: VioletFileExplorer, id: string): HTMLElement {
    const match = rows(explorer).find(candidate => candidate.dataset.itemId === id);
    if (!match) {
        throw new Error(`Expected a row for ${id}.`);
    }
    return match;
}

function createFrame(args: FileExplorerStoryArgs): { frame: HTMLElement; explorer: VioletFileExplorer } {
    const frame = document.createElement("div");
    frame.style.cssText = `inline-size:${args.width};max-inline-size:100%;`;
    const explorer = document.createElement("violet-file-explorer") as VioletFileExplorer;
    explorer.style.setProperty("--violet-file-explorer-block-size", args.height);
    explorer.label = args.label;
    explorer.rootLabel = args.rootLabel;
    explorer.selectionMode = args.selectionMode;
    explorer.currentFolderId = args.currentFolderId;
    explorer.busy = args.busy;
    explorer.loadError = args.loadError;
    explorer.items = args.items;
    frame.append(explorer);
    return { frame, explorer };
}

function renderExplorer(args: FileExplorerStoryArgs): HTMLElement {
    const { frame } = createFrame(args);
    return frame;
}

const meta = {
    title: "Components/File Explorer",
    component: "violet-file-explorer",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Host-driven file browser composed from `violet-tree` (folders), `violet-breadcrumb` (path) and a selectable listing. Selection and activation are separate; the host supplies a flat `items` array and owns every business operation. Folders with `loaded: false` are expandable and trigger `folder-request` so the host can load their contents asynchronously.",
            },
        },
    },
    args: {
        label: "Project files",
        rootLabel: "Project",
        selectionMode: "single",
        currentFolderId: "",
        busy: false,
        loadError: "",
        width: "52rem",
        height: "22rem",
        items: projectItems,
    },
    argTypes: {
        selectionMode: { control: "inline-radio", options: ["none", "single", "multiple"], name: "selection-mode" },
        currentFolderId: { control: "text", name: "current-folder-id" },
        rootLabel: { control: "text", name: "root-label" },
        loadError: { control: "text", name: "load-error" },
        items: { control: "object" },
    },
    render: renderExplorer,
} satisfies Meta<FileExplorerStoryArgs>;

export default meta;

type Story = StoryObj<FileExplorerStoryArgs>;

/** Baseline: folder navigation plus selection, with separate activation. */
export const Overview: Story = {
    play: async ({ canvasElement }) => {
        const explorer = getExplorer(canvasElement);
        const selections: string[][] = [];
        explorer.addEventListener("selection-change", event => {
            selections.push((event as CustomEvent<VioletFileExplorerSelectionChangeDetail>).detail.selectedIds);
        });

        await waitFor(() => expect(rows(explorer)).toHaveLength(5));

        // Selection does not navigate or activate.
        await userEvent.click(row(explorer, "readme"));
        await waitFor(() => expect(row(explorer, "readme").getAttribute("aria-selected")).toBe("true"));
        expect(selections.at(-1)).toEqual(["readme"]);
        expect(explorer.currentFolderId).toBe("");

        // Keyboard: arrows move focus, Enter activates a folder and navigates into it.
        row(explorer, "readme").focus();
        await userEvent.keyboard("{Home}");
        await waitFor(() => expect(explorer.shadowRoot?.activeElement).toBe(row(explorer, "docs")));
        await userEvent.keyboard("{Enter}");

        await waitFor(() => {
            expect(explorer.currentFolderId).toBe("docs");
            expect(rows(explorer).map(item => item.dataset.itemId)).toEqual(["specs", "plan", "budget"]);
            expect(explorer.shadowRoot?.activeElement).toBe(row(explorer, "specs"));
        });
        expect(selections.at(-1)).toEqual([]);
        // The breadcrumb trail renders after navigation settles.
        await waitFor(() =>
            expect(explorer.shadowRoot?.querySelector("violet-breadcrumb-item[current]")?.textContent?.trim()).toBe(
                "Documents",
            ),
        );

        // Backspace goes up and returns focus to the folder we left.
        await userEvent.keyboard("{Backspace}");
        await waitFor(() => {
            expect(explorer.currentFolderId).toBe("");
            expect(explorer.shadowRoot?.activeElement).toBe(row(explorer, "docs"));
        });
    },
};

export const MultipleSelection: Story = {
    args: { selectionMode: "multiple" },
    play: async ({ canvasElement }) => {
        const explorer = getExplorer(canvasElement);
        await waitFor(() => expect(rows(explorer)).toHaveLength(5));

        row(explorer, "docs").focus();
        await userEvent.keyboard(" ");
        await userEvent.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}");

        await waitFor(() => expect(explorer.selectedIds).toEqual(["docs", "pictures", "readme"]));
        await waitFor(() => expect(row(explorer, "readme").getAttribute("aria-selected")).toBe("true"));
        expect(explorer.shadowRoot?.querySelector('[role="listbox"]')?.getAttribute("aria-multiselectable")).toBe(
            "true",
        );
    },
};

export const ActivationOnly: Story = {
    args: { selectionMode: "none" },
    play: async ({ canvasElement }) => {
        const explorer = getExplorer(canvasElement);
        const activated: string[] = [];
        explorer.addEventListener("item-activate", event => {
            activated.push((event as CustomEvent<{ id: string }>).detail.id);
        });
        await waitFor(() => expect(rows(explorer)).toHaveLength(5));

        await userEvent.click(row(explorer, "readme"));

        expect(activated).toEqual(["readme"]);
        expect(explorer.selectedIds).toEqual([]);
        expect(row(explorer, "readme").hasAttribute("aria-selected")).toBe(false);
    },
};

function lazyItems(): VioletFileExplorerItem[] {
    return [
        { id: "src", name: "src", kind: "folder", loaded: false },
        { id: "docs", name: "docs", kind: "folder", loaded: false },
        { id: "license", name: "LICENSE", kind: "file", meta: "1 KB" },
    ];
}

export const AsyncLoading: Story = {
    args: { items: lazyItems() },
    render: args => {
        const { frame, explorer } = createFrame(args);
        const contents: Record<string, VioletFileExplorerItem[]> = {
            src: [
                { id: "index", name: "index.ts", kind: "file", parentId: "src", meta: "3 KB" },
                { id: "lib", name: "lib", kind: "folder", parentId: "src", loaded: false },
            ],
            lib: [{ id: "util", name: "util.ts", kind: "file", parentId: "lib", meta: "900 B" }],
            docs: [],
        };

        explorer.addEventListener("folder-request", event => {
            const { folderId } = (event as CustomEvent<VioletFileExplorerFolderRequestDetail>).detail;
            if (!folderId) {
                return;
            }
            window.setTimeout(() => {
                explorer.items = [
                    ...explorer.items.map(item => (item.id === folderId ? { ...item, loaded: true } : item)),
                    ...(contents[folderId] ?? []),
                ];
            }, 250);
        });
        return frame;
    },
    play: async ({ canvasElement }) => {
        const explorer = getExplorer(canvasElement);
        const src = () => explorer.shadowRoot?.querySelector('violet-tree-item[value="src"]') as HTMLElement;
        await waitFor(() => expect(src().getAttribute("aria-expanded")).toBe("false"));

        row(explorer, "src").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

        await waitFor(() => expect(explorer.shadowRoot?.querySelector('[part~="loading-state"]')).not.toBeNull());
        expect(explorer.shadowRoot?.querySelector(".content")?.getAttribute("aria-busy")).toBe("true");

        await waitFor(() => {
            expect(explorer.shadowRoot?.querySelector('[part~="loading-state"]')).toBeNull();
            expect(rows(explorer).map(item => item.dataset.itemId)).toEqual(["index", "lib"]);
        });
        const lib = explorer.shadowRoot?.querySelector('violet-tree-item[value="lib"]');
        expect(lib?.getAttribute("aria-level")).toBe("3");
        expect(explorer.shadowRoot?.activeElement).toBe(row(explorer, "index"));
    },
};

export const EmptyFolder: Story = {
    args: {
        items: [{ id: "empty", name: "Empty folder", kind: "folder" }],
        currentFolderId: "empty",
    },
    play: async ({ canvasElement }) => {
        const explorer = getExplorer(canvasElement);
        await waitFor(() => expect(explorer.shadowRoot?.querySelector('[part~="empty-state"]')).not.toBeNull());
        expect(explorer.shadowRoot?.querySelector('[role="listbox"]')).toBeNull();
    },
};

export const LoadError: Story = {
    args: { loadError: "Could not load this folder. Check your connection and try again." },
    render: args => {
        const { frame, explorer } = createFrame(args);
        explorer.addEventListener("folder-request", () => {
            explorer.loadError = "";
        });
        return frame;
    },
    play: async ({ canvasElement }) => {
        const explorer = getExplorer(canvasElement);
        await waitFor(() => expect(explorer.shadowRoot?.querySelector('[role="alert"]')).not.toBeNull());
        const retry = explorer.shadowRoot?.querySelector("violet-button") as VioletButton;
        await userEvent.click(retry);
        await waitFor(() => {
            expect(explorer.shadowRoot?.querySelector('[role="alert"]')).toBeNull();
            expect(rows(explorer)).toHaveLength(5);
        });
    },
};

export const Busy: Story = {
    args: { busy: true },
    play: async ({ canvasElement }) => {
        const explorer = getExplorer(canvasElement);
        await waitFor(() => expect(explorer.shadowRoot?.querySelector('[part~="loading-state"]')).not.toBeNull());
        // Existing rows stay visible while the host refreshes.
        expect(rows(explorer).length).toBeGreaterThan(0);
    },
};

export const HostActions: Story = {
    args: { selectionMode: "multiple" },
    render: args => {
        const { frame, explorer } = createFrame(args);

        const remove = document.createElement("violet-button") as VioletButton;
        remove.slot = "actions";
        remove.appearance = "secondary";
        remove.disabled = true;
        remove.textContent = "Delete";
        explorer.append(remove);

        const upload = document.createElement("violet-file-upload") as VioletFileUpload;
        upload.slot = "footer";
        upload.label = "Upload files";
        upload.appearance = "button";
        upload.multiple = true;
        explorer.append(upload);

        // Business operations belong to the host: it validates, performs them, then supplies new items.
        explorer.addEventListener("selection-change", () => {
            remove.disabled = explorer.selectedIds.length === 0;
        });
        remove.addEventListener("click", () => {
            const doomed = new Set(explorer.selectedIds);
            explorer.items = explorer.items.filter(item => !doomed.has(item.id));
            explorer.selectedIds = [];
            remove.disabled = true;
        });
        upload.addEventListener("change", event => {
            const { files } = (event as CustomEvent<{ files: File[] }>).detail;
            explorer.items = [
                ...explorer.items,
                ...files.map(file => ({
                    id: `upload-${file.name}-${file.size}`,
                    name: file.name,
                    kind: "file" as const,
                    parentId: explorer.currentFolderId || null,
                    meta: `${Math.max(1, Math.round(file.size / 1024))} KB`,
                })),
            ];
        });
        return frame;
    },
    play: async ({ canvasElement }) => {
        const explorer = getExplorer(canvasElement);
        const remove = canvasElement.querySelector('violet-button[slot="actions"]') as VioletButton;
        await waitFor(() => expect(rows(explorer)).toHaveLength(5));
        expect(remove.disabled).toBe(true);

        await userEvent.click(row(explorer, "readme"));
        await waitFor(() => expect(remove.disabled).toBe(false));

        await userEvent.click(remove);

        await waitFor(() => {
            expect(rows(explorer).map(item => item.dataset.itemId)).not.toContain("readme");
            expect(remove.disabled).toBe(true);
        });
    },
};

export const NarrowContainer: Story = {
    args: { width: "22rem", height: "26rem", currentFolderId: "docs" },
    play: async ({ canvasElement }) => {
        const explorer = getExplorer(canvasElement);
        await waitFor(() => expect(rows(explorer)).toHaveLength(3));
        const body = explorer.shadowRoot?.querySelector(".body") as HTMLElement;
        expect(getComputedStyle(body).gridTemplateColumns.split(" ")).toHaveLength(1);
    },
};
