"""Credential-free connector discovery and fail-closed capability selection."""

from __future__ import annotations

from collections.abc import Iterable
from enum import StrEnum

from bim_review_agent.application.agent.schemas import ToolEffect
from bim_review_agent.domain.models import StrictModel

LOCAL_BIM_CONNECTOR_ID = "local-bim"
DEFAULT_CONNECTOR_IDS = (LOCAL_BIM_CONNECTOR_ID,)


class ConnectorKind(StrEnum):
    BUILTIN = "BUILTIN"
    HTTP = "HTTP"
    MCP = "MCP"


class ConnectorAvailability(StrEnum):
    AVAILABLE = "AVAILABLE"
    DISABLED = "DISABLED"
    UNAVAILABLE = "UNAVAILABLE"
    DISALLOWED = "DISALLOWED"


class ConnectorHealth(StrEnum):
    HEALTHY = "HEALTHY"
    NOT_CHECKED = "NOT_CHECKED"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class ConnectorDescriptor(StrictModel):
    connector_id: str
    name: str
    version: str
    kind: ConnectorKind
    external: bool
    network_required: bool
    enabled: bool
    configured: bool
    approved: bool
    availability: ConnectorAvailability
    health: ConnectorHealth
    reason: str
    capabilities: tuple[str, ...] = ()
    effects: tuple[ToolEffect, ...] = ()
    credential_required: bool = False


class ConnectorSelection(StrictModel):
    connector_ids: tuple[str, ...]
    capabilities: tuple[str, ...]


class ConnectorSelectionError(LookupError):
    """A public-safe connector selection problem with recovery metadata."""

    def __init__(
        self,
        *,
        code: str,
        message: str,
        recovery: str,
        status_code: int,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.recovery = recovery
        self.status_code = status_code


class ConnectorRegistry:
    """Describe approved capability sources without granting dynamic installation authority."""

    def __init__(self) -> None:
        self._connectors: dict[str, ConnectorDescriptor] = {}

    def register(self, descriptor: ConnectorDescriptor) -> None:
        if descriptor.connector_id in self._connectors:
            raise ValueError(f"Connector {descriptor.connector_id!r} is already registered.")
        if descriptor.availability is ConnectorAvailability.AVAILABLE:
            if not (descriptor.enabled and descriptor.configured and descriptor.approved):
                raise ValueError(
                    "An available connector must be enabled, configured, and policy-approved."
                )
            if descriptor.health is not ConnectorHealth.HEALTHY:
                raise ValueError("An available connector must report healthy state.")
        self._connectors[descriptor.connector_id] = descriptor

    def catalogue(self) -> tuple[ConnectorDescriptor, ...]:
        return tuple(self._connectors.values())

    def resolve(
        self,
        connector_ids: Iterable[str],
        *,
        required_capabilities: Iterable[str] = (),
    ) -> ConnectorSelection:
        normalized = tuple(dict.fromkeys(item.strip() for item in connector_ids if item.strip()))
        if not normalized:
            raise ConnectorSelectionError(
                code="connector_selection_empty",
                message="At least one connector must be selected for an Agent run.",
                recovery=f"Select {LOCAL_BIM_CONNECTOR_ID!r} for the built-in BIM tools.",
                status_code=422,
            )
        if len(normalized) > 8:
            raise ConnectorSelectionError(
                code="connector_selection_too_large",
                message="The request selected more connectors than the local policy permits.",
                recovery="Select at most eight approved connector IDs.",
                status_code=422,
            )

        selected: list[ConnectorDescriptor] = []
        for connector_id in normalized:
            descriptor = self._connectors.get(connector_id)
            if descriptor is None:
                raise ConnectorSelectionError(
                    code="connector_not_found",
                    message=f"Connector {connector_id!r} is not registered.",
                    recovery="Choose connector IDs listed by GET /api/capabilities.",
                    status_code=404,
                )
            if descriptor.availability is ConnectorAvailability.DISALLOWED:
                raise ConnectorSelectionError(
                    code="connector_disallowed",
                    message=f"Connector {connector_id!r} is not approved by capability policy.",
                    recovery=descriptor.reason,
                    status_code=403,
                )
            if descriptor.availability is ConnectorAvailability.DISABLED:
                raise ConnectorSelectionError(
                    code="connector_disabled",
                    message=f"Connector {connector_id!r} is disabled.",
                    recovery=descriptor.reason,
                    status_code=503,
                )
            if descriptor.availability is ConnectorAvailability.UNAVAILABLE:
                raise ConnectorSelectionError(
                    code="connector_unavailable",
                    message=f"Connector {connector_id!r} is unavailable.",
                    recovery=descriptor.reason,
                    status_code=503,
                )
            if not descriptor.approved:
                raise ConnectorSelectionError(
                    code="connector_disallowed",
                    message=f"Connector {connector_id!r} is not approved by capability policy.",
                    recovery=descriptor.reason,
                    status_code=403,
                )
            selected.append(descriptor)

        capabilities = tuple(
            sorted(
                {capability for descriptor in selected for capability in descriptor.capabilities}
            )
        )
        missing = sorted(set(required_capabilities) - set(capabilities))
        if missing:
            raise ConnectorSelectionError(
                code="connector_capability_missing",
                message="The selected connectors do not provide every capability this Agent needs.",
                recovery=(
                    "Select an approved connector that provides: " + ", ".join(missing) + "."
                ),
                status_code=422,
            )
        return ConnectorSelection(connector_ids=normalized, capabilities=capabilities)


def build_connector_registry() -> ConnectorRegistry:
    """Build the assessment connector catalogue with no arbitrary endpoint registration."""

    registry = ConnectorRegistry()
    registry.register(
        ConnectorDescriptor(
            connector_id=LOCAL_BIM_CONNECTOR_ID,
            name="Built-in deterministic BIM capabilities",
            version="1.0",
            kind=ConnectorKind.BUILTIN,
            external=False,
            network_required=False,
            enabled=True,
            configured=True,
            approved=True,
            availability=ConnectorAvailability.AVAILABLE,
            health=ConnectorHealth.HEALTHY,
            reason="Bundled, schema-validated, and available without credentials or network access.",
            capabilities=(
                "inspect_model",
                "run_deterministic_review",
                "critique_review_evidence",
            ),
            effects=(ToolEffect.PURE_READ, ToolEffect.DETERMINISTIC_COMPUTE),
        )
    )
    registry.register(
        ConnectorDescriptor(
            connector_id="external-http",
            name="External HTTP API connector family",
            version="0",
            kind=ConnectorKind.HTTP,
            external=True,
            network_required=True,
            enabled=False,
            configured=False,
            approved=False,
            availability=ConnectorAvailability.DISALLOWED,
            health=ConnectorHealth.NOT_CHECKED,
            reason=(
                "Arbitrary HTTP endpoints are outside the assessment policy; implement and "
                "approve a typed adapter before enabling one."
            ),
            credential_required=True,
        )
    )
    registry.register(
        ConnectorDescriptor(
            connector_id="mcp-server",
            name="MCP connector family",
            version="0",
            kind=ConnectorKind.MCP,
            external=True,
            network_required=True,
            enabled=False,
            configured=False,
            approved=False,
            availability=ConnectorAvailability.DISABLED,
            health=ConnectorHealth.NOT_APPLICABLE,
            reason="No MCP server is configured or required for the assessment build.",
            credential_required=False,
        )
    )
    return registry


__all__ = [
    "DEFAULT_CONNECTOR_IDS",
    "LOCAL_BIM_CONNECTOR_ID",
    "ConnectorAvailability",
    "ConnectorDescriptor",
    "ConnectorHealth",
    "ConnectorKind",
    "ConnectorRegistry",
    "ConnectorSelection",
    "ConnectorSelectionError",
    "build_connector_registry",
]
