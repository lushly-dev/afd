import { afterEach, describe, expect, it } from "vitest";

import "../tree-item/violet-tree-item";
import "./violet-tree";
import type { VioletTree } from "./violet-tree";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderTree(markup: string): Promise<VioletTree> {
    document.body.innerHTML = markup;
    await customElements.whenDefined("violet-tree");
    await customElements.whenDefined("violet-tree-item");
    await nextFrame();
    await nextFrame();
    return document.querySelector("violet-tree") as VioletTree;
}

describe("violet-tree", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("selects an item and emits change when a tree item is clicked", async () => {
        const tree = await renderTree(`
            <violet-tree value="propagation">
                <violet-tree-item value="operations" expanded>
                    Operations
                    <violet-tree-item value="propagation">Propagation</violet-tree-item>
                    <violet-tree-item value="irrigation">Irrigation</violet-tree-item>
                </violet-tree-item>
            </violet-tree>
        `);

        let emittedValue = "";
        tree.addEventListener("change", event => {
            emittedValue = (event as CustomEvent<{ value: string }>).detail.value;
        });

        const target = tree.querySelector('violet-tree-item[value="irrigation"]') as HTMLElement | null;
        target?.shadowRoot?.querySelector("[part='row']")?.dispatchEvent(
            new MouseEvent("click", { bubbles: true, composed: true }),
        );
        await nextFrame();

        expect(tree.value).toBe("irrigation");
        expect(emittedValue).toBe("irrigation");
        expect(target?.getAttribute("aria-selected")).toBe("true");
    });

    it("supports arrow key expansion and focus movement", async () => {
        const tree = await renderTree(`
            <violet-tree>
                <violet-tree-item value="operations">
                    Operations
                    <violet-tree-item value="propagation">Propagation</violet-tree-item>
                    <violet-tree-item value="irrigation">Irrigation</violet-tree-item>
                </violet-tree-item>
                <violet-tree-item value="reports">Reports</violet-tree-item>
            </violet-tree>
        `);

        const root = tree.querySelector('violet-tree-item[value="operations"]') as HTMLElement | null;
        root?.focus();
        root?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true }));
        await nextFrame();

        expect(root?.getAttribute("aria-expanded")).toBe("true");

        root?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true }));
        await nextFrame();

        const child = tree.querySelector('violet-tree-item[value="propagation"]') as HTMLElement | null;
        expect(child?.getAttribute("tabindex")).toBe("0");
    });

    it("moves focus with typeahead", async () => {
        const tree = await renderTree(`
            <violet-tree>
                <violet-tree-item value="operations">Operations</violet-tree-item>
                <violet-tree-item value="reports">Reports</violet-tree-item>
                <violet-tree-item value="settings">Settings</violet-tree-item>
            </violet-tree>
        `);

        const first = tree.querySelector('violet-tree-item[value="operations"]') as HTMLElement | null;
        first?.focus();
        first?.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true, composed: true }));
        await nextFrame();

        const reports = tree.querySelector('violet-tree-item[value="reports"]') as HTMLElement | null;
        expect(reports?.getAttribute("tabindex")).toBe("0");
    });

    it("labels the inner tree from aria-label without reflecting a default onto the host", async () => {
        const tree = await renderTree(`
            <violet-tree>
                <violet-tree-item value="a">A</violet-tree-item>
            </violet-tree>
        `);
        const inner = () => tree.shadowRoot?.querySelector('[role="tree"]') as HTMLElement;

        expect(tree.hasAttribute("aria-label")).toBe(false);
        expect(inner().getAttribute("aria-label")).toBe("Tree");

        const labelled = await renderTree(`
            <violet-tree aria-label="Site map">
                <violet-tree-item value="a">A</violet-tree-item>
            </violet-tree>
        `);
        await nextFrame();
        expect(labelled.shadowRoot?.querySelector('[role="tree"]')?.getAttribute("aria-label")).toBe("Site map");
    });
});

describe("violet-tree construction", () => {
    it("can be created with document.createElement", () => {
        expect(() => document.createElement("violet-tree")).not.toThrow();
    });

    it("emits expanded-change and expands lazy expandable branches by keyboard", async () => {
        const tree = await renderTree(`
            <violet-tree>
                <violet-tree-item value="remote" expandable>Remote</violet-tree-item>
                <violet-tree-item value="leaf">Leaf</violet-tree-item>
            </violet-tree>
        `);
        const details: { value: string; expanded: boolean }[] = [];
        tree.addEventListener("expanded-change", event => {
            details.push((event as CustomEvent<{ value: string; expanded: boolean }>).detail);
        });

        const remote = tree.querySelector('violet-tree-item[value="remote"]') as HTMLElement;
        const leaf = tree.querySelector('violet-tree-item[value="leaf"]') as HTMLElement;
        expect(remote.getAttribute("aria-expanded")).toBe("false");
        expect(leaf.hasAttribute("aria-expanded")).toBe(false);

        remote.focus();
        remote.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true }));
        await nextFrame();
        remote.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, composed: true }));
        await nextFrame();

        expect(details).toEqual([
            expect.objectContaining({ value: "remote", expanded: true }),
            expect.objectContaining({ value: "remote", expanded: false }),
        ]);
    });
});
