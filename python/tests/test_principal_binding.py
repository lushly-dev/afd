"""The principal binding (spec/authorization.md, M8) against the ``principalBindings`` cases of
``spec/authorization.json``."""

import json
from pathlib import Path

import pytest

from afd.core.actor import Actor
from afd.server import (
    IncompleteCredentials,
    PrincipalCredentials,
    credentials_binding,
    principal_binding,
)

CASES = json.loads(
    (Path(__file__).resolve().parents[2] / "spec" / "authorization.json").read_text(encoding="utf-8")
)["principalBindings"]


def _actor(value):
    if value is None:
        return None
    return Actor(
        kind=value["kind"],
        id=value.get("id"),
        label=value.get("label"),
        on_behalf_of=value.get("onBehalfOf"),
    )


def test_loads_the_cases():
    assert len(CASES) >= 7


@pytest.mark.parametrize("case", CASES, ids=[case["description"] for case in CASES])
def test_principal_binding_case(case):
    actor = _actor(case["actor"])
    assert principal_binding(actor, case["credentials"]) == case["binding"]
    assert credentials_binding(case["credentials"]) == case["credentialsBinding"]
    if case["credentials"] is not None:
        credentials = PrincipalCredentials(
            issuer=case["credentials"]["issuer"],
            subject=case["credentials"]["subject"],
            client_id=case["credentials"]["clientId"],
        )
        assert principal_binding(actor, credentials) == case["binding"]
        assert credentials_binding(credentials) == case["credentialsBinding"]


def test_refuses_credentials_it_could_not_bind():
    actor = Actor(kind="agent", id="a")
    for credentials in (
        {"issuer": "https://auth.example.com", "subject": "user-1"},
        {"issuer": "https://auth.example.com", "subject": "", "clientId": "c"},
        {"issuer": "https://auth.example.com", "subject": 1, "clientId": "c"},
        "user-1",
    ):
        with pytest.raises(TypeError):
            principal_binding(actor, credentials)
        with pytest.raises(TypeError):
            credentials_binding(credentials)
    for issuer, subject, client_id in (
        (1, "s", "c"),
        ("i", "", "c"),
        (None, "s", "c"),
        ("i", None, "c"),
        ("i", "s", ""),
    ):
        with pytest.raises(IncompleteCredentials, match="^credentials lack an issuer, subject or client id$"):
            PrincipalCredentials(issuer=issuer, subject=subject, client_id=client_id)
    with pytest.raises(TypeError):
        principal_binding({"kind": "agent"})


def test_no_credentials_bind_the_actor_alone():
    assert principal_binding(Actor(kind="agent", id="a"), None) == (
        '{"actor":{"id":"a","kind":"agent"},"credentials":null}'
    )
