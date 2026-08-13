from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import pytest

from bim_review_agent.application.agent.schemas import (
    AgentDefinition,
    DelegateAction,
    FinalAction,
    ProviderRequest,
    RecalledEpisode,
    ToolCallAction,
    ToolDescriptor,
    ToolEffect,
    ToolObservation,
)
from bim_review_agent.infrastructure.config import Settings
from bim_review_agent.infrastructure.providers import (
    OpenAIResponsesProvider,
    ProviderAvailability,
    ProviderError,
    ProviderSelectionError,
    ScriptedModelProvider,
    build_provider_registry,
)

TEST_CREDENTIAL = "test-only-provider-credential"


def _request(
    *,
    allowed_specialists: tuple[str, ...] = (),
    observations: tuple[ToolObservation, ...] = (),
    episodes: tuple[RecalledEpisode, ...] = (),
) -> ProviderRequest:
    return ProviderRequest(
        run_id="run-test",
        objective="Inspect the model and use only deterministic review evidence.",
        step=2,
        agent=AgentDefinition(
            agent_id="test-manager",
            name="Test manager",
            version="1.0",
            instructions="Use only registered capabilities.",
            allowed_tools=("inspect_model",),
            allowed_specialists=allowed_specialists,
            max_delegations=len(allowed_specialists),
        ),
        tools=(
            ToolDescriptor(
                name="inspect_model",
                version="1.0",
                description="Read a safe IFC inventory.",
                effect=ToolEffect.PURE_READ,
                input_schema={
                    "type": "object",
                    "properties": {"include_entity_counts": {"type": "boolean"}},
                    "additionalProperties": False,
                },
                output_schema={"type": "object"},
            ),
        ),
        observations=observations,
        episodes=episodes,
    )


def _provider(
    response: dict[str, Any],
    *,
    capture: dict[str, Any] | None = None,
) -> OpenAIResponsesProvider:
    def transport(
        url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
        timeout: float,
    ) -> dict[str, Any]:
        if capture is not None:
            capture.update({"url": url, "headers": headers, "payload": payload, "timeout": timeout})
        return response

    return OpenAIResponsesProvider(
        model_id="test-model",
        base_url="https://provider.example/v1",
        transport=transport,
    )


def _function_call(name: str, arguments: dict[str, Any], call_id: str = "call-1") -> dict[str, Any]:
    return {
        "type": "function_call",
        "call_id": call_id,
        "name": name,
        "arguments": json.dumps(arguments),
    }


def test_responses_adapter_translates_a_tool_call_without_leaking_the_credential(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BIM_REVIEW_MODEL_API_KEY", TEST_CREDENTIAL)
    capture: dict[str, Any] = {}
    provider = _provider(
        {"output": [_function_call("inspect_model", {"include_entity_counts": True})]},
        capture=capture,
    )

    action = provider.next_action(_request())

    assert isinstance(action, ToolCallAction)
    assert action.tool_name == "inspect_model"
    assert action.arguments == {"include_entity_counts": True}
    assert capture["url"] == "https://provider.example/v1/responses"
    assert capture["headers"]["Authorization"] == f"Bearer {TEST_CREDENTIAL}"
    assert capture["payload"]["store"] is False
    assert capture["payload"]["tool_choice"] == "required"
    assert capture["payload"]["parallel_tool_calls"] is False
    assert TEST_CREDENTIAL not in json.dumps(capture["payload"])
    assert capture["timeout"] == 30


def test_responses_adapter_sends_only_the_redacted_episode_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BIM_REVIEW_MODEL_API_KEY", TEST_CREDENTIAL)
    capture: dict[str, Any] = {}
    episode = RecalledEpisode(
        episode_id="episode-1",
        agent_run_id="prior-run-1",
        source_sha256="a" * 64,
        objective_sha256="b" * 64,
        mode="inventory_only",
        state="COMPLETED",
        stop_reason="FINAL_OUTPUT",
        created_at=datetime.now(UTC),
    )
    provider = _provider(
        {"output": [_function_call("inspect_model", {"include_entity_counts": True})]},
        capture=capture,
    )

    provider.next_action(_request(episodes=(episode,)))

    public_context = json.loads(capture["payload"]["input"][0]["content"])
    assert public_context["recalled_episodes"] == [episode.model_dump(mode="json")]
    serialized = json.dumps(public_context)
    assert "filename" not in serialized
    assert "final_response" not in serialized
    assert "findings" not in serialized


def test_responses_adapter_accepts_only_a_tool_created_review_reference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BIM_REVIEW_MODEL_API_KEY", TEST_CREDENTIAL)
    request = _request(
        observations=(
            ToolObservation(
                call_id="tool-1",
                tool_name="run_deterministic_review",
                output={"review_run_id": "review-canonical"},
            ),
        )
    )
    provider = _provider(
        {
            "output": [
                _function_call(
                    "finalize_agent_response",
                    {
                        "message": "The deterministic review is ready.",
                        "linked_review_run_id": "review-canonical",
                    },
                )
            ]
        }
    )

    action = provider.next_action(request)

    assert isinstance(action, FinalAction)
    assert action.linked_review_run_id == "review-canonical"
    assert action.data == {"source": "model_provider", "verdict_authority": False}


def test_responses_adapter_rejects_a_fabricated_review_reference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BIM_REVIEW_MODEL_API_KEY", TEST_CREDENTIAL)
    provider = _provider(
        {
            "output": [
                _function_call(
                    "finalize_agent_response",
                    {
                        "message": "Fabricated link",
                        "linked_review_run_id": "review-not-created-by-a-tool",
                    },
                )
            ]
        }
    )

    with pytest.raises(ProviderError, match="no tool or specialist created"):
        provider.next_action(_request())


def test_responses_adapter_translates_parallel_specialist_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BIM_REVIEW_MODEL_API_KEY", TEST_CREDENTIAL)
    provider = _provider(
        {
            "output": [
                _function_call(
                    "delegate__model-inspector",
                    {"objective": "Inspect schema and inventory."},
                    "inspect-task",
                ),
                _function_call(
                    "delegate__rule-review-specialist",
                    {"objective": "Run deterministic checks.", "input": {"scope": "doors"}},
                    "review-task",
                ),
            ]
        }
    )

    action = provider.next_action(
        _request(allowed_specialists=("model-inspector", "rule-review-specialist"))
    )

    assert isinstance(action, DelegateAction)
    assert [task.task_id for task in action.tasks] == ["inspect-task", "review-task"]
    assert [task.specialist_id for task in action.tasks] == [
        "model-inspector",
        "rule-review-specialist",
    ]
    assert action.tasks[1].input == {"scope": "doors"}


def test_responses_adapter_rejects_unknown_specialist_and_duplicate_task_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BIM_REVIEW_MODEL_API_KEY", TEST_CREDENTIAL)
    unknown = _provider(
        {
            "output": [
                _function_call(
                    "delegate__unknown-specialist",
                    {"objective": "Attempt an unknown delegation."},
                )
            ]
        }
    )
    duplicate = _provider(
        {
            "output": [
                _function_call(
                    "delegate__model-inspector",
                    {"objective": "First task."},
                    "duplicate-id",
                ),
                _function_call(
                    "delegate__rule-review-specialist",
                    {"objective": "Second task."},
                    "duplicate-id",
                ),
            ]
        }
    )
    request = _request(allowed_specialists=("model-inspector", "rule-review-specialist"))

    with pytest.raises(ProviderError, match="unknown specialist"):
        unknown.next_action(request)
    with pytest.raises(ProviderError, match="invalid delegation set"):
        duplicate.next_action(request)


@pytest.mark.parametrize(
    "response, error",
    [
        ({"output": []}, "no structured Agent action"),
        (
            {"output": [_function_call("unknown_tool", {})]},
            "unknown tool",
        ),
        (
            {
                "output": [
                    _function_call("inspect_model", {}),
                    _function_call("finalize_agent_response", {"message": "Mixed"}, "call-2"),
                ]
            },
            "mixed actions",
        ),
        (
            {
                "output": [
                    {
                        "type": "function_call",
                        "call_id": "call-1",
                        "name": "inspect_model",
                        "arguments": "not-json",
                    }
                ]
            },
            "invalid function arguments",
        ),
    ],
)
def test_responses_adapter_fails_closed_on_malformed_actions(
    monkeypatch: pytest.MonkeyPatch,
    response: dict[str, Any],
    error: str,
) -> None:
    monkeypatch.setenv("BIM_REVIEW_MODEL_API_KEY", TEST_CREDENTIAL)

    with pytest.raises(ProviderError, match=error):
        _provider(response).next_action(_request())


def test_responses_adapter_requires_a_credential_before_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("BIM_REVIEW_MODEL_API_KEY", raising=False)
    called = False

    def transport(
        _url: str,
        _headers: dict[str, str],
        _payload: dict[str, Any],
        _timeout: float,
    ) -> dict[str, Any]:
        nonlocal called
        called = True
        return {"output": []}

    provider = OpenAIResponsesProvider(
        model_id="test-model",
        base_url="https://provider.example/v1",
        transport=transport,
    )

    with pytest.raises(ProviderError, match="credential is not configured"):
        provider.next_action(_request())
    assert called is False


@pytest.mark.parametrize(
    "base_url",
    [
        "http://provider.example/v1",
        "ftp://provider.example/v1",
        "https://user:password@provider.example/v1",
        "https://provider.example/v1?credential=value",
    ],
)
def test_responses_adapter_rejects_unsafe_base_urls(base_url: str) -> None:
    with pytest.raises(ValueError, match="base URL"):
        OpenAIResponsesProvider(model_id="test-model", base_url=base_url)


def test_responses_adapter_allows_loopback_http_for_a_local_compatible_service() -> None:
    provider = OpenAIResponsesProvider(
        model_id="local-model",
        base_url="http://127.0.0.1:8080/v1",
    )

    assert provider.responses_url == "http://127.0.0.1:8080/v1/responses"


def _settings(*, enabled: bool) -> Settings:
    return Settings(
        external_provider_enabled=enabled,
        external_provider_base_url="https://provider.example/v1",
        external_provider_model="test-model",
        external_provider_timeout_seconds=15,
        openrouter_enabled=False,
    )


def _local_provider() -> ScriptedModelProvider:
    return ScriptedModelProvider(lambda _request: FinalAction(message="Local result."))


def test_provider_registry_keeps_auto_local_and_reports_disabled_external_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("BIM_REVIEW_MODEL_API_KEY", raising=False)
    registry = build_provider_registry(_settings(enabled=False))
    local = _local_provider()
    descriptors = registry.catalogue()

    assert [descriptor.provider_id for descriptor in descriptors] == [
        "scripted",
        "openai-responses",
        "openrouter",
    ]
    assert descriptors[0].availability is ProviderAvailability.AVAILABLE
    assert descriptors[1].availability is ProviderAvailability.DISABLED
    assert descriptors[2].availability is ProviderAvailability.DISABLED
    assert registry.resolve("auto", local_provider=local) is local

    with pytest.raises(ProviderSelectionError) as disabled:
        registry.resolve("openai-responses", local_provider=local)
    assert disabled.value.code == "provider_disabled"
    assert disabled.value.status_code == 503


def test_provider_registry_exposes_availability_without_exposing_the_credential(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BIM_REVIEW_MODEL_API_KEY", TEST_CREDENTIAL)
    registry = build_provider_registry(_settings(enabled=True))
    local = _local_provider()
    catalogue_json = json.dumps(
        [descriptor.model_dump(mode="json") for descriptor in registry.catalogue()]
    )

    selected = registry.resolve("openai-responses", local_provider=local)

    assert isinstance(selected, OpenAIResponsesProvider)
    assert registry.resolve("auto", local_provider=local) is local
    assert TEST_CREDENTIAL not in catalogue_json
    assert "Authorization" not in catalogue_json


def test_provider_registry_reports_incomplete_external_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("BIM_REVIEW_MODEL_API_KEY", raising=False)
    registry = build_provider_registry(_settings(enabled=True))
    local = _local_provider()
    external = registry.catalogue()[1]

    assert external.enabled is True
    assert external.configured is False
    assert external.availability is ProviderAvailability.UNAVAILABLE
    with pytest.raises(ProviderSelectionError) as unavailable:
        registry.resolve("openai-responses", local_provider=local)
    assert unavailable.value.code == "provider_unavailable"
    assert unavailable.value.status_code == 503


def test_provider_registry_requires_an_explicit_external_model_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BIM_REVIEW_MODEL_API_KEY", TEST_CREDENTIAL)
    registry = build_provider_registry(
        Settings(
            external_provider_enabled=True,
            external_provider_base_url="https://provider.example/v1",
            external_provider_model="",
            openrouter_enabled=False,
        )
    )

    external = registry.catalogue()[1]
    assert external.model_id == "not-configured"
    assert external.availability is ProviderAvailability.UNAVAILABLE
    assert external.configured is False


def test_provider_registry_fails_closed_for_unknown_provider() -> None:
    registry = build_provider_registry(_settings(enabled=False))

    with pytest.raises(ProviderSelectionError) as unknown:
        registry.resolve("unregistered-provider", local_provider=_local_provider())

    assert unknown.value.code == "provider_not_found"
    assert unknown.value.status_code == 404
