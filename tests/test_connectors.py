from __future__ import annotations

import pytest

from bim_review_agent.application.agent.schemas import ToolEffect
from bim_review_agent.application.tools import build_bim_tool_registry
from bim_review_agent.infrastructure.connectors import (
    ConnectorAvailability,
    ConnectorDescriptor,
    ConnectorHealth,
    ConnectorKind,
    ConnectorRegistry,
    ConnectorSelectionError,
    build_connector_registry,
)


def test_default_connector_catalogue_is_explicit_about_policy_and_health() -> None:
    registry = build_connector_registry()
    local, http, mcp = registry.catalogue()

    assert local.connector_id == "local-bim"
    assert local.availability is ConnectorAvailability.AVAILABLE
    assert local.health is ConnectorHealth.HEALTHY
    assert local.external is False
    assert local.network_required is False
    assert local.capabilities == (
        "inspect_model",
        "run_deterministic_review",
        "critique_review_evidence",
    )
    assert http.connector_id == "external-http"
    assert http.availability is ConnectorAvailability.DISALLOWED
    assert http.approved is False
    assert mcp.connector_id == "mcp-server"
    assert mcp.availability is ConnectorAvailability.DISABLED
    assert mcp.configured is False


def test_connector_selection_deduplicates_ids_and_returns_only_declared_capabilities() -> None:
    selection = build_connector_registry().resolve(
        ("local-bim", "local-bim"),
        required_capabilities=("inspect_model", "run_deterministic_review"),
    )

    assert selection.connector_ids == ("local-bim",)
    assert selection.capabilities == (
        "critique_review_evidence",
        "inspect_model",
        "run_deterministic_review",
    )


@pytest.mark.parametrize(
    ("connector_id", "code", "status_code"),
    [
        ("unknown", "connector_not_found", 404),
        ("external-http", "connector_disallowed", 403),
        ("mcp-server", "connector_disabled", 503),
    ],
)
def test_connector_selection_fails_closed_for_non_runnable_connectors(
    connector_id: str,
    code: str,
    status_code: int,
) -> None:
    with pytest.raises(ConnectorSelectionError) as error:
        build_connector_registry().resolve((connector_id,))

    assert error.value.code == code
    assert error.value.status_code == status_code
    assert error.value.recovery


def test_connector_selection_rejects_empty_and_excessive_requests() -> None:
    registry = build_connector_registry()

    with pytest.raises(ConnectorSelectionError) as empty:
        registry.resolve(())
    with pytest.raises(ConnectorSelectionError) as excessive:
        registry.resolve(tuple(f"connector-{index}" for index in range(9)))

    assert empty.value.code == "connector_selection_empty"
    assert excessive.value.code == "connector_selection_too_large"


def test_connector_selection_rejects_missing_required_capability() -> None:
    registry = ConnectorRegistry()
    registry.register(
        ConnectorDescriptor(
            connector_id="inventory-only",
            name="Inventory only",
            version="1.0",
            kind=ConnectorKind.BUILTIN,
            external=False,
            network_required=False,
            enabled=True,
            configured=True,
            approved=True,
            availability=ConnectorAvailability.AVAILABLE,
            health=ConnectorHealth.HEALTHY,
            reason="Test connector.",
            capabilities=("inspect_model",),
            effects=(ToolEffect.PURE_READ,),
        )
    )

    with pytest.raises(ConnectorSelectionError) as missing:
        registry.resolve(
            ("inventory-only",),
            required_capabilities=("inspect_model", "run_deterministic_review"),
        )

    assert missing.value.code == "connector_capability_missing"
    assert "run_deterministic_review" in missing.value.recovery


def test_connector_selection_reports_registered_but_unavailable_connector() -> None:
    registry = ConnectorRegistry()
    registry.register(
        ConnectorDescriptor(
            connector_id="temporarily-offline",
            name="Temporarily offline",
            version="1.0",
            kind=ConnectorKind.HTTP,
            external=True,
            network_required=True,
            enabled=True,
            configured=True,
            approved=True,
            availability=ConnectorAvailability.UNAVAILABLE,
            health=ConnectorHealth.NOT_CHECKED,
            reason="Health check failed.",
        )
    )

    with pytest.raises(ConnectorSelectionError) as unavailable:
        registry.resolve(("temporarily-offline",))

    assert unavailable.value.code == "connector_unavailable"
    assert unavailable.value.status_code == 503


def test_available_connector_registration_requires_complete_policy_state() -> None:
    registry = ConnectorRegistry()
    incomplete = ConnectorDescriptor(
        connector_id="incomplete",
        name="Incomplete",
        version="1.0",
        kind=ConnectorKind.HTTP,
        external=True,
        network_required=True,
        enabled=True,
        configured=True,
        approved=False,
        availability=ConnectorAvailability.AVAILABLE,
        health=ConnectorHealth.HEALTHY,
        reason="Not approved.",
    )

    with pytest.raises(ValueError, match="policy-approved"):
        registry.register(incomplete)


def test_tool_registry_materializes_only_selected_connector_capabilities() -> None:
    registry = build_bim_tool_registry({"inspect_model"})

    assert registry.contains("inspect_model") is True
    assert registry.contains("run_deterministic_review") is False
