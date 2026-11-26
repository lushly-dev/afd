import { afterEach, describe, expect, it, vi } from "vitest";
import { cdp, server, userEvent } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "./violet-button.define";
import type { VioletButton } from "./violet-button";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function renderButton(
  configure?: (button: VioletButton) => void,
  label = "Save",
): Promise<VioletButton> {
  document.body.innerHTML = "";

  const button = document.createElement("violet-button") as VioletButton;
  button.textContent = label;
  configure?.(button);
  document.body.append(button);

  await customElements.whenDefined("violet-button");
  await nextFrame();

  return button;
}

interface AxNode {
  backendDOMNodeId?: number;
  role?: { value?: string };
  name?: { value?: string };
  description?: { value?: string };
  properties?: {
    name: string;
    value: { value?: unknown; relatedNodes?: { backendDOMNodeId: number }[] };
  }[];
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

type References = Record<"ariaDescribedByElements" | "ariaControlsElements", Element[] | null>;

function control(button: VioletButton): HTMLButtonElement {
  const native = button.shadowRoot?.querySelector("button");
  if (!native) {
    throw new Error("violet-button did not render its native control");
  }
  return native;
}

describe("violet-button", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a native button with defaults", async () => {
    const button = await renderButton();

    expect(button.appearance).toBe("primary");
    expect(button.type).toBe("button");
    expect(button.disabled).toBe(false);
    expect(control(button).getAttribute("type")).toBe("button");
    expect(control(button).getAttribute("data-appearance")).toBe("primary");
    expect(control(button).disabled).toBe(false);
  });

  it("forwards attributes to properties and the native control", async () => {
    const button = await renderButton((el) => {
      el.setAttribute("appearance", "quiet");
      el.setAttribute("type", "submit");
      el.setAttribute("disabled", "");
    });

    expect(button.appearance).toBe("quiet");
    expect(button.type).toBe("submit");
    expect(button.disabled).toBe(true);
    expect(control(button).getAttribute("data-appearance")).toBe("quiet");
    expect(control(button).getAttribute("type")).toBe("submit");
    expect(control(button).disabled).toBe(true);
  });

  it("reflects property changes to host attributes and the control", async () => {
    const button = await renderButton();

    button.appearance = "transparent";
    button.disabled = true;
    await nextFrame();

    expect(button.getAttribute("appearance")).toBe("transparent");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(control(button).getAttribute("data-appearance")).toBe("transparent");
    expect(control(button).disabled).toBe(true);

    button.disabled = false;
    await nextFrame();

    expect(button.hasAttribute("disabled")).toBe(false);
    expect(control(button).disabled).toBe(false);
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", "{ }"],
  ])("activates with the %s key and emits a click", async (_name, keys) => {
    const button = await renderButton();
    let clicks = 0;
    button.addEventListener("click", () => {
      clicks += 1;
    });

    button.focus();
    await userEvent.keyboard(keys);

    expect(clicks).toBe(1);
  });

  it("delegates focus to the inner control", async () => {
    const button = await renderButton();

    button.focus();

    expect(document.activeElement).toBe(button);
    expect(button.shadowRoot?.activeElement).toBe(control(button));
  });

  it("does not emit clicks or take focus when disabled", async () => {
    const button = await renderButton((el) => {
      el.disabled = true;
    });
    let clicks = 0;
    button.addEventListener("click", () => {
      clicks += 1;
    });

    control(button).click();
    button.focus();
    await userEvent.keyboard("{Enter}");

    expect(clicks).toBe(0);
    expect(document.activeElement).not.toBe(button);
  });

  it("projects label, before and after slot content", async () => {
    const button = await renderButton((el) => {
      const before = document.createElement("span");
      before.slot = "before";
      before.textContent = "<";
      const after = document.createElement("span");
      after.slot = "after";
      after.textContent = ">";
      el.append(before, after);
    });
    const root = button.shadowRoot as ShadowRoot;
    const defaultSlot = root.querySelector("slot:not([name])") as HTMLSlotElement;
    const beforeSlot = root.querySelector('slot[name="before"]') as HTMLSlotElement;
    const afterSlot = root.querySelector('slot[name="after"]') as HTMLSlotElement;

    expect(defaultSlot.assignedNodes().map((node) => node.textContent)).toEqual(["Save"]);
    expect(beforeSlot.assignedElements()).toHaveLength(1);
    expect(afterSlot.assignedElements()).toHaveLength(1);
  });

  it("forwards aria properties to the native control", async () => {
    const button = await renderButton((el) => {
      el.ariaLabel = "Save draft";
      el.ariaExpanded = "false";
      el.ariaHasPopup = "menu";
    });
    const native = control(button);

    expect(native.getAttribute("aria-label")).toBe("Save draft");
    expect(native.getAttribute("aria-expanded")).toBe("false");
    expect(native.getAttribute("aria-haspopup")).toBe("menu");

    button.ariaExpanded = "true";
    await nextFrame();
    expect(native.getAttribute("aria-expanded")).toBe("true");

    button.ariaExpanded = null;
    await nextFrame();
    expect(native.hasAttribute("aria-expanded")).toBe(false);
  });

  it("forwards aria attributes set on the host for expanded and haspopup", async () => {
    const button = await renderButton((el) => {
      el.setAttribute("aria-expanded", "true");
      el.setAttribute("aria-haspopup", "listbox");
    });
    const native = control(button);

    expect(native.getAttribute("aria-expanded")).toBe("true");
    expect(native.getAttribute("aria-haspopup")).toBe("listbox");
  });

  it("resolves aria-describedby and aria-controls on the host to elements in the host's tree", async () => {
    document.body.innerHTML = `
            <p id="save-hint">Saves a copy you can restore.</p>
            <div id="save-panel"></div>
            <violet-button aria-describedby="save-hint" aria-controls="save-panel">Save</violet-button>
        `;
    await customElements.whenDefined("violet-button");
    await nextFrame();
    const native = control(
      document.querySelector("violet-button") as VioletButton,
    ) as unknown as References;

    expect(native.ariaControlsElements).toEqual([document.getElementById("save-panel")]);
    if (isChromium) {
      await vi.waitFor(async () => {
        const node = await accessibleNode("button", "Save");
        expect(node.description?.value).toBe("Saves a copy you can restore.");
      });
    }
  });

  it("resolves references set as properties and clears them", async () => {
    document.body.innerHTML = `<p id="draft-hint">Keeps your changes.</p>`;
    const button = document.createElement("violet-button") as VioletButton;
    button.textContent = "Keep";
    document.body.append(button);
    await customElements.whenDefined("violet-button");
    await nextFrame();
    const native = control(button) as unknown as References;

    button.ariaDescribedby = "draft-hint";
    expect(native.ariaDescribedByElements).toEqual([document.getElementById("draft-hint")]);
    if (isChromium) {
      await vi.waitFor(async () => {
        expect((await accessibleNode("button", "Keep")).description?.value).toBe(
          "Keeps your changes.",
        );
      });
    }

    button.ariaDescribedby = null;
    expect(native.ariaDescribedByElements ?? []).toEqual([]);
  });

  it("forwards aria-description to the native control", async () => {
    const button = await renderButton((el) => {
      el.setAttribute("aria-description", "Opens in a new window.");
    }, "Preview");

    expect(control(button).getAttribute("aria-description")).toBe("Opens in a new window.");
    if (isChromium) {
      await vi.waitFor(async () => {
        expect((await accessibleNode("button", "Preview")).description?.value).toBe(
          "Opens in a new window.",
        );
      });
    }
  });

  it("forwards aria-pressed to the native control", async () => {
    const button = await renderButton((el) => {
      el.ariaPressed = "false";
    });
    const native = control(button);
    expect(native.getAttribute("aria-pressed")).toBe("false");

    button.ariaPressed = "true";
    await nextFrame();
    expect(native.getAttribute("aria-pressed")).toBe("true");

    button.setAttribute("aria-pressed", "mixed");
    await nextFrame();
    expect(native.getAttribute("aria-pressed")).toBe("mixed");

    button.removeAttribute("aria-pressed");
    await nextFrame();
    expect(native.hasAttribute("aria-pressed")).toBe(false);
  });

  it("forwards aria-keyshortcuts to the native control and clears it when removed", async () => {
    const button = await renderButton((el) => {
      el.setAttribute("aria-keyshortcuts", "Meta+K");
    }, "Search");
    const native = control(button);

    expect(button.ariaKeyShortcuts).toBe("Meta+K");
    expect(native.getAttribute("aria-keyshortcuts")).toBe("Meta+K");
    if (isChromium) {
      await vi.waitFor(async () => {
        const node = await accessibleNode("button", "Search");
        expect(
          node.properties?.find((property) => property.name === "keyshortcuts")?.value.value,
        ).toBe("Meta+K");
      });
    }

    button.ariaKeyShortcuts = "Control+S";
    await nextFrame();
    expect(native.getAttribute("aria-keyshortcuts")).toBe("Control+S");

    button.removeAttribute("aria-keyshortcuts");
    await nextFrame();
    expect(native.hasAttribute("aria-keyshortcuts")).toBe(false);

    button.ariaKeyShortcuts = "Alt+Enter";
    await nextFrame();
    expect(native.getAttribute("aria-keyshortcuts")).toBe("Alt+Enter");

    button.ariaKeyShortcuts = null;
    await nextFrame();
    expect(native.hasAttribute("aria-keyshortcuts")).toBe(false);
  });

  describe("danger appearance", () => {
    function channels(color: string): number[] {
      const probe = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
      probe.fillStyle = color;
      probe.fillRect(0, 0, 1, 1);
      return Array.from(probe.getImageData(0, 0, 1, 1).data).slice(0, 3);
    }

    function luminance([r, g, b]: number[]): number {
      const [lr, lg, lb] = [r, g, b].map((value) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    }

    function contrast(a: string, b: string): number {
      const [hi, lo] = [luminance(channels(a)), luminance(channels(b))].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    }

    it("sets data-appearance and fills with the danger action tokens", async () => {
      // Move any leftover virtual pointer away from (0, 0) so the button mounts in its resting state.
      await userEvent.hover(document.documentElement, { position: { x: 400, y: 400 } });
      const button = await renderButton((el) => {
        el.setAttribute("appearance", "danger");
      }, "Delete");
      const native = control(button);
      expect(button.appearance).toBe("danger");
      expect(native.getAttribute("data-appearance")).toBe("danger");

      const style = getComputedStyle(native);
      expect(channels(style.backgroundColor)).toEqual(channels("#c42a1a"));
      expect(channels(style.color)).toEqual(channels("#ffffff"));
    });

    it("honors the --color-action-danger-* token overrides", async () => {
      document.body.style.setProperty("--violet-color-action-danger-background", "rgb(1, 2, 3)");
      document.body.style.setProperty("--violet-color-action-danger-text", "rgb(250, 251, 252)");
      try {
        const button = await renderButton((el) => {
          el.appearance = "danger";
        }, "Delete");
        const style = getComputedStyle(control(button));
        expect(style.backgroundColor).toBe("rgb(1, 2, 3)");
        expect(style.color).toBe("rgb(250, 251, 252)");
      } finally {
        document.body.style.removeProperty("--violet-color-action-danger-background");
        document.body.style.removeProperty("--violet-color-action-danger-text");
      }
    });

    it("keeps text legible on the fill, under the pointer and pressed too", () => {
      expect(contrast("#ffffff", "#c42a1a")).toBeGreaterThanOrEqual(4.5);
      expect(contrast("#ffffff", "#ad2416")).toBeGreaterThanOrEqual(4.5);
      expect(contrast("#ffffff", "#96200f")).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe("sizing", () => {
    const appearances = ["primary", "secondary", "quiet", "transparent", "danger"] as const;

    function targetSize(button: VioletButton): number {
      return Number.parseFloat(
        getComputedStyle(control(button)).getPropertyValue("--_target-size"),
      );
    }

    function expectInside(inner: DOMRect, outer: DOMRect): void {
      expect(inner.top).toBeGreaterThanOrEqual(outer.top - 0.5);
      expect(inner.bottom).toBeLessThanOrEqual(outer.bottom + 0.5);
      expect(inner.left).toBeGreaterThanOrEqual(outer.left - 0.5);
      expect(inner.right).toBeLessThanOrEqual(outer.right + 0.5);
    }

    async function renderInto(markup: string, style = ""): Promise<VioletButton[]> {
      document.body.innerHTML = `<div id="host" style="${style}">${markup}</div>`;
      await customElements.whenDefined("violet-button");
      await nextFrame();
      return Array.from(document.querySelectorAll("violet-button")) as VioletButton[];
    }

    afterEach(() => {
      document.body.removeAttribute("style");
    });

    it("keeps a one-line label at exactly the target size", async () => {
      const buttons = await renderInto(
        appearances
          .map((appearance) => `<violet-button appearance="${appearance}">Save</violet-button>`)
          .join(""),
      );

      for (const button of buttons) {
        expect(control(button).getBoundingClientRect().height).toBeCloseTo(targetSize(button), 0);
      }
    });

    it("grows every button with its label when the body type tokens double", async () => {
      // Emulates 200% text-only zoom: the type tokens are px, so root font-size has no effect.
      document.body.style.setProperty("--violet-type-body-size", "28px");
      document.body.style.setProperty("--violet-type-body-line", "40px");
      const buttons = await renderInto(
        appearances
          .map(
            (appearance) =>
              `<violet-button appearance="${appearance}">Save changes</violet-button>`,
          )
          .join(""),
      );

      for (const button of buttons) {
        const controlRect = control(button).getBoundingClientRect();
        const labelRect = button.shadowRoot!.querySelector(".label")!.getBoundingClientRect();

        expect(labelRect.height).toBeGreaterThanOrEqual(40);
        expect(controlRect.height).toBeGreaterThan(targetSize(button));
        expectInside(labelRect, controlRect);
      }
    });

    it("wraps a long label inside the control instead of overflowing", async () => {
      const [button] = await renderInto(
        `<violet-button appearance="secondary">Save the planting schedule for every bed</violet-button>`,
        "inline-size: 140px",
      );
      const controlRect = control(button!).getBoundingClientRect();
      const labelRect = button!.shadowRoot!.querySelector(".label")!.getBoundingClientRect();
      const lineHeight = Number.parseFloat(getComputedStyle(control(button!)).lineHeight);

      expect(labelRect.height).toBeGreaterThanOrEqual(lineHeight * 2);
      expectInside(labelRect, controlRect);
      expect(controlRect.width).toBeLessThanOrEqual(140.5);
      expect(getComputedStyle(button!.shadowRoot!.querySelector(".label")!).textAlign).toBe(
        "center",
      );
    });

    it("keeps its own height beside a taller flex sibling", async () => {
      const [button] = await renderInto(
        `<violet-button>Save</violet-button><div style="block-size: 120px; inline-size: 40px"></div>`,
        "display: flex",
      );

      expect(control(button!).getBoundingClientRect().height).toBeCloseTo(targetSize(button!), 0);
    });
  });
});
