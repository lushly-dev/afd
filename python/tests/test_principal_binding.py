"""The principal binding (spec/authorization.md, M8) against the ``principalBindings`` cases of
``spec/authorization.json``."""

import json
from pathlib import Path

import pytest

from afd.core.actor import Actor
from afd.server import PrincipalCredentials, credentials_binding, principal_binding

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
    with pytest.raises(TypeError):
        PrincipalCredentials(issuer=1, subject="s", client_id="c")
    with pytest.raises(TypeError):
        PrincipalCredentials(issuer="i", subject="", client_id="c")
    with pytest.raises(TypeError):
        principal_binding({"kind": "agent"})


def test_a_component_the_sdk_token_lacks_is_null():
    credentials = PrincipalCredentials(issuer=None, subject=None, client_id="todo-agent")
    assert credentials_binding(credentials) == '{"clientId":"todo-agent","issuer":null,"subject":null}'
