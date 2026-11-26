// The observable subpath, not the root: importing the registry must not need a DOM.
import { Observable } from "@lushly-dev/fast-element/observable.js";

export type VioletIconSource = {
  id: string;
  title: string;
  license: string;
  attribution: string;
  homepage: string;
  notes: string;
};

export type VioletIconDefinition = {
  name: string;
  svg: string;
  sourceId: string;
  originalFile: string;
};

const iconRegistry = new Map<string, VioletIconDefinition>();

/**
 * What a binding that resolves an icon observes, so an icon registered after a violet-icon has
 * rendered (a component that registers in connectedCallback, or an app that registers late)
 * replaces the fallback glyph instead of leaving it.
 */
const registryChanges = { names: 0 };

function notifyRegistryChange(): void {
  registryChanges.names += 1;
  Observable.notify(registryChanges, "names");
}

export function registerVioletIcon(definition: VioletIconDefinition): VioletIconDefinition {
  const current = iconRegistry.get(definition.name);
  iconRegistry.set(definition.name, definition);
  // Components register their icons each time they connect: only a new or changed one re-renders.
  if (current?.svg !== definition.svg) {
    notifyRegistryChange();
  }
  return definition;
}

export function registerVioletIcons(
  definitions: readonly VioletIconDefinition[],
): readonly VioletIconDefinition[] {
  definitions.forEach(registerVioletIcon);
  return definitions;
}

export function resolveVioletIcon(name: string): VioletIconDefinition | null {
  Observable.track(registryChanges, "names");
  return iconRegistry.get(name) ?? null;
}

export function hasVioletIcon(name: string): boolean {
  return iconRegistry.has(name);
}

export function listRegisteredVioletIcons(): string[] {
  return [...iconRegistry.keys()].sort((a, b) => a.localeCompare(b));
}

export function clearVioletIconRegistryForTesting(): void {
  iconRegistry.clear();
  notifyRegistryChange();
}
