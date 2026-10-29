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

export function registerVioletIcon(definition: VioletIconDefinition): VioletIconDefinition {
    iconRegistry.set(definition.name, definition);
    return definition;
}

export function registerVioletIcons(definitions: readonly VioletIconDefinition[]): readonly VioletIconDefinition[] {
    definitions.forEach(registerVioletIcon);
    return definitions;
}

export function resolveVioletIcon(name: string): VioletIconDefinition | null {
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
}
