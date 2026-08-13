"""Versioned jurisdiction source profiles and deterministic rule helpers."""

from .hong_kong import HongKongRule, HongKongRulePack, HongKongWidthRow, load_hong_kong_profile
from .hong_kong_rules import evaluate_hong_kong_door_width

__all__ = [
    "HongKongRule",
    "HongKongRulePack",
    "HongKongWidthRow",
    "evaluate_hong_kong_door_width",
    "load_hong_kong_profile",
]
