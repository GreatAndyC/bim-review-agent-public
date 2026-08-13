"""Model-provider contracts and deterministic test implementations."""

from bim_review_agent.infrastructure.providers.base import ModelProvider, ProviderError
from bim_review_agent.infrastructure.providers.openai_responses import OpenAIResponsesProvider
from bim_review_agent.infrastructure.providers.openrouter import (
    CatalogueSource,
    OpenRouterCatalogueService,
    OpenRouterChatProvider,
    OpenRouterModelCatalogue,
    OpenRouterModelDescriptor,
)
from bim_review_agent.infrastructure.providers.registry import (
    ProviderAvailability,
    ProviderDescriptor,
    ProviderRegistry,
    ProviderSelectionError,
    build_provider_registry,
)
from bim_review_agent.infrastructure.providers.scripted import ScriptedModelProvider

__all__ = [
    "CatalogueSource",
    "ModelProvider",
    "OpenAIResponsesProvider",
    "OpenRouterCatalogueService",
    "OpenRouterChatProvider",
    "OpenRouterModelCatalogue",
    "OpenRouterModelDescriptor",
    "ProviderAvailability",
    "ProviderDescriptor",
    "ProviderError",
    "ProviderRegistry",
    "ProviderSelectionError",
    "ScriptedModelProvider",
    "build_provider_registry",
]
