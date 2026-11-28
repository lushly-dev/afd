import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp, server, userEvent } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "../button/violet-button.define";
import "./violet-tooltip.define";
import type { VioletTooltip } from "./violet-tooltip";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

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

async function renderTooltip(template: string): Promise<VioletTooltip> {
  document.body.innerHTML = template;
  await customElements.whenDefined("violet-tooltip");
  await nextFrame();
  return document.querySelector("violet-tooltip") as VioletTooltip;
}

describe("violet-tooltip", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("describes its trigger with the content attribute", async () => {
    const tooltip = await renderTooltip(`
            <violet-tooltip content="Copies the link">
                <button type="button">Share</button>
            </violet-tooltip>
        `);
    const trigger = tooltip.querySelector("button") as HTMLButtonElement;

    expect(trigger.getAttribute("aria-description")).toBe("Copies the link");
    if (isChromium) {
      await vi.waitFor(async () => {
        expect((await accessibleNode("button", "Share")).description?.value).toBe(
          "Copies the link",
        );
      });
    }

    tooltip.content = "Copies a short link";
    await nextFrame();
    expect(trigger.getAttribute("aria-description")).toBe("Copies a short link");
    if (isChromium) {
      await vi.waitFor(async () => {
        expect((await accessibleNode("button", "Share")).description?.value).toBe(
          "Copies a short link",
        );
      });
    }
  });

  it("describes its trigger with slotted content and keeps the trigger's own references", async () => {
    const tooltip = await renderTooltip(`
            <p id="share-note">Anyone with the link can view.</p>
            <violet-tooltip>
                <button type="button" aria-describedby="share-note">Share</button>
                <span slot="content">Copies <strong>the link</strong></span>
            </violet-tooltip>
        `);
    const trigger = tooltip.querySelector("button") as HTMLButtonElement;
    const content = tooltip.querySelector('[slot="content"]') as HTMLElement;

    expect(trigger.getAttribute("aria-describedby")).toBe(`share-note ${content.id}`);
    if (isChromium) {
      await vi.waitFor(async () => {
        expect((await accessibleNode("button", "Share")).description?.value).toBe(
          "Anyone with the link can view. Copies the link",
        );
      });
    }

    content.remove();
    await vi.waitFor(() => expect(trigger.getAttribute("aria-describedby")).toBe("share-note"));
  });

  it("describes a violet-button trigger's inner button", async () => {
    const tooltip = await renderTooltip(`
            <violet-tooltip content="Saves without closing">
                <violet-button>Save</violet-button>
            </violet-tooltip>
        `);

    expect(tooltip.querySelector("violet-button")?.getAttribute("aria-description")).toBe(
      "Saves without closing",
    );
    if (isChromium) {
      await vi.waitFor(async () => {
        expect((await accessibleNode("button", "Save")).description?.value).toBe(
          "Saves without closing",
        );
      });
    }
  });

  it("shows again on hover after Escape closes it", async () => {
    const tooltip = await renderTooltip(`
            <violet-tooltip content="Helpful details" delay="10">
                <button type="button">Trigger</button>
            </violet-tooltip>
        `);
    const trigger = tooltip.querySelector("button") as HTMLButtonElement;
    const popup = tooltip.shadowRoot?.querySelector(".tooltip") as HTMLElement;

    trigger.focus();
    await vi.waitFor(() => {
      expect(tooltip.open).toBe(true);
      expect(popup.matches(":popover-open")).toBe(true);
    });

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      expect(popup.matches(":popover-open")).toBe(false);
      expect(tooltip.open).toBe(false);
    });

    // The tooltip listens on its anchor wrapper, and mouseenter does not bubble.
    tooltip.shadowRoot?.querySelector(".anchor")?.dispatchEvent(new MouseEvent("mouseenter"));
    await vi.waitFor(() => {
      expect(tooltip.open).toBe(true);
      expect(popup.matches(":popover-open")).toBe(true);
    });
  });

  it("supports an external anchor trigger by id", async () => {
    const tooltip = await renderTooltip(`
            <button id="outside-anchor" type="button" style="anchor-name:--author-tip;">Anchor</button>
            <violet-tooltip anchor="outside-anchor" content="Helpful details"></violet-tooltip>
        `);

    const anchor = document.getElementById("outside-anchor") as HTMLButtonElement | null;
    anchor?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await nextFrame();

    expect(anchor?.style.getPropertyValue("anchor-name")).toBe("--author-tip");
    expect(tooltip.anchorName).toMatch(/^--violet-tooltip-anchor-\d+$/);
    expect(tooltip.open).toBe(true);
    expect(anchor?.getAttribute("aria-description")).toBe("Helpful details");
    if (isChromium) {
      await vi.waitFor(async () => {
        expect((await accessibleNode("button", "Anchor")).description?.value).toBe(
          "Helpful details",
        );
      });
    }

    tooltip.anchor = "";
    await nextFrame();
    expect(anchor?.hasAttribute("aria-description")).toBe(false);
  });
});
