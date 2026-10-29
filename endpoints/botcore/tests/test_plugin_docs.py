"""Tests for PluginRegistry docs support."""

from __future__ import annotations

from botcore.plugin import PluginRegistry


class TestPluginDocs:
    def test_add_docs_stores_topic(self):
        registry = PluginRegistry()
        registry.add_docs("lib", "# Library docs")
        assert "lib" in registry.docs
        assert registry.docs["lib"] == "# Library docs"

    def test_docs_from_multiple_plugins(self):
        registry = PluginRegistry()
        registry.add_docs("lib", "# Library docs")
        registry.add_docs("agent", "# Agent docs")
        assert len(registry.docs) == 2
        assert "lib" in registry.docs
        assert "agent" in registry.docs

    def test_docs_property_returns_copy(self):
        registry = PluginRegistry()
        registry.add_docs("lib", "# Library docs")
        docs = registry.docs
        docs["injected"] = "nope"
        assert "injected" not in registry.docs
