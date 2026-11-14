"""botcore-factory: the software factory's merge lane as a botcore plugin.

Serve it through botcore's managed host, ``trusted-local`` profile::

    from botcore import ExecutionContext
    from botcore_factory import build_factory_host

    host = build_factory_host("factory", ExecutionContext(root, profile="trusted-local"))

``factory`` serves every command (the foreman and the owner); ``factory-cell`` serves what a
cell calls. The repository adapter is ``[plugins.factory]`` in the target's ``botcore.toml``.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from botcore.context import current_context

from botcore_factory.adapter import FactoryConfig
from botcore_factory.commands import POLICIES, make_commands
from botcore_factory.docs import DOCS
from botcore_factory.hosts import CELL_COMMANDS, build_factory_host
from botcore_factory.runtime import Factory, bind, current_bindings

if TYPE_CHECKING:
    from botcore.plugin import PluginRegistry

__all__ = ["CELL_COMMANDS", "FactoryConfig", "FactoryPlugin", "bind", "build_factory_host"]
__version__ = "0.1.0"


class _HostFactory:
    """One host's Factory, bound when the host registers the plugin and built on first use.

    The target is the host's ExecutionContext; the world is the one ``bind`` supplied while the
    host was built, else the real world of that target.
    """

    def __init__(self, config: FactoryConfig) -> None:
        context = current_context()
        bindings = current_bindings()
        self._config = config
        self._target = context.target if context else None
        self._world = bindings.world
        self._state_base = bindings.state_base
        self._factory: Factory | None = None

    def get(self) -> Factory:
        if self._factory is None:
            target = self._target
            if target is None:  # A legacy surface registered the plugin outside any host.
                from botcore.utils.workspace import find_workspace

                target = Path(find_workspace())
            world = self._world
            if world is None:
                from botcore_factory.real_world import real_world

                world = real_world(target)
            self._factory = Factory(world, self._config, target, self._state_base)
        return self._factory


class FactoryPlugin:
    """BotCorePlugin for the software factory."""

    # Audited for per-host state: nothing module-global; each host binds its own Factory.
    host_context_safe = True

    def __init__(self) -> None:
        self._config = FactoryConfig()

    def config_schema(self) -> type[FactoryConfig]:
        return FactoryConfig

    def configure(self, config: FactoryConfig | dict) -> None:
        self._config = config if isinstance(config, FactoryConfig) else FactoryConfig(**config)

    def register(self, registry: PluginRegistry) -> None:
        registry.add_commands(make_commands(_HostFactory(self._config).get))
        registry.add_policies(POLICIES)
        registry.add_docs("factory", DOCS)
