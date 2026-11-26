import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp, server } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "../button/violet-button.define";
import "./violet-teaching-tip.define";
import { registerSystemSearchIcon } from "../icon/generated/icons/system-search";
import { resolveVioletIcon } from "../icon/icon-registry";
import type { VioletIcon } from "../icon/violet-icon";
import type { VioletTeachingTip } from "./violet-teaching-tip";

registerSystemSearchIcon();

interface AxNode {
  backendDOMNodeId?: number;
  role?: { value?: string };
  name?: { value?: string };
  description?: { value?: string };
  properties?: { name: string; value: { relatedNodes?: { backendDOMNodeId: number }[] } }[];
}

interface FrameTree {
  frame: { id: string; url: string };
  childFrames?: FrameTree[];
}

function findFrame(tree: FrameTree, url: string): string | undefined {
  if (tree.frame.url === url) {
    return tree.frame.id;
  }
  for (const child of tree.childFrames ?? []) {
    const found = findFrame(child, url);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/**
 * A node of Chromium's accessibility tree, found by role and name, with the nodes its
 * aria-controls resolves to. The tree resolves references, or drops them, as assistive
 * technology sees them, which the attributes alone do not show.
 */
async function accessibleNode(
  role: string,
  name: string,
): Promise<AxNode & { controls: AxNode[] }> {
  const session = cdp() as unknown as { send(method: string, params?: object): Promise<unknown> };
  // Each spec runs in a frame of the runner's page; read that frame's tree, found by its URL.
  const { frameTree } = (await session.send("Page.getFrameTree")) as { frameTree: FrameTree };
  const frameId = findFrame(frameTree, location.href);
  const { nodes } = (await session.send("Accessibility.getFullAXTree", { frameId })) as {
    nodes: AxNode[];
  };
  const node = nodes.find(
    (candidate) => candidate.role?.value === role && candidate.name?.value === name,
  );
  if (!node) {
    throw new Error(`No ${role} named "${name}" in the accessibility tree.`);
  }
  const byId = new Map(nodes.map((candidate) => [candidate.backendDOMNodeId, candidate]));
  const related =
    node.properties?.find((property) => property.name === "controls")?.value.relatedNodes ?? [];
  const controls = related
    .map((entry) => byId.get(entry.backendDOMNodeId))
    .filter((entry) => entry !== undefined);
  return { ...node, controls };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function expectCloseGlyph(button: Element | null | undefined): Promise<void> {
  const icon = button?.querySelector("violet-icon") as VioletIcon | null | undefined;
  expect(icon).toBeTruthy();
  expect(icon?.icon).toBe("system/close");

  const closeSvg = resolveVioletIcon("system/close")?.svg ?? "";
  const searchSvg = resolveVioletIcon("system/search")?.svg ?? "";
  expect(closeSvg).not.toBe("");
  expect(searchSvg).not.toBe("");

  await nextFrame();
  const rendered = icon?.shadowRoot?.querySelector(".glyph svg");
  const expected = new DOMParser().parseFromString(closeSvg, "image/svg+xml").documentElement;
  expect(rendered).not.toBeNull();
  const paths = (root: Element | null | undefined) =>
    Array.from(root?.querySelectorAll("path") ?? []).map((path) => path.getAttribute("d"));
  expect(paths(rendered)).toEqual(paths(expected));
  expect(paths(rendered).length).toBeGreaterThan(0);
  expect(rendered?.querySelector("circle")).toBeNull();
}

async function renderTeachingTip(template: string): Promise<VioletTeachingTip> {
  document.body.innerHTML = template;
  await customElements.whenDefined("violet-teaching-tip");
  await nextFrame();
  return document.querySelector("violet-teaching-tip") as VioletTeachingTip;
}

describe("violet-teaching-tip", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("syncs dialog trigger aria to a slotted trigger", async () => {
    const tip = await renderTeachingTip(`
            <violet-teaching-tip>
                <button type="button">Show tip</button>
                <span slot="title">Title</span>
            </violet-teaching-tip>
        `);

    const trigger = tip.querySelector("button");
    expect(trigger?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    // The tip is in the shadow root: the trigger names the host, whose shadow root forwards
    // the reference to the tip when referenceTarget is supported.
    if ("referenceTarget" in ShadowRoot.prototype) {
      expect(trigger?.getAttribute("aria-controls")).toBe(tip.id);
    }

    tip.show();
    await nextFrame();

    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    if (isChromium) {
      await vi.waitFor(async () => {
        const controls = (await accessibleNode("button", "Show tip")).controls;
        expect(controls.map((node) => `${node.role?.value}: ${node.name?.value}`)).toEqual([
          "dialog: Title",
        ]);
      });
    }
  });

  it("supports an external anchor by id and cleans up ARIA when cleared", async () => {
    const tip = await renderTeachingTip(`
            <button id="outside-tip-anchor" type="button" style="anchor-name:--author-tip;">Anchor</button>
            <violet-teaching-tip anchor="outside-tip-anchor">
                <button id="slotted-tip-trigger" type="button">Slotted</button>
                <span slot="title">Title</span>
            </violet-teaching-tip>
        `);

    const anchor = document.getElementById("outside-tip-anchor") as HTMLButtonElement | null;
    const slotted = document.getElementById("slotted-tip-trigger") as HTMLButtonElement | null;

    expect(tip.anchorName).toMatch(/^--violet-teaching-tip-anchor-\d+$/);
    expect(anchor?.style.getPropertyValue("anchor-name")).toBe("--author-tip");
    expect(anchor?.getAttribute("aria-haspopup")).toBe("dialog");
    if ("referenceTarget" in ShadowRoot.prototype) {
      expect(anchor?.getAttribute("aria-controls")).toBe(tip.id);
    }

    // Clearing anchor while open must remove ARIA from the detached external trigger and re-wire the slotted trigger.
    tip.show();
    await nextFrame();
    expect(anchor?.getAttribute("aria-expanded")).toBe("true");
    expect(slotted?.hasAttribute("aria-expanded")).toBe(false);

    // Mutating the default slot while externally anchored must not hijack trigger ARIA.
    const extra = document.createElement("span");
    tip.append(extra);
    await nextFrame();
    expect(anchor?.getAttribute("aria-expanded")).toBe("true");
    expect(slotted?.hasAttribute("aria-expanded")).toBe(false);

    tip.anchor = "";
    await nextFrame();
    expect(anchor?.hasAttribute("aria-haspopup")).toBe(false);
    expect(anchor?.hasAttribute("aria-expanded")).toBe(false);
    expect(anchor?.hasAttribute("aria-controls")).toBe(false);
    expect(anchor?.style.getPropertyValue("anchor-name")).toBe("--author-tip");
    expect(slotted?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(slotted?.getAttribute("aria-expanded")).toBe("true");

    // Switching back from slotted to external while open clears slotted ARIA and moves it to external.
    tip.anchor = "outside-tip-anchor";
    await nextFrame();
    expect(slotted?.hasAttribute("aria-haspopup")).toBe(false);
    expect(slotted?.hasAttribute("aria-expanded")).toBe(false);
    expect(slotted?.hasAttribute("aria-controls")).toBe(false);
    expect(anchor?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(anchor?.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders the close glyph through the icon attribute with search also registered", async () => {
    const tip = await renderTeachingTip(`
            <violet-teaching-tip><span slot="title">Title</span></violet-teaching-tip>
        `);

    await expectCloseGlyph(tip.shadowRoot?.querySelector('[part="close-button"]'));
  });
});
