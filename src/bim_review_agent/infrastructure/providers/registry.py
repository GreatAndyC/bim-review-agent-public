"""Fail-closed discovery and selection for configured model providers."""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from urllib.parse import urlparse

from bim_review_agent.domain.models import StrictModel
from bim_review_agent.infrastructure.config import Settings
from bim_review_agent.infrastructure.providers.base import ModelProvider
from bim_review_agent.infrastructure.providers.openai_responses import OpenAIResponsesProvider
from bim_review_agent.infrastructure.providers.openrouter import (
    OpenRouterCatalogueService,
    OpenRouterChatProvider,
)


class ProviderAvailability(StrEnum):
    AVAILABLE = "AVAILABLE"
    DISABLED = "DISABLED"
    UNAVAILABLE = "UNAVAILABLE"


class ProviderDescriptor(StrictModel):
    provider_id: str
    model_id: str
    adapter_kind: str
    external: bool
    enabled: bool
    configured: bool
    availability: ProviderAvailability
    reason: str
    endpoint_origin: str | None = None
    supports_structured_actions: bool = True
    supports_tools: bool = True
    supports_delegation: bool = True
    supports_model_selection: bool = False
    models_endpoint: str | None = None
    privacy_policy: str | None = None


class ProviderSelectionError(LookupError):
    """A credential-free provider selection failure suitable for the API boundary."""

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


@dataclass(frozen=True, slots=True)
class _Registration:
    descriptor: ProviderDescriptor
    provider: ModelProvider | None = None
    provider_factory: Callable[[str], ModelProvider] | None = None
    model_ids: Callable[[], frozenset[str]] | None = None
    default_model_id: Callable[[], str] | None = None


class ProviderRegistry:
    """Expose public metadata and resolve only explicitly registered providers."""

    def __init__(self) -> None:
        self._registrations: dict[str, _Registration] = {}

    def register(
        self,
        descriptor: ProviderDescriptor,
        *,
        provider: ModelProvider | None = None,
        provider_factory: Callable[[str], ModelProvider] | None = None,
        model_ids: Callable[[], frozenset[str]] | None = None,
        default_model_id: Callable[[], str] | None = None,
    ) -> None:
        if descriptor.provider_id in self._registrations:
            raise ValueError(f"Provider {descriptor.provider_id!r} is already registered.")
        if provider is not None and provider_factory is not None:
            raise ValueError("A provider registration cannot use both an instance and a factory.")
        if provider_factory is not None and model_ids is None:
            raise ValueError("A selectable provider factory requires an allowed-model resolver.")
        if default_model_id is not None and model_ids is None:
            raise ValueError("A dynamic default model requires an allowed-model resolver.")
        if descriptor.availability is ProviderAvailability.AVAILABLE:
            if (
                descriptor.provider_id != "scripted"
                and provider is None
                and provider_factory is None
            ):
                raise ValueError("An available external provider requires an adapter instance.")
        elif provider is not None or provider_factory is not None:
            raise ValueError("A disabled or unavailable provider cannot have an adapter instance.")
        self._registrations[descriptor.provider_id] = _Registration(
            descriptor,
            provider,
            provider_factory,
            model_ids,
            default_model_id,
        )

    def catalogue(self) -> tuple[ProviderDescriptor, ...]:
        return tuple(
            registration.descriptor.model_copy(update={"model_id": registration.default_model_id()})
            if registration.default_model_id is not None
            else registration.descriptor
            for registration in self._registrations.values()
        )

    def resolve(
        self,
        provider_id: str,
        *,
        local_provider: ModelProvider,
        model_id: str | None = None,
    ) -> ModelProvider:
        requested = provider_id.strip()
        effective = "scripted" if requested == "auto" else requested
        registration = self._registrations.get(effective)
        if registration is None:
            raise ProviderSelectionError(
                code="provider_not_found",
                message="The requested model provider is not registered.",
                recovery="Choose a provider_id listed by GET /api/capabilities.",
                status_code=404,
            )
        descriptor = registration.descriptor
        if descriptor.availability is ProviderAvailability.DISABLED:
            raise ProviderSelectionError(
                code="provider_disabled",
                message=f"Model provider {descriptor.provider_id!r} is disabled.",
                recovery=descriptor.reason,
                status_code=503,
            )
        if descriptor.availability is ProviderAvailability.UNAVAILABLE:
            raise ProviderSelectionError(
                code="provider_unavailable",
                message=f"Model provider {descriptor.provider_id!r} is unavailable.",
                recovery=descriptor.reason,
                status_code=503,
            )
        if effective == "scripted":
            if model_id is not None and model_id.strip() not in {"", local_provider.model_id}:
                raise ProviderSelectionError(
                    code="model_not_allowed",
                    message="The local scripted Provider does not support model switching.",
                    recovery=f"Use model_id {local_provider.model_id!r} or omit model_id.",
                    status_code=422,
                )
            return local_provider
        requested_model = model_id.strip() if model_id is not None else ""
        if registration.provider_factory is not None and registration.model_ids is not None:
            dynamic_default = (
                registration.default_model_id()
                if registration.default_model_id is not None
                else descriptor.model_id
            )
            effective_model = requested_model or dynamic_default
            if effective_model not in registration.model_ids():
                raise ProviderSelectionError(
                    code="model_not_allowed",
                    message="The requested model is outside this Provider's approved catalogue.",
                    recovery=(
                        "Choose a model_id returned by the Provider's models_endpoint, then retry."
                    ),
                    status_code=422,
                )
            return registration.provider_factory(effective_model)
        if registration.provider is None:
            raise ProviderSelectionError(
                code="provider_unavailable",
                message=f"Model provider {descriptor.provider_id!r} has no active adapter.",
                recovery="Review the provider configuration and restart the local service.",
                status_code=503,
            )
        if requested_model and requested_model != registration.provider.model_id:
            raise ProviderSelectionError(
                code="model_not_allowed",
                message="The selected Provider is configured for one fixed model.",
                recovery=(f"Use model_id {registration.provider.model_id!r} or omit model_id."),
                status_code=422,
            )
        return registration.provider


def _endpoint_origin(base_url: str) -> str | None:
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    try:
        parsed_port = parsed.port
    except ValueError:
        return None
    port = f":{parsed_port}" if parsed_port is not None else ""
    return f"{parsed.scheme}://{parsed.hostname}{port}"


def _register_openai_responses(registry: ProviderRegistry, runtime_settings: Settings) -> None:
    external_id = "openai-responses"
    external_model_id = runtime_settings.external_provider_model.strip() or "not-configured"
    descriptor_kwargs = {
        "provider_id": external_id,
        "model_id": external_model_id,
        "adapter_kind": "responses-api",
        "external": True,
        "endpoint_origin": _endpoint_origin(runtime_settings.external_provider_base_url),
        "privacy_policy": "Remote storage is requested off; review upstream provider terms.",
    }
    if not runtime_settings.external_provider_enabled:
        registry.register(
            ProviderDescriptor(
                **descriptor_kwargs,
                enabled=False,
                configured=False,
                availability=ProviderAvailability.DISABLED,
                reason=(
                    "Set BIM_REVIEW_EXTERNAL_PROVIDER_ENABLED=1 and configure the documented "
                    "model credential to opt in."
                ),
            )
        )
        return

    if not os.getenv("BIM_REVIEW_MODEL_API_KEY"):
        registry.register(
            ProviderDescriptor(
                **descriptor_kwargs,
                enabled=True,
                configured=False,
                availability=ProviderAvailability.UNAVAILABLE,
                reason=(
                    "Set BIM_REVIEW_MODEL_API_KEY in the process environment, then restart the "
                    "local service."
                ),
            )
        )
        return

    try:
        provider = OpenAIResponsesProvider(
            model_id=runtime_settings.external_provider_model,
            base_url=runtime_settings.external_provider_base_url,
            timeout_seconds=runtime_settings.external_provider_timeout_seconds,
        )
    except ValueError:
        registry.register(
            ProviderDescriptor(
                **descriptor_kwargs,
                enabled=True,
                configured=False,
                availability=ProviderAvailability.UNAVAILABLE,
                reason=(
                    "Use a non-empty model ID and an HTTPS base URL; loopback HTTP is allowed for "
                    "a local compatible endpoint."
                ),
            )
        )
        return

    registry.register(
        ProviderDescriptor(
            **{**descriptor_kwargs, "model_id": provider.model_id},
            enabled=True,
            configured=True,
            availability=ProviderAvailability.AVAILABLE,
            reason="Explicitly enabled and configured; selected only by provider_id.",
        ),
        provider=provider,
    )


def _register_openrouter(
    registry: ProviderRegistry,
    runtime_settings: Settings,
    catalogue: OpenRouterCatalogueService,
) -> None:
    provider_id = "openrouter"
    default_model_id = catalogue.current().models[0].model_id
    descriptor_kwargs = {
        "provider_id": provider_id,
        "model_id": default_model_id,
        "adapter_kind": "openrouter-chat-completions",
        "external": True,
        "endpoint_origin": _endpoint_origin(runtime_settings.openrouter_base_url),
        "supports_model_selection": True,
        "models_endpoint": "/api/providers/openrouter/models",
        "privacy_policy": "Per-request data_collection=deny and Zero Data Retention required.",
    }
    if not runtime_settings.openrouter_enabled:
        registry.register(
            ProviderDescriptor(
                **descriptor_kwargs,
                enabled=False,
                configured=False,
                availability=ProviderAvailability.DISABLED,
                reason=(
                    "Complete local onboarding, then enable OpenRouter and configure the "
                    "documented process credential before restarting."
                ),
            ),
            model_ids=lambda: frozenset(model.model_id for model in catalogue.current().models),
            default_model_id=lambda: catalogue.current().models[0].model_id,
        )
        return

    if not os.getenv("BIM_REVIEW_OPENROUTER_API_KEY"):
        registry.register(
            ProviderDescriptor(
                **descriptor_kwargs,
                enabled=True,
                configured=False,
                availability=ProviderAvailability.UNAVAILABLE,
                reason=(
                    "Configure the documented OpenRouter credential in the process environment, "
                    "then restart the local service."
                ),
            ),
            model_ids=lambda: frozenset(model.model_id for model in catalogue.current().models),
            default_model_id=lambda: catalogue.current().models[0].model_id,
        )
        return

    try:
        OpenRouterChatProvider(
            model_id=default_model_id,
            base_url=runtime_settings.openrouter_base_url,
            timeout_seconds=runtime_settings.openrouter_timeout_seconds,
        )
    except ValueError:
        registry.register(
            ProviderDescriptor(
                **descriptor_kwargs,
                enabled=True,
                configured=False,
                availability=ProviderAvailability.UNAVAILABLE,
                reason="Use the documented HTTPS OpenRouter base URL and a valid timeout.",
            ),
            model_ids=lambda: frozenset(model.model_id for model in catalogue.current().models),
            default_model_id=lambda: catalogue.current().models[0].model_id,
        )
        return

    registry.register(
        ProviderDescriptor(
            **descriptor_kwargs,
            enabled=True,
            configured=True,
            availability=ProviderAvailability.AVAILABLE,
            reason=("Configured for explicit per-run selection from the approved weekly top ten."),
        ),
        provider_factory=lambda model_id: OpenRouterChatProvider(
            model_id=model_id,
            base_url=runtime_settings.openrouter_base_url,
            timeout_seconds=runtime_settings.openrouter_timeout_seconds,
        ),
        model_ids=lambda: frozenset(model.model_id for model in catalogue.current().models),
        default_model_id=lambda: catalogue.current().models[0].model_id,
    )


def build_provider_registry(
    runtime_settings: Settings,
    *,
    openrouter_catalogue: OpenRouterCatalogueService | None = None,
) -> ProviderRegistry:
    """Build public provider state without retaining any credential value."""

    catalogue = openrouter_catalogue or OpenRouterCatalogueService(
        base_url=runtime_settings.openrouter_base_url,
        timeout_seconds=runtime_settings.openrouter_catalogue_timeout_seconds,
    )
    registry = ProviderRegistry()
    registry.register(
        ProviderDescriptor(
            provider_id="scripted",
            model_id="deterministic-script-v1",
            adapter_kind="local-script",
            external=False,
            enabled=True,
            configured=True,
            availability=ProviderAvailability.AVAILABLE,
            reason="Always available as the local, deterministic fallback.",
            privacy_policy="No network request.",
        )
    )
    _register_openai_responses(registry, runtime_settings)
    _register_openrouter(registry, runtime_settings, catalogue)
    return registry


__all__ = [
    "ProviderAvailability",
    "ProviderDescriptor",
    "ProviderRegistry",
    "ProviderSelectionError",
    "build_provider_registry",
]
