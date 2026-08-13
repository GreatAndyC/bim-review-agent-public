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
)
from bim_review_agent.infrastructure.config import Settings
from bim_review_agent.infrastructure.providers import (
    CatalogueSource,
    OpenRouterCatalogueService,
    OpenRouterChatProvider,
    ProviderAvailability,
    ProviderError,
    ProviderSelectionError,
    ScriptedModelProvider,
    build_provider_registry,
)

TEST_CREDENTIAL = "test-only-openrouter-credential"


def _request(
    *,
    allowed_specialists: tuple[str, ...] = (),
    episodes: tuple[RecalledEpisode, ...] = (),
) -> ProviderRequest:
    return ProviderRequest(
        run_id="run-openrouter-test",
        objective="Inspect the model and rely only on deterministic review evidence.",
        step=1,
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
        observations=(),
        episodes=episodes,
    )


def _tool_call(
    name: str,
    arguments: dict[str, Any],
    call_id: str = "call-1",
) -> dict[str, Any]:
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments)},
    }


def _completion(*calls: dict[str, Any]) -> dict[str, Any]:
    return {"choices": [{"message": {"tool_calls": list(calls)}}]}


def _catalogue_item(index: int, *, supported: list[Any] | None = None) -> dict[str, Any]:
    return {
        "id": f"vendor/model-{index}",
        "name": f"Model {index}",
        "context_length": 128_000 + index,
        "supported_parameters": supported
        if supported is not None
        else ["tools", "tool_choice", "temperature"],
        "pricing": {"prompt": "0.000001", "completion": "0.000002"},
    }


def test_catalogue_starts_from_a_network_free_dated_fallback() -> None:
    called = False

    def transport(
        _url: str,
        _headers: dict[str, str],
        _timeout: float,
    ) -> dict[str, Any]:
        nonlocal called
        called = True
        return {"data": []}

    service = OpenRouterCatalogueService(transport=transport)

    catalogue = service.current()

    assert called is False
    assert catalogue.source is CatalogueSource.BUNDLED_FALLBACK
    assert catalogue.as_of == datetime(2026, 8, 9, tzinfo=UTC)
    assert len(catalogue.models) == 10
    assert catalogue.models[0].model_id == "deepseek/deepseek-v4-flash-0731"
    assert catalogue.models[0].rank == 1
    assert all(
        {"tools", "tool_choice"}.issubset(model.supported_parameters) for model in catalogue.models
    )


def test_catalogue_refresh_is_explicit_ranked_and_filters_incompatible_models() -> None:
    capture: dict[str, Any] = {}
    incompatible = _catalogue_item(0, supported=["tools"])
    malformed = _catalogue_item(99, supported=["tools", "tool_choice", {}])
    malformed["pricing"]["prompt"] = "not-a-price"

    def transport(
        url: str,
        headers: dict[str, str],
        timeout: float,
    ) -> dict[str, Any]:
        capture.update({"url": url, "headers": headers, "timeout": timeout})
        return {
            "data": [incompatible, malformed] + [_catalogue_item(index) for index in range(1, 12)]
        }

    service = OpenRouterCatalogueService(
        base_url="https://openrouter.example/api/v1",
        timeout_seconds=7,
        transport=transport,
    )

    catalogue = service.refresh()

    assert catalogue.source is CatalogueSource.OPENROUTER_LIVE
    assert [model.model_id for model in catalogue.models] == [
        f"vendor/model-{index}" for index in range(1, 11)
    ]
    assert [model.rank for model in catalogue.models] == list(range(1, 11))
    assert catalogue.models[0].prompt_price_per_million == 1
    assert catalogue.models[0].completion_price_per_million == 2
    assert service.current() is catalogue
    assert capture["url"] == (
        "https://openrouter.example/api/v1/models?supported_parameters=tools&sort=top-weekly"
    )
    assert capture["headers"] == {
        "Accept": "application/json",
        "User-Agent": "bim-review-agent/0.1",
    }
    assert capture["timeout"] == 7


def test_failed_catalogue_refresh_preserves_the_last_valid_snapshot() -> None:
    def transport(
        _url: str,
        _headers: dict[str, str],
        _timeout: float,
    ) -> dict[str, Any]:
        return {"data": [_catalogue_item(1)]}

    service = OpenRouterCatalogueService(transport=transport)
    original = service.current()

    with pytest.raises(ProviderError, match="fewer than ten"):
        service.refresh()

    assert service.current() is original


def test_chat_adapter_translates_tool_calls_and_applies_privacy_routing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BIM_REVIEW_OPENROUTER_API_KEY", TEST_CREDENTIAL)
    capture: dict[str, Any] = {}

    def transport(
        url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
        timeout: float,
    ) -> dict[str, Any]:
        capture.update({"url": url, "headers": headers, "payload": payload, "timeout": timeout})
        return _completion(_tool_call("inspect_model", {"include_entity_counts": True}))

    provider = OpenRouterChatProvider(
        model_id="vendor/tool-model",
        base_url="https://openrouter.example/api/v1",
        timeout_seconds=12,
        transport=transport,
    )

    action = provider.next_action(_request())

    assert isinstance(action, ToolCallAction)
    assert action.tool_name == "inspect_model"
    assert action.arguments == {"include_entity_counts": True}
    assert capture["url"] == "https://openrouter.example/api/v1/chat/completions"
    assert capture["headers"]["Authorization"] == f"Bearer {TEST_CREDENTIAL}"
    assert capture["headers"]["HTTP-Referer"] == (
        "https://github.com/GreatAndyC/bim-review-agent-public"
    )
    assert capture["headers"]["X-OpenRouter-Title"] == "BIM Review Agent"
    assert capture["payload"]["model"] == "vendor/tool-model"
    assert capture["payload"]["tool_choice"] == "required"
    assert capture["payload"]["parallel_tool_calls"] is False
    assert capture["payload"]["provider"] == {
        "require_parameters": True,
        "data_collection": "deny",
        "zdr": True,
    }
    assert TEST_CREDENTIAL not in json.dumps(capture["payload"])
    assert capture["timeout"] == 12


@pytest.mark.parametrize(
    ("response", "message"),
    [
        ({"choices": "not-a-list"}, "no completion choice"),
        ({"choices": []}, "no completion choice"),
        ({"choices": [{}]}, "no assistant message"),
        ({"choices": [{"message": "not-an-object"}]}, "no assistant message"),
        (
            {"choices": [{"message": {"tool_calls": "not-a-list"}}]},
            "no structured Agent action",
        ),
        ({"choices": [{"message": {"tool_calls": [None]}}]}, "invalid tool-call object"),
        (
            {"choices": [{"message": {"tool_calls": [{"function": "not-an-object"}]}}]},
            "invalid function object",
        ),
        (
            {
                "choices": [
                    {
                        "message": {
                            "tool_calls": [{"function": {"name": "inspect_model", "arguments": {}}}]
                        }
                    }
                ]
            },
            "invalid function call",
        ),
    ],
)
def test_chat_adapter_rejects_malformed_provider_responses(
    monkeypatch: pytest.MonkeyPatch,
    response: dict[str, Any],
    message: str,
) -> None:
    monkeypatch.setenv("BIM_REVIEW_OPENROUTER_API_KEY", TEST_CREDENTIAL)
    provider = OpenRouterChatProvider(
        model_id="vendor/tool-model",
        transport=lambda _url, _headers, _payload, _timeout: response,
    )

    with pytest.raises(ProviderError, match=message):
        provider.next_action(_request())


def test_chat_adapter_sends_only_the_redacted_episode_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BIM_REVIEW_OPENROUTER_API_KEY", TEST_CREDENTIAL)
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
    capture: dict[str, Any] = {}

    def transport(
        _url: str,
        _headers: dict[str, str],
        payload: dict[str, Any],
        _timeout: float,
    ) -> dict[str, Any]:
        capture["payload"] = payload
        return _completion(_tool_call("inspect_model", {}))

    provider = OpenRouterChatProvider(model_id="vendor/tool-model", transport=transport)

    provider.next_action(_request(episodes=(episode,)))

    public_context = json.loads(capture["payload"]["messages"][1]["content"])
    assert public_context["recalled_episodes"] == [episode.model_dump(mode="json")]
    serialized = json.dumps(public_context)
    assert "filename" not in serialized
    assert "final_response" not in serialized
    assert "findings" not in serialized


def test_chat_adapter_translates_parallel_specialist_delegation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BIM_REVIEW_OPENROUTER_API_KEY", TEST_CREDENTIAL)

    def transport(
        _url: str,
        _headers: dict[str, str],
        _payload: dict[str, Any],
        _timeout: float,
    ) -> dict[str, Any]:
        return _completion(
            _tool_call(
                "delegate__model-inspector",
                {"objective": "Inspect schema and inventory."},
                "inspect-task",
            ),
            _tool_call(
                "delegate__rule-review-specialist",
                {"objective": "Run deterministic checks."},
                "review-task",
            ),
        )

    provider = OpenRouterChatProvider(model_id="vendor/tool-model", transport=transport)
    request = _request(allowed_specialists=("model-inspector", "rule-review-specialist"))

    action = provider.next_action(request)

    assert isinstance(action, DelegateAction)
    assert [task.task_id for task in action.tasks] == ["inspect-task", "review-task"]
    assert [task.specialist_id for task in action.tasks] == [
        "model-inspector",
        "rule-review-specialist",
    ]


def test_chat_adapter_requires_a_credential_before_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("BIM_REVIEW_OPENROUTER_API_KEY", raising=False)
    called = False

    def transport(
        _url: str,
        _headers: dict[str, str],
        _payload: dict[str, Any],
        _timeout: float,
    ) -> dict[str, Any]:
        nonlocal called
        called = True
        return _completion()

    provider = OpenRouterChatProvider(model_id="vendor/tool-model", transport=transport)

    with pytest.raises(ProviderError, match="credential is not configured"):
        provider.next_action(_request())
    assert called is False


@pytest.mark.parametrize(
    "base_url",
    [
        "http://openrouter.example/api/v1",
        "ftp://openrouter.example/api/v1",
        "https://user:password@openrouter.example/api/v1",
        "https://openrouter.example/api/v1?credential=value",
    ],
)
def test_openrouter_components_reject_unsafe_base_urls(base_url: str) -> None:
    with pytest.raises(ValueError, match="base URL"):
        OpenRouterChatProvider(model_id="vendor/tool-model", base_url=base_url)
    with pytest.raises(ValueError, match="base URL"):
        OpenRouterCatalogueService(base_url=base_url)


def test_registry_resolves_only_an_approved_openrouter_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BIM_REVIEW_OPENROUTER_API_KEY", TEST_CREDENTIAL)
    catalogue = OpenRouterCatalogueService()
    registry = build_provider_registry(
        Settings(
            external_provider_enabled=False,
            openrouter_enabled=True,
            openrouter_base_url="https://openrouter.example/api/v1",
        ),
        openrouter_catalogue=catalogue,
    )
    local = ScriptedModelProvider(lambda _request: FinalAction(message="Local result."))
    descriptor = registry.catalogue()[2]
    selected_id = catalogue.current().models[3].model_id

    provider = registry.resolve(
        "openrouter",
        local_provider=local,
        model_id=selected_id,
    )

    assert descriptor.availability is ProviderAvailability.AVAILABLE
    assert descriptor.supports_model_selection is True
    assert descriptor.model_id == catalogue.current().models[0].model_id
    assert isinstance(provider, OpenRouterChatProvider)
    assert provider.model_id == selected_id

    with pytest.raises(ProviderSelectionError) as disallowed:
        registry.resolve(
            "openrouter",
            local_provider=local,
            model_id="vendor/not-in-approved-catalogue",
        )
    assert disallowed.value.code == "model_not_allowed"
    assert disallowed.value.status_code == 422


def test_registry_reports_openrouter_as_unavailable_without_a_credential(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("BIM_REVIEW_OPENROUTER_API_KEY", raising=False)
    registry = build_provider_registry(
        Settings(
            external_provider_enabled=False,
            openrouter_enabled=True,
        )
    )
    local = ScriptedModelProvider(lambda _request: FinalAction(message="Local result."))
    descriptor = registry.catalogue()[2]

    assert descriptor.enabled is True
    assert descriptor.configured is False
    assert descriptor.availability is ProviderAvailability.UNAVAILABLE
    with pytest.raises(ProviderSelectionError) as unavailable:
        registry.resolve("openrouter", local_provider=local)
    assert unavailable.value.code == "provider_unavailable"


def test_registry_tracks_the_refreshed_catalogue_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BIM_REVIEW_OPENROUTER_API_KEY", TEST_CREDENTIAL)

    def transport(
        _url: str,
        _headers: dict[str, str],
        _timeout: float,
    ) -> dict[str, Any]:
        return {"data": [_catalogue_item(index) for index in range(1, 11)]}

    catalogue = OpenRouterCatalogueService(transport=transport)
    registry = build_provider_registry(
        Settings(
            external_provider_enabled=False,
            openrouter_enabled=True,
        ),
        openrouter_catalogue=catalogue,
    )
    local = ScriptedModelProvider(lambda _request: FinalAction(message="Local result."))

    catalogue.refresh()
    selected = registry.resolve("openrouter", local_provider=local)

    assert registry.catalogue()[2].model_id == "vendor/model-1"
    assert isinstance(selected, OpenRouterChatProvider)
    assert selected.model_id == "vendor/model-1"
