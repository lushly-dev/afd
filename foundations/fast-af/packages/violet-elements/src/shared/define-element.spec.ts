import { FASTElement, html } from "@lushly-dev/fast-element";
import { ensureScopedRegistrySupport } from "@lushly-dev/fast-element/scoped.js";
import { describe, expect, it } from "vitest";

// The polyfill (Firefox) must replace the registry before any element is defined, so the define
// modules load after it.
await ensureScopedRegistrySupport();
const { VioletButton } = await import("../button/violet-button");
const { defineVioletButton } = await import("../button/violet-button.define");
const { VioletOption } = await import("../option/violet-option");
const { VioletSelect } = await import("../select/violet-select");
const { defineVioletSelect } = await import("../select/violet-select.define");
const { defineVioletElement } = await import("./define-element");

type Observed = { observedAttributes: string[] };

describe("define modules (#1785)", () => {
  it("register their element globally when imported, with the class itself", () => {
    expect(customElements.get("violet-button")).toBe(VioletButton);
    expect(customElements.get("violet-select")).toBe(VioletSelect);
    // violet-select's define module defines the option it reads first.
    expect(customElements.get("violet-option")).toBe(VioletOption);
  });

  it("define the same class, not a FAST subclass, in a scoped registry", async () => {
    const registry = new CustomElementRegistry();
    await defineVioletButton(registry);

    expect(registry.get("violet-button")).toBe(VioletButton);
    expect(registry.get("violet-button")).toBe(customElements.get("violet-button"));
  });

  it("define an element's dependencies in the registry given, with its extensions", async () => {
    const registry = new CustomElementRegistry();
    await defineVioletSelect(registry);

    expect(registry.get("violet-select")).toBe(VioletSelect);
    expect(registry.get("violet-option")).toBe(VioletOption);
    expect(registry.get("violet-button")).toBeUndefined();
    expect((VioletSelect as unknown as Observed).observedAttributes).toContain("value");
    expect((VioletOption as unknown as Observed).observedAttributes).toContain("value");
  });

  it("do nothing when called again for the same registry", async () => {
    const registry = new CustomElementRegistry();
    await defineVioletSelect(registry);
    await expect(defineVioletSelect(registry)).resolves.toBeUndefined();
    await expect(defineVioletSelect()).resolves.toBeUndefined();

    expect(registry.get("violet-select")).toBe(VioletSelect);
    const observed = (VioletSelect as unknown as Observed).observedAttributes;
    expect(observed.filter((name) => name === "value")).toHaveLength(1);
  });

  it("leave a tag another class already holds in that registry", async () => {
    class Other extends HTMLElement {}
    const registry = new CustomElementRegistry();
    registry.define("violet-button", Other);

    await expect(defineVioletButton(registry)).resolves.toBeUndefined();
    expect(registry.get("violet-button")).toBe(Other);
  });
});

describe("defineVioletElement", () => {
  it("composes one definition per class across registries", async () => {
    class Probe extends FASTElement {}
    const partial = { name: "violet-define-probe", template: html`<span>probe</span>` };
    const first = new CustomElementRegistry();
    const second = new CustomElementRegistry();

    await defineVioletElement(Probe, partial, first);
    await defineVioletElement(Probe, partial, second);

    expect(first.get("violet-define-probe")).toBe(Probe);
    expect(second.get("violet-define-probe")).toBe(Probe);
    expect(customElements.get("violet-define-probe")).toBeUndefined();

    await defineVioletElement(Probe, partial, customElements);
    expect(customElements.get("violet-define-probe")).toBe(Probe);
  });
});
