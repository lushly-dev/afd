import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-file-explorer";
import type {
    VioletFileExplorer,
    VioletFileExplorerItem,
} from "./violet-file-explorer";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function settle(): Promise<void> {
    await nextFrame();
    await nextFrame();
    await nextFrame();
}

const sampleItems = (): VioletFileExplorerItem[] => [
    { id: "docs", name: "Documents", kind: "folder" },
    { id: "pics", name: "Pictures", kind: "folder" },
    { id: "readme", name: "README.md", kind: "file", meta: "2 KB" },
    { id: "notes", name: "notes.txt", kind: "file" },
    { id: "specs", name: "Specs", kind: "folder", parentId: "docs" },
    { id: "plan", name: "plan.docx", kind: "file", parentId: "docs" },
    { id: "deep", name: "deep.txt", kind: "file", parentId: "specs" },
];

async function mount(
    items: VioletFileExplorerItem[] = sampleItems(),
    configure?: (explorer: VioletFileExplorer) => void,
): Promise<VioletFileExplorer> {
    document.body.innerHTML = "";
    const explorer = document.createElement("violet-file-explorer") as VioletFileExplorer;
    explorer.label = "Project files";
    explorer.items = items;
    configure?.(explorer);
    document.body.append(explorer);
    await customElements.whenDefined("violet-file-explorer");
    await settle();
    return explorer;
}

function rowElements(explorer: VioletFileExplorer): HTMLElement[] {
    return Array.from(explorer.shadowRoot?.querySelectorAll<HTMLElement>(".row") ?? []);
}

function rowNames(explorer: VioletFileExplorer): string[] {
    return rowElements(explorer).map(row => row.querySelector(".name")?.textContent?.trim() ?? "");
}

function row(explorer: VioletFileExplorer, id: string): HTMLElement {
    const element = rowElements(explorer).find(candidate => candidate.dataset.itemId === id);
    if (!element) {
        throw new Error(`No row for ${id}`);
    }
    return element;
}

function crumbNames(explorer: VioletFileExplorer): string[] {
    return Array.from(explorer.shadowRoot?.querySelectorAll("violet-breadcrumb-item") ?? []).map(
        item => item.textContent?.trim() ?? "",
    );
}

function track<T>(explorer: VioletFileExplorer, name: string): T[] {
    const details: T[] = [];
    explorer.addEventListener(name, event => {
        details.push((event as CustomEvent<T>).detail);
    });
    return details;
}

function treeItem(explorer: VioletFileExplorer, value: string): HTMLElement {
    const items = Array.from(explorer.shadowRoot?.querySelectorAll<HTMLElement>("violet-tree-item") ?? []);
    const match = items.find(item => item.getAttribute("value") === value);
    if (!match) {
        throw new Error(`No tree item for ${value}`);
    }
    return match;
}

function focusedId(explorer: VioletFileExplorer): string | undefined {
    return (explorer.shadowRoot?.activeElement as HTMLElement | null)?.dataset.itemId;
}

describe("violet-file-explorer", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("lists the top-level items with names, metadata and accessible roles", async () => {
        const explorer = await mount();

        expect(rowNames(explorer)).toEqual(["Documents", "Pictures", "README.md", "notes.txt"]);
        expect(explorer.shadowRoot?.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("Project files");

        const list = explorer.shadowRoot?.querySelector('[role="listbox"]');
        expect(list?.getAttribute("aria-label")).toBe("Contents of Files");
        expect(rowElements(explorer).every(element => element.getAttribute("role") === "option")).toBe(true);
        expect(row(explorer, "docs").getAttribute("aria-label")).toBe("Documents, folder");
        expect(row(explorer, "readme").getAttribute("aria-label")).toBe("README.md, 2 KB");
        expect(crumbNames(explorer)).toEqual(["Files"]);
    });

    it("composes violet-tree for folder navigation with treeitem semantics", async () => {
        const explorer = await mount();

        const tree = explorer.shadowRoot?.querySelector("violet-tree");
        expect(tree?.shadowRoot?.querySelector('[role="tree"]')).not.toBeNull();

        const root = treeItem(explorer, "__violet-file-explorer-root__");
        const docs = treeItem(explorer, "docs");
        expect(root.getAttribute("role")).toBe("treeitem");
        expect(root.getAttribute("aria-level")).toBe("1");
        expect(docs.getAttribute("aria-level")).toBe("2");
        expect(docs.getAttribute("aria-expanded")).toBe("false");
        expect(treeItem(explorer, "pics").hasAttribute("aria-expanded")).toBe(false);
        // The current folder (the root here) is the tree selection from the first render.
        expect(root.getAttribute("aria-selected")).toBe("true");
        // Only folders appear in the tree.
        expect(explorer.shadowRoot?.querySelectorAll("violet-tree-item").length).toBe(4);
    });

    it("selects with click and keeps selection separate from activation", async () => {
        const explorer = await mount();
        const selections = track<{ selectedIds: string[] }>(explorer, "selection-change");
        const activations = track<{ id: string }>(explorer, "item-activate");

        row(explorer, "readme").click();
        await settle();

        expect(selections.at(-1)?.selectedIds).toEqual(["readme"]);
        expect(explorer.selectedIds).toEqual(["readme"]);
        expect(row(explorer, "readme").getAttribute("aria-selected")).toBe("true");
        expect(activations).toHaveLength(0);

        row(explorer, "notes").click();
        await settle();
        expect(explorer.selectedIds).toEqual(["notes"]);
        expect(row(explorer, "readme").getAttribute("aria-selected")).toBe("false");
    });

    it("activates files with Enter without changing the folder or selection", async () => {
        const explorer = await mount();
        const activations = track<{ id: string; kind: string }>(explorer, "item-activate");
        const folderChanges = track<unknown>(explorer, "folder-change");

        row(explorer, "readme").focus();
        await userEvent.keyboard("{Enter}");
        await settle();

        expect(activations).toEqual([expect.objectContaining({ id: "readme", kind: "file" })]);
        expect(folderChanges).toHaveLength(0);
        expect(explorer.selectedIds).toEqual([]);
    });

    it("navigates into a folder on activation, updates the path and tree, and focuses the first row", async () => {
        const explorer = await mount();
        const changes = track<{ folderId: string | null; path: string[] }>(explorer, "folder-change");

        row(explorer, "docs").focus();
        await userEvent.keyboard("{Enter}");
        await settle();

        expect(changes).toEqual([{ folderId: "docs", path: ["docs"] }]);
        expect(explorer.currentFolderId).toBe("docs");
        expect(rowNames(explorer)).toEqual(["Specs", "plan.docx"]);
        expect(crumbNames(explorer)).toEqual(["Files", "Documents"]);
        expect(treeItem(explorer, "docs").getAttribute("aria-selected")).toBe("true");
        expect(focusedId(explorer)).toBe("specs");
    });

    it("lets the host cancel folder navigation by preventing item-activate", async () => {
        const explorer = await mount();
        explorer.addEventListener("item-activate", event => event.preventDefault());

        row(explorer, "docs").focus();
        await userEvent.keyboard("{Enter}");
        await settle();

        expect(explorer.currentFolderId).toBe("");
        expect(rowNames(explorer)).toContain("Pictures");
    });

    it("navigates via breadcrumb and Backspace, restoring focus to the folder we left", async () => {
        const explorer = await mount(sampleItems(), element => {
            element.currentFolderId = "specs";
        });

        expect(crumbNames(explorer)).toEqual(["Files", "Documents", "Specs"]);
        expect(rowNames(explorer)).toEqual(["deep.txt"]);

        row(explorer, "deep").focus();
        await userEvent.keyboard("{Backspace}");
        await settle();

        expect(explorer.currentFolderId).toBe("docs");
        expect(focusedId(explorer)).toBe("specs");

        const rootCrumb = explorer.shadowRoot?.querySelector<HTMLElement>('violet-breadcrumb-item[data-folder-id=""]');
        rootCrumb?.click();
        await settle();
        expect(explorer.currentFolderId).toBe("");
        expect(rowNames(explorer)).toEqual(["Documents", "Pictures", "README.md", "notes.txt"]);
    });

    it("navigates when a folder is chosen in the tree", async () => {
        const explorer = await mount();
        const changes = track<{ folderId: string | null }>(explorer, "folder-change");

        treeItem(explorer, "pics").shadowRoot?.querySelector<HTMLElement>(".row")?.click();
        await settle();

        expect(changes.at(-1)?.folderId).toBe("pics");
        expect(crumbNames(explorer)).toEqual(["Files", "Pictures"]);
        expect(rowNames(explorer)).toEqual([]);
    });

    it("moves focus with arrows, Home and End using a roving tab stop", async () => {
        const explorer = await mount();

        row(explorer, "docs").focus();
        await userEvent.keyboard("{ArrowDown}");
        expect(focusedId(explorer)).toBe("pics");
        await userEvent.keyboard("{End}");
        expect(focusedId(explorer)).toBe("notes");
        await userEvent.keyboard("{ArrowDown}");
        expect(focusedId(explorer)).toBe("notes");
        await userEvent.keyboard("{Home}");
        expect(focusedId(explorer)).toBe("docs");
        await settle();

        const tabStops = rowElements(explorer).filter(element => element.tabIndex === 0);
        expect(tabStops.map(element => element.dataset.itemId)).toEqual(["docs"]);
    });

    it("toggles selection with Space and supports ranges and select-all in multiple mode", async () => {
        const explorer = await mount(sampleItems(), element => {
            element.selectionMode = "multiple";
        });
        const selections = track<{ selectedIds: string[] }>(explorer, "selection-change");

        expect(explorer.shadowRoot?.querySelector('[role="listbox"]')?.getAttribute("aria-multiselectable")).toBe("true");

        row(explorer, "docs").focus();
        await userEvent.keyboard(" ");
        await userEvent.keyboard("{ArrowDown}{ArrowDown}");
        await userEvent.keyboard(" ");
        expect(explorer.selectedIds).toEqual(["docs", "readme"]);

        await userEvent.keyboard(" ");
        expect(explorer.selectedIds).toEqual(["docs"]);

        await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
        expect(explorer.selectedIds).toEqual(["readme", "notes"]);
        expect(selections.length).toBeGreaterThan(2);

        await userEvent.keyboard("{Escape}");
        expect(explorer.selectedIds).toEqual([]);
    });

    it("selects a shift-click range and toggles with ctrl-click in multiple mode", async () => {
        const explorer = await mount(sampleItems(), element => {
            element.selectionMode = "multiple";
        });

        row(explorer, "docs").click();
        row(explorer, "readme").dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
        await settle();
        expect(explorer.selectedIds).toEqual(["docs", "pics", "readme"]);

        row(explorer, "pics").dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
        await settle();
        expect(explorer.selectedIds).toEqual(["docs", "readme"]);
    });

    it("activates on single click and omits aria-selected when selection-mode is none", async () => {
        const explorer = await mount(sampleItems(), element => {
            element.selectionMode = "none";
        });
        const activations = track<{ id: string }>(explorer, "item-activate");

        expect(row(explorer, "readme").hasAttribute("aria-selected")).toBe(false);
        row(explorer, "readme").click();
        await settle();

        expect(activations).toEqual([expect.objectContaining({ id: "readme" })]);
        expect(explorer.selectedIds).toEqual([]);
    });

    it("ignores disabled items for selection and activation", async () => {
        const items = sampleItems();
        items[2] = { ...items[2], disabled: true };
        const explorer = await mount(items);
        const activations = track<unknown>(explorer, "item-activate");

        expect(row(explorer, "readme").getAttribute("aria-disabled")).toBe("true");
        row(explorer, "readme").click();
        row(explorer, "readme").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        await settle();

        expect(explorer.selectedIds).toEqual([]);
        expect(activations).toHaveLength(0);
    });

    it("clears selection when the user navigates to another folder", async () => {
        const explorer = await mount();
        row(explorer, "readme").click();
        await settle();
        const selections = track<{ selectedIds: string[] }>(explorer, "selection-change");

        row(explorer, "docs").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        await settle();

        expect(selections.at(-1)?.selectedIds).toEqual([]);
        expect(explorer.selectedIds).toEqual([]);
    });

    it("honours host-controlled selection and current folder", async () => {
        const explorer = await mount();

        explorer.selectedIds = ["notes"];
        await settle();
        expect(row(explorer, "notes").getAttribute("aria-selected")).toBe("true");

        explorer.setAttribute("current-folder-id", "docs");
        await settle();
        expect(rowNames(explorer)).toEqual(["Specs", "plan.docx"]);
        expect(treeItem(explorer, "docs").getAttribute("aria-selected")).toBe("true");
        expect(treeItem(explorer, "docs").getAttribute("aria-expanded")).toBe("false");
    });

    it("shows busy, error and empty states and recovers through retry", async () => {
        const explorer = await mount([{ id: "empty", name: "Empty", kind: "folder" }]);
        const requests = track<{ folderId: string | null; reason: string }>(explorer, "folder-request");

        expect(explorer.shadowRoot?.querySelector('[part~="empty-state"]')).toBeNull();
        explorer.currentFolderId = "empty";
        await settle();
        expect(explorer.shadowRoot?.querySelector('[part~="empty-state"]')).not.toBeNull();
        expect(explorer.shadowRoot?.querySelector(".list")).toBeNull();

        explorer.busy = true;
        await settle();
        expect(explorer.shadowRoot?.querySelector('[part~="loading-state"]')).not.toBeNull();
        expect(explorer.shadowRoot?.querySelector('[part~="empty-state"]')).toBeNull();
        expect(explorer.shadowRoot?.querySelector(".content")?.getAttribute("aria-busy")).toBe("true");

        explorer.busy = false;
        explorer.loadError = "Could not read this folder.";
        await settle();
        const alert = explorer.shadowRoot?.querySelector('[role="alert"]');
        expect(alert?.textContent).toContain("Could not read this folder.");

        const retry = alert?.querySelector("violet-button") as HTMLElement;
        retry.click();
        await settle();
        expect(requests).toEqual([{ folderId: "empty", reason: "retry" }]);

        explorer.loadError = "";
        await settle();
        expect(explorer.shadowRoot?.querySelector('[role="alert"]')).toBeNull();
    });

    it("advertises unloaded folders as expandable and requests their contents once", async () => {
        const explorer = await mount([
            { id: "remote", name: "Remote", kind: "folder", loaded: false },
            { id: "local", name: "Local", kind: "folder" },
        ]);
        const requests = track<{ folderId: string | null; reason: string }>(explorer, "folder-request");

        const remote = treeItem(explorer, "remote");
        expect(remote.getAttribute("aria-expanded")).toBe("false");
        expect(treeItem(explorer, "local").hasAttribute("aria-expanded")).toBe(false);

        remote.focus();
        await userEvent.keyboard("{ArrowRight}");
        await settle();

        expect(requests).toEqual([{ folderId: "remote", reason: "expand" }]);
        expect(remote.getAttribute("aria-expanded")).toBe("true");

        // Navigating to the same pending folder does not re-request it.
        row(explorer, "remote").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        await settle();
        expect(requests).toHaveLength(1);
        expect(explorer.shadowRoot?.querySelector('[part~="loading-state"]')).not.toBeNull();
    });

    it("renders asynchronously supplied contents and rebuilds the tree levels", async () => {
        const explorer = await mount([{ id: "remote", name: "Remote", kind: "folder", loaded: false }]);
        const requests = track<{ folderId: string | null }>(explorer, "folder-request");

        row(explorer, "remote").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        await settle();
        expect(requests.at(-1)?.folderId).toBe("remote");
        expect(explorer.shadowRoot?.querySelector('[part~="loading-state"]')).not.toBeNull();

        explorer.items = [
            { id: "remote", name: "Remote", kind: "folder", loaded: true },
            { id: "child", name: "Child", kind: "folder", parentId: "remote" },
            { id: "a", name: "a.txt", kind: "file", parentId: "remote" },
        ];
        await settle();

        expect(explorer.shadowRoot?.querySelector('[part~="loading-state"]')).toBeNull();
        expect(rowNames(explorer)).toEqual(["Child", "a.txt"]);
        expect(treeItem(explorer, "child").getAttribute("aria-level")).toBe("3");
        expect(treeItem(explorer, "child").getAttribute("aria-posinset")).toBe("1");
    });

    it("keeps focus in the listing near its previous position when the focused row disappears", async () => {
        const explorer = await mount();

        row(explorer, "pics").focus();
        await settle();
        expect(focusedId(explorer)).toBe("pics");

        explorer.items = sampleItems().filter(item => item.id !== "pics");
        await settle();

        expect(focusedId(explorer)).toBe("readme");
    });

    it("keeps focus on the same row when contents are replaced with equal ids", async () => {
        const explorer = await mount();

        row(explorer, "readme").focus();
        explorer.items = sampleItems().map(item => ({ ...item, meta: "updated" }));
        await settle();

        expect(focusedId(explorer)).toBe("readme");
        expect(row(explorer, "readme").getAttribute("aria-label")).toBe("README.md, updated");
    });

    it("falls back to the content region when the focused folder becomes empty", async () => {
        const explorer = await mount(sampleItems(), element => {
            element.currentFolderId = "docs";
        });

        row(explorer, "plan").focus();
        explorer.items = sampleItems().filter(item => item.parentId !== "docs");
        await settle();

        expect(explorer.shadowRoot?.activeElement?.classList.contains("content")).toBe(true);
    });

    it("announces folder state in a polite live region", async () => {
        const explorer = await mount();
        const status = explorer.shadowRoot?.querySelector('.sr-only[role="status"]');

        expect(status?.textContent).toBe("Files: 4 items");
        explorer.currentFolderId = "docs";
        await settle();
        expect(status?.textContent).toBe("Documents: 2 items");
    });

    it("exposes actions, empty and footer slots", async () => {
        const explorer = await mount();
        const action = document.createElement("button");
        action.slot = "actions";
        action.textContent = "New";
        explorer.append(action);
        await settle();

        const slot = explorer.shadowRoot?.querySelector<HTMLSlotElement>('slot[name="actions"]');
        expect(slot?.assignedElements()).toContain(action);
    });
});
