import { afterEach, describe, expect, it } from "vitest";

import "./violet-tree-item";
import { VioletTreeItem } from "./violet-tree-item";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

function createItem(label: string, configure?: (item: VioletTreeItem) => void): VioletTreeItem {
    const item = document.createElement("violet-tree-item") as VioletTreeItem;
    item.append(document.createTextNode(label));
    configure?.(item);
    return item;
}

async function mount(item: VioletTreeItem): Promise<VioletTreeItem> {
    document.body.innerHTML = "";
    document.body.append(item);

    await customElements.whenDefined("violet-tree-item");
    await nextFrame();
    await nextFrame();

    return item;
}

function row(item: VioletTreeItem): HTMLElement {
    const element = item.shadowRoot?.querySelector(".row") as HTMLElement | null;
    if (!element) {
        throw new Error("violet-tree-item did not render its row");
    }
    return element;
}

function track<T>(item: VioletTreeItem, name: string): T[] {
    const details: T[] = [];
    item.addEventListener(name, event => {
        details.push((event as CustomEvent<T>).detail);
    });
    return details;
}

describe("violet-tree-item", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("can take real focus (the host is the focusable element, nothing inside delegates)", async () => {
        const item = await mount(createItem("Docs"));

        item.focusItem();

        expect(document.activeElement).toBe(item);
        expect(item.matches(":focus")).toBe(true);
    });

    it("advertises expandability for lazy branches without rendered children", async () => {
        const item = await mount(createItem("Remote", element => {
            element.expandable = true;
        }));

        expect(item.hasChildren).toBe(true);
        expect(item.getAttribute("aria-expanded")).toBe("false");

        item.expandable = false;
        expect(item.hasAttribute("aria-expanded")).toBe(false);
    });

    it("exposes treeitem semantics with default position", async () => {
        const item = await mount(createItem("Docs"));

        expect(item.getAttribute("role")).toBe("treeitem");
        expect(item.getAttribute("aria-level")).toBe("1");
        expect(item.getAttribute("aria-posinset")).toBe("1");
        expect(item.getAttribute("aria-setsize")).toBe("1");
        expect(item.getAttribute("aria-selected")).toBe("false");
        expect(item.hasAttribute("aria-expanded")).toBe(false);
        expect(item.hasAttribute("aria-disabled")).toBe(false);
        expect(item.id).not.toBe("");
    });

    it("can be created with document.createElement without host attributes", () => {
        let item: HTMLElement | undefined;
        expect(() => {
            item = document.createElement("violet-tree-item");
        }).not.toThrow();
        expect(item?.attributes.length).toBe(0);
        expect(item?.children.length).toBe(0);
    });

    it("applies tabindex -1 on connect and preserves an author-set tabindex", async () => {
        const authored = createItem("Docs", el => el.setAttribute("tabindex", "0"));
        await mount(authored);
        expect(authored.tabIndex).toBe(0);
    });

    it("starts out of the tab order and becomes the roving tab stop when activated", async () => {
        const item = await mount(createItem("Docs"));

        expect(item.tabIndex).toBe(-1);

        item.setActiveFromTree(true);
        expect(item.tabIndex).toBe(0);

        item.setActiveFromTree(false);
        expect(item.tabIndex).toBe(-1);
    });

    it("maps attributes to properties and reflects them to ARIA", async () => {
        const item = await mount(
            createItem("Docs", el => {
                el.setAttribute("selected", "");
                el.setAttribute("disabled", "");
                el.setAttribute("value", "docs-id");
            })
        );

        expect(item.selected).toBe(true);
        expect(item.disabled).toBe(true);
        expect(item.value).toBe("docs-id");
        expect(item.getAttribute("aria-selected")).toBe("true");
        expect(item.getAttribute("aria-disabled")).toBe("true");

        item.selected = false;
        item.disabled = false;
        await nextFrame();

        expect(item.hasAttribute("selected")).toBe(false);
        expect(item.getAttribute("aria-selected")).toBe("false");
        expect(item.hasAttribute("aria-disabled")).toBe(false);
    });

    it("applies tree position to aria attributes and the level custom property", async () => {
        const item = await mount(createItem("Docs"));

        item.setTreePosition(3, 2, 5);

        expect(item.getAttribute("aria-level")).toBe("3");
        expect(item.getAttribute("aria-posinset")).toBe("2");
        expect(item.getAttribute("aria-setsize")).toBe("5");
        expect(item.style.getPropertyValue("--_tree-level")).toBe("3");
    });

    it("resolves its label text and falls back to aria-label", async () => {
        const item = await mount(createItem("  Docs   folder "));

        expect(item.textLabel).toBe("Docs folder");
        expect(item.resolvedValue).toBe("Docs folder");

        const iconOnly = await mount(
            createItem("", el => {
                el.setAttribute("aria-label", "Settings");
            })
        );

        expect(iconOnly.textLabel).toBe("Settings");
    });

    it("prefers an explicit value over the label text", async () => {
        const item = await mount(
            createItem("Docs", el => {
                el.value = "docs-id";
            })
        );

        expect(item.resolvedValue).toBe("docs-id");
    });

    it("emits select-request with its resolved value when the row is clicked", async () => {
        const item = await mount(createItem("Docs"));
        const selects = track<{ value: string }>(item, "select-request");
        const toggles = track<{ expanded: boolean }>(item, "toggle-request");

        row(item).click();

        expect(selects).toEqual([{ value: "Docs" }]);
        expect(toggles).toEqual([]);
    });

    it("does not emit requests when disabled", async () => {
        const item = await mount(
            createItem("Docs", el => {
                el.disabled = true;
            })
        );
        const selects = track<{ value: string }>(item, "select-request");
        const toggles = track<{ expanded: boolean }>(item, "toggle-request");

        row(item).click();

        expect(selects).toEqual([]);
        expect(toggles).toEqual([]);
    });

    it("projects start, label and meta slots", async () => {
        const item = createItem("Docs", el => {
            const start = document.createElement("span");
            start.slot = "start";
            const meta = document.createElement("span");
            meta.slot = "meta";
            el.append(start, meta);
        });
        await mount(item);
        const root = item.shadowRoot as ShadowRoot;

        expect((root.querySelector('slot[name="start"]') as HTMLSlotElement).assignedElements()).toHaveLength(1);
        expect((root.querySelector('slot[name="meta"]') as HTMLSlotElement).assignedElements()).toHaveLength(1);
        expect(item.labelSlot.assignedNodes()[0]?.textContent).toBe("Docs");
    });

    describe("with nested items", () => {
        async function mountParent(): Promise<{ parent: VioletTreeItem; child: VioletTreeItem }> {
            const child = createItem("Child");
            const parent = createItem("Parent");
            parent.append(child);
            await mount(parent);
            return { parent, child };
        }

        it("detects child items and assigns them to the item slot", async () => {
            const { parent, child } = await mountParent();

            expect(parent.hasChildren).toBe(true);
            expect(parent.childItems).toEqual([child]);
            expect(child.getAttribute("slot")).toBe("item");
            expect(child.parentItem).toBe(parent);
        });

        // Requires the @observable `childItems` change callback, which is a no-op when the
        // vite/esbuild test transform does not apply experimentalDecorators.
        it("exposes aria-expanded only on items that have children", async () => {
            const { parent, child } = await mountParent();

            expect(parent.getAttribute("aria-expanded")).toBe("false");
            expect(child.hasAttribute("aria-expanded")).toBe(false);
        });

        it("reflects expanded to aria-expanded on a parent item", async () => {
            const { parent } = await mountParent();

            parent.expanded = true;
            await nextFrame();

            expect(parent.hasAttribute("expanded")).toBe(true);
            expect(parent.getAttribute("aria-expanded")).toBe("true");
        });

        it("keeps the child group hidden until expanded", async () => {
            const { parent } = await mountParent();
            const group = parent.shadowRoot?.querySelector(".group") as HTMLElement;

            expect(group.getAttribute("role")).toBe("group");
            expect(group.hasAttribute("hidden")).toBe(true);

            parent.expanded = true;
            await nextFrame();

            expect(group.hasAttribute("hidden")).toBe(false);
        });

        it("emits toggle-request instead of select-request when the toggle is clicked", async () => {
            const { parent } = await mountParent();
            const selects = track<{ value: string }>(parent, "select-request");
            const toggles = track<{ expanded: boolean }>(parent, "toggle-request");

            (parent.shadowRoot?.querySelector(".toggle") as HTMLElement).click();

            expect(toggles).toEqual([{ expanded: true }]);
            expect(selects).toEqual([]);

            parent.expanded = true;
            (parent.shadowRoot?.querySelector(".toggle") as HTMLElement).click();

            expect(toggles).toEqual([{ expanded: true }, { expanded: false }]);
        });

        it("emits select-request when the label area is clicked", async () => {
            const { parent } = await mountParent();
            const selects = track<{ value: string }>(parent, "select-request");
            const toggles = track<{ expanded: boolean }>(parent, "toggle-request");

            (parent.shadowRoot?.querySelector(".label") as HTMLElement).click();

            expect(selects).toEqual([{ value: "Parent" }]);
            expect(toggles).toEqual([]);
        });

        it("emits select-request when the toggle is clicked on a leaf item", async () => {
            const item = await mount(createItem("Leaf"));
            const selects = track<{ value: string }>(item, "select-request");
            const toggles = track<{ expanded: boolean }>(item, "toggle-request");

            (item.shadowRoot?.querySelector(".toggle") as HTMLElement).click();

            expect(toggles).toEqual([]);
            expect(selects).toEqual([{ value: "Leaf" }]);
        });

        it("tracks children added and removed after connection", async () => {
            const { parent, child } = await mountParent();
            const extra = createItem("Extra");

            parent.append(extra);
            await nextFrame();
            await nextFrame();

            expect(parent.childItems).toEqual([child, extra]);

            child.remove();
            extra.remove();
            await nextFrame();
            await nextFrame();

            expect(parent.hasChildren).toBe(false);
            expect(parent.hasAttribute("aria-expanded")).toBe(false);
        });
    });
});
