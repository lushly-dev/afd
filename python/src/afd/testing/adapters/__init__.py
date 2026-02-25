"""
App adapter registry for AFD testing.

Provides adapter abstractions for connecting the JTBD testing framework
to different AFD applications.
"""

from afd.testing.adapters.generic import create_generic_adapter
from afd.testing.adapters.registry import (
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
	AdapterRegistryOptions,
	AppAdapter,
	AppliedCommand,
	ApplyFixtureResult,
	CommandsConfig,
	ErrorsConfig,
	FixtureConfig,
	FixtureValidationResult,
	JobsConfig,
	AdapterCliConfig,
)

__all__ = [
	"AdapterCliConfig",
	"AdapterContext",
	"AdapterRegistryOptions",
	"AppAdapter",
	"AppliedCommand",
	"ApplyFixtureResult",
	"CommandsConfig",
	"ErrorsConfig",
	"FixtureConfig",
	"FixtureValidationResult",
	"JobsConfig",
	"create_adapter_registry",
	"create_generic_adapter",
	"detect_adapter",
	"get_adapter",
	"get_global_registry",
	"list_adapters",
	"register_adapter",
	"reset_global_registry",
	"set_global_registry",
]
