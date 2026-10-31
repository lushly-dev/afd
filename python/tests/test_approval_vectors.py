"""The language-neutral vectors in spec/vectors/approval-tokens.json.

spec/vectors/generate-approval-tokens.mjs builds them from the documented token format, with
canonical JSON from the TypeScript reference, so a Python token verifies in every other language
and theirs verify here (spec/command-metadata.md, "Approvals"; spec/vectors/README.md).
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any, Optional

import pytest

from afd import Actor, fixed_clock, success
from afd.core.commands import CommandContext, CommandDefinition
from afd.server import create_approval_middleware
from afd.server.approval import _canonical_json

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "spec" / "vectors" / "approval-tokens.json").read_text(
        encoding="utf-8"
    )
)


async def _handler(input: Any, context: Any = None):
    return success("ran")


def _actor(name: Optional[str]) -> Optional[Actor]:
    if name is None:
        return None
    actor = VECTORS["actors"][name]
    return Actor(
        kind=actor["kind"],
        id=actor.get("id"),
        label=actor.get("label"),
        on_behalf_of=actor.get("onBehalfOf"),
    )


def _gate(now: Optional[int] = None, secrets: Optional[list[str]] = None, replay: Optional[str] = None):
    """One middleware, as a case configures it, in front of a handler that reports it ran."""
    middleware = create_approval_middleware(
        secret=[VECTORS["secrets"][name] for name in (secrets or ["current"])],
        commands=[
            CommandDefinition(name=name, description=name, handler=_handler, approval="required")
            for name in VECTORS["commands"]
        ],
        clock=fixed_clock(VECTORS["now"] if now is None else now),
        **({"replay": replay} if replay else {}),
    )

    async def call(command: str, input: Any, actor: Optional[str], token: Optional[str] = None):
        async def next_fn():
            return success("ran")

        context = CommandContext(actor=_actor(actor), approval=token)
        return await middleware(command, input, context, next_fn)

    return call


def _outcome(result) -> str:
    if result.success:
        return "accepted"
    assert result.error.code == "APPROVAL_REQUIRED"
    return (result.error.details or {}).get("reason", "held")


def _payload(token: str) -> str:
    encoded = token.split(".")[1]
    return base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).decode("utf-8")


@pytest.mark.parametrize("binding", VECTORS["bindings"], ids=lambda case: case["description"])
async def test_binding(binding):
    assert _canonical_json(binding["input"]) == binding["canonicalInput"]

    held = await _gate()(binding["command"], binding["input"], binding["actor"])
    payload = _payload(held.error.details["approvalToken"])
    nonce = json.loads(payload)["n"]
    assert len(base64.urlsafe_b64decode(nonce + "==")) == 16
    assert payload == binding["payload"].replace(binding["nonce"], nonce)

    accepted = await _gate()(binding["command"], binding["input"], binding["actor"], binding["token"])
    assert _outcome(accepted) == "accepted"


@pytest.mark.parametrize("vector", VECTORS["verify"], ids=lambda case: case["description"])
async def test_verify(vector):
    call = _gate(vector.get("now"), vector.get("secrets"), vector.get("replay"))
    outcomes = [
        _outcome(await call(vector["command"], vector["input"], vector["actor"], vector["token"]))
        for _ in vector["expected"]
    ]
    assert outcomes == vector["expected"]
