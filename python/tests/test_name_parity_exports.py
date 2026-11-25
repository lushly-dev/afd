"""Tests for Python root and core name-parity exports (#550 PR 1)."""

from __future__ import annotations

import warnings

import pytest
from pydantic import ValidationError

import afd
import afd.core as afd_core


def test_wave2_handoff_exports_and_guards():
    expected_policy = afd.ReconnectPolicy(allowed=True, max_attempts=3, backoff_ms=1000)
    assert expected_policy == afd.DEFAULT_RECONNECT_POLICY
    assert afd.default_reconnect_policy is afd.DEFAULT_RECONNECT_POLICY
    assert afd_core.DEFAULT_RECONNECT_POLICY is afd.DEFAULT_RECONNECT_POLICY

    with pytest.raises(ValidationError):
        afd.DEFAULT_RECONNECT_POLICY.allowed = False  # type: ignore[misc]

    opts = afd.CreateHandoffOptions(
        protocol="websocket",
        endpoint="wss://example.com/ws",
        metadata=afd.HandoffMetadata(reconnect=afd.DEFAULT_RECONNECT_POLICY),
    )
    assert opts.protocol == "websocket"
    assert opts.metadata is not None and opts.metadata.reconnect == afd.DEFAULT_RECONNECT_POLICY

    assert afd.is_reconnect_policy(afd.DEFAULT_RECONNECT_POLICY) is True
    assert afd.is_reconnect_policy({"allowed": True, "maxAttempts": 3, "backoffMs": 500}) is True
    assert afd.is_reconnect_policy({"allowed": False, "max_attempts": 0}) is True
    assert afd.is_reconnect_policy({"allowed": "yes"}) is False
    assert afd.is_reconnect_policy({"allowed": True, "maxAttempts": True}) is False
    assert afd.is_reconnect_policy({"allowed": True, "backoffMs": "100"}) is False
    assert afd.is_reconnect_policy(None) is False


def test_wave2_mcp_error_codes_types_factories_and_guards():
    assert afd.McpErrorCodes.PARSE_ERROR == -32700
    assert afd.McpErrorCodes.INVALID_REQUEST == -32600
    assert afd.McpErrorCodes.METHOD_NOT_FOUND == -32601
    assert afd.McpErrorCodes.INVALID_PARAMS == -32602
    assert afd.McpErrorCodes.INTERNAL_ERROR == -32603
    assert afd.McpErrorCodes.HEADER_MISMATCH == -32020
    assert afd.McpErrorCodes.MISSING_REQUIRED_CLIENT_CAPABILITY == -32021
    assert afd.McpErrorCodes.UNSUPPORTED_PROTOCOL_VERSION == -32022
    assert afd.McpErrorCodes.SERVER_NOT_INITIALIZED == -32002
    assert afd.McpErrorCodes.REQUEST_CANCELLED == -32800
    assert afd.McpErrorCodes.CONTENT_MODIFIED == -32801

    r1 = afd.create_mcp_request("tools/list")
    r2 = afd.create_mcp_request("tools/call", {"name": "ping"})
    r3 = afd.create_mcp_request("tools/call", {"name": "ping"}, id="custom-id")
    assert isinstance(r1.id, int) and isinstance(r2.id, int) and r2.id > r1.id
    assert r3.id == "custom-id"
    assert afd.is_mcp_request(r1) is True
    assert afd.is_mcp_request({"jsonrpc": "2.0", "id": "a", "method": "ping"}) is True
    assert afd.is_mcp_request({"jsonrpc": "2.0", "method": "ping"}) is False

    resp = afd.create_mcp_response(1, {"ok": True})
    err = afd.create_mcp_error_response(
        1, afd.McpErrorCodes.METHOD_NOT_FOUND, "missing", {"detail": "no-tool"}
    )
    assert err.error.data == {"detail": "no-tool"}
    assert afd.is_mcp_response(resp) is True
    assert afd.is_mcp_response(err) is True
    assert afd.is_mcp_response({"jsonrpc": "2.0", "id": 1, "result": {}}) is True
    assert afd.is_mcp_response({"jsonrpc": "2.0", "id": 1}) is False

    notif = afd.McpNotification(method="notifications/progress", params={"progress": 1})
    assert afd.is_mcp_notification(notif) is True
    assert afd.is_mcp_notification({"jsonrpc": "2.0", "method": "notifications/x"}) is True
    assert afd.is_mcp_notification({"jsonrpc": "2.0", "id": 1, "method": "ping"}) is False

    tools_list = afd.McpToolsListResult(tools=[afd.tool_definition("ping", "Ping")])
    assert len(tools_list.tools) == 1
    assert afd.McpTool is afd.ToolDefinition
    assert afd.McpError is afd.JsonRpcError
    assert afd.McpToolCallParams is afd.ToolCallParams
    assert afd.McpToolCallResult is afd.ToolResult
    assert afd.McpTextContent is afd.TextContent
    assert afd.McpImageContent is afd.ImageContent
    assert afd.McpResourceContent is afd.EmbeddedResource
    assert afd.McpInitializeParams is afd.InitializeParams
    assert afd.McpInitializeResult is afd.InitializeResult


def test_wave3_non_colliding_pipeline_exports_and_condition_guards():
    cases = [
        (
            afd.is_exists_condition,
            afd.PipelineConditionExists(**{"$exists": "$prev.id"}),
            {"$exists": "$prev.id"},
        ),
        (
            afd.is_eq_condition,
            afd.PipelineConditionEq(**{"$eq": ("$prev.x", 1)}),
            {"$eq": ["$prev.x", 1]},
        ),
        (
            afd.is_ne_condition,
            afd.PipelineConditionNe(**{"$ne": ("$prev.x", 1)}),
            {"$ne": ["$prev.x", 1]},
        ),
        (
            afd.is_gt_condition,
            afd.PipelineConditionGt(**{"$gt": ("$prev.x", 1)}),
            {"$gt": ["$prev.x", 1]},
        ),
        (
            afd.is_gte_condition,
            afd.PipelineConditionGte(**{"$gte": ("$prev.x", 1)}),
            {"$gte": ["$prev.x", 1]},
        ),
        (
            afd.is_lt_condition,
            afd.PipelineConditionLt(**{"$lt": ("$prev.x", 1)}),
            {"$lt": ["$prev.x", 1]},
        ),
        (
            afd.is_lte_condition,
            afd.PipelineConditionLte(**{"$lte": ("$prev.x", 1)}),
            {"$lte": ["$prev.x", 1]},
        ),
        (
            afd.is_and_condition,
            afd.PipelineConditionAnd(**{"$and": [{"$exists": "$prev.a"}]}),
            {"$and": [{"$exists": "$prev.a"}]},
        ),
        (
            afd.is_or_condition,
            afd.PipelineConditionOr(**{"$or": [{"$exists": "$prev.a"}]}),
            {"$or": [{"$exists": "$prev.a"}]},
        ),
        (
            afd.is_not_condition,
            afd.PipelineConditionNot(**{"$not": {"$exists": "$prev.a"}}),
            {"$not": {"$exists": "$prev.a"}},
        ),
    ]
    for guard, model_cond, dict_cond in cases:
        assert guard(model_cond) is True
        assert guard(dict_cond) is True
        assert guard({"$exists": "$a", "$eq": ["$a", 1]}) is False
        assert guard("not-a-condition") is False

    # Core PipelineStep and PipelineResult are exported from afd.core, while root afd keeps
    # the #1758 one-minor deprecation shims untouched until PR 2.
    req = afd.create_pipeline([afd_core.PipelineStep(command="ping-ok")])
    assert afd.is_pipeline_request(req) is True
    assert afd.get_nested_value({"a": {"b": 42}}, "a.b") == 42

    deprecated_targets = {
        "CommandContext": afd.DirectContext,
        "CommandDefinition": afd.DirectCommandDefinition,
        "CommandParameter": afd.DirectCommandParameter,
        "PipelineStep": afd.DirectPipelineStep,
        "PipelineResult": afd.DirectPipelineResult,
    }
    for name, expected_cls in deprecated_targets.items():
        with pytest.warns(DeprecationWarning):
            assert getattr(afd, name) is expected_cls


def test_wave4_similarity_and_execution_failure_exports():
    assert afd.MAX_SIMILARITY_INPUT_LENGTH == 128
    assert afd.calculate_similarity("todo-create", "todo-create") == 1.0
    assert afd.find_similar_tools("todo-creat", ["todo-create", "user-delete"]) == ["todo-create"]
    assert afd.truncate_name("short") == "short"
    assert afd.execution_failure is afd_core.execution_failure

    redacted = afd.execution_failure(RuntimeError("secret"), dev_mode=False)
    assert redacted.success is False
    assert redacted.error is not None and "secret" not in redacted.error.message
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        assert afd.calculate_similarity("a", "b") == 0.0
