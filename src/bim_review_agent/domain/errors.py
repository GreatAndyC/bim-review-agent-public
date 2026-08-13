"""Controlled errors exposed at the application boundary."""

from __future__ import annotations


class ReviewInputError(ValueError):
    """An expected user-correctable problem with a review input."""

    def __init__(
        self,
        *,
        code: str,
        message: str,
        recovery: str,
        status_code: int = 422,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.recovery = recovery
        self.status_code = status_code

    def as_detail(self) -> dict[str, str]:
        return {
            "code": self.code,
            "message": self.message,
            "recovery": self.recovery,
        }
