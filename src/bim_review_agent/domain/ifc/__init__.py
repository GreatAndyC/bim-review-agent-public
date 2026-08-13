"""IFC parsing, schema validation, and fact extraction."""

from .extractor import DoorFacts, ExtractedModel, Fact, extract_model
from .schema_validation import (
    SchemaIssue,
    SchemaValidationResult,
    declared_schema,
    load_ifc4_registry,
    validate_ifc_bytes,
    validate_model,
)

__all__ = [
    "DoorFacts",
    "ExtractedModel",
    "Fact",
    "SchemaIssue",
    "SchemaValidationResult",
    "declared_schema",
    "extract_model",
    "load_ifc4_registry",
    "validate_ifc_bytes",
    "validate_model",
]
