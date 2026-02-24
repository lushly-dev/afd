"""
App Adapter system for AFD testing.

Provides an adapter pattern for integrating JTBD testing with different
AFD applications. Each app provides an adapter that knows how to apply
fixtures, list commands, describe errors, and define jobs.
"""

from afd.testing.adapters.generic import (
    GenericAdapterOptions,
    create_generic_adapter,
    generic_adapter,
)
from afd.testing.adapters.registry import (
    AdapterRegistry,
    AdapterRegistryOptions,
    create_adapter_registry,
    detect_adapter,
    get_adapter,
    get_global_registry,
    list_adapters,
    register_adapter,
    reset_global_registry,
    set_global_registry,
)
from afd.testing.adapters.types import (
    AdapterContext,
    AppAdapter,
    AppliedCommand,
    ApplyFixtureResult,
    CliConfig,
    CommandsConfig,
    ErrorsConfig,
    FixtureConfig,
    FixtureValidationResult,
    JobsConfig,
)

__all__ = [
    # Types
    'AppAdapter',
    'CliConfig',
    'FixtureConfig',
    'ApplyFixtureResult',
    'AppliedCommand',
    'FixtureValidationResult',
    'CommandsConfig',
    'ErrorsConfig',
    'JobsConfig',
    'AdapterContext',
    # Registry
    'AdapterRegistry',
    'AdapterRegistryOptions',
    'create_adapter_registry',
    'get_global_registry',
    'set_global_registry',
    'reset_global_registry',
    'register_adapter',
    'get_adapter',
    'list_adapters',
    'detect_adapter',
    # Generic
    'GenericAdapterOptions',
    'create_generic_adapter',
    'generic_adapter',
]
