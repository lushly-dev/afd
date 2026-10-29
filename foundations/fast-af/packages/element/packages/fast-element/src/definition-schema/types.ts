/**
 * Core type definitions for the Definition Schema system.
 * Enables AI agents to query component capabilities via JSON introspection.
 *
 * @remarks
 * This module contains types only - no runtime code.
 */

/**
 * Represents the runtime type of a component property.
 * @public
 */
export type PropertyType =
    | "string"
    | "number"
    | "boolean"
    | "object"
    | "array"
    | "function"
    | "unknown";

/**
 * Schema describing a FASTElement component's full capabilities.
 * @public
 */
export interface ComponentSchema {
    /** The tag name or class name of the component */
    name: string;
    /** Semantic version of the component */
    version?: string;
    /** Human-readable description of the component */
    description?: string;
    /** Properties and attributes exposed by the component */
    properties: PropertySchema[];
    /** Custom events emitted by the component */
    events: EventSchema[];
    /** Named slots available in the component's template */
    slots: SlotSchema[];
    /** CSS custom properties (design tokens) used by the component */
    cssProperties: CSSPropertySchema[];
    /** Command palette actions (Phase 2) */
    commands?: CommandSchema[];
}

/**
 * Schema describing a single property or attribute on a component.
 * @public
 */
export interface PropertySchema {
    /** Property name on the class */
    name: string;
    /** Runtime type of the property value */
    type: PropertyType;
    /** HTML attribute name if exposed as an attribute */
    attribute?: string;
    /** Default value of the property */
    default?: unknown;
    /** Enumerated list of valid values (for string enums) */
    values?: string[];
    /** Whether the property is required */
    required?: boolean;
    /** Deprecation notice - true if deprecated, or a string describing the migration path */
    deprecated?: string | boolean;
    /** Accessibility hints for this property */
    aria?: AriaHint;
}

/**
 * Accessibility hints for a property.
 * @public
 */
export interface AriaHint {
    /** WAI-ARIA role associated with this property */
    role?: string;
    /** Whether the ARIA attribute is required for accessibility */
    required?: boolean;
    /** ID reference for aria-labelledby */
    labelledBy?: string;
    /** ID reference for aria-describedby */
    describedBy?: string;
    /** ID reference for aria-controls */
    controls?: string;
    /** Live region politeness setting */
    live?: "off" | "polite" | "assertive";
    /** Whether changes should be announced atomically */
    atomic?: boolean;
    /** Whether the element is in an expanded state */
    expanded?: boolean;
    /** Tri-state pressed value for toggle buttons */
    pressed?: "true" | "false" | "mixed";
}

/**
 * Schema describing a custom event emitted by a component.
 * @public
 */
export interface EventSchema {
    /** Event name (without 'on' prefix) */
    name: string;
    /** JSON Schema describing the event.detail payload */
    detail?: JSONSchema;
}

/**
 * Schema describing a slot in a component's template.
 * @public
 */
export interface SlotSchema {
    /** Slot name (empty string for default slot) */
    name: string;
    /** Human-readable description of expected slot content */
    description?: string;
}

/**
 * Schema describing a CSS custom property (design token).
 * @public
 */
export interface CSSPropertySchema {
    /** CSS custom property name (including -- prefix) */
    name: string;
    /** Default value of the custom property */
    default?: string;
    /** CSS syntax descriptor (e.g., "<color>", "<length>") */
    syntax?: string;
}

/**
 * Schema describing a command palette action.
 * Populated by the `command` decorator during schema extraction.
 * @public
 */
export interface CommandSchema {
    /** Unique command identifier */
    id: string;
    /** Method name on the component class */
    methodName: string;
    /** Human-readable label for the command */
    label?: string;
    /** Icon identifier for the command */
    icon?: string;
    /** Extended description for command palettes and documentation */
    description?: string;
    /** Grouping category for organization in UI */
    category?: string;
    /** Keyboard shortcut (e.g., "Ctrl+Shift+P") */
    keybinding?: string;
    /** JSON Schema for runtime parameter validation */
    parameters?: Record<string, unknown>;
    /** Context expression for conditional visibility (e.g., "editorFocus") */
    when?: string;
    /** If true, command is registered but hidden from UI */
    hidden?: boolean;
}

/**
 * Represents the difference between two component schemas.
 * Used to detect breaking changes between versions.
 * @public
 */
export interface SchemaDiff {
    /** Items added in the new schema */
    added: {
        properties: PropertySchema[];
        events: EventSchema[];
        slots: SlotSchema[];
    };
    /** Items removed from the old schema */
    removed: {
        properties: PropertySchema[];
        events: EventSchema[];
        slots: SlotSchema[];
    };
    /** Items that changed between schemas */
    changed: {
        properties: Array<{ before: PropertySchema; after: PropertySchema }>;
        events: Array<{ before: EventSchema; after: EventSchema }>;
    };
    /** Whether the diff contains breaking changes */
    breaking: boolean;
}

/**
 * JSON Schema type alias for event detail payloads.
 * @public
 */
export type JSONSchema = Record<string, unknown>;
