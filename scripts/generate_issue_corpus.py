"""Generate deterministic IFC models with distinct, reviewable door-data issues.

The product's five bundled samples are intentionally small UI demonstrations.  This
corpus is separate: each file is a test fixture for a different information-quality,
applicability, or clear-width failure mode currently owned by the deterministic rule
engine.  It is not intended to simulate geometric coordination defects that the
current engine does not inspect.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from generate_samples import DoorSpec, build_model

PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_ROOT / "tests" / "fixtures" / "real_ifc" / "generated_issues"


@dataclass(frozen=True, slots=True)
class IssueCase:
    issue_id: str
    title: str
    issue_type: str
    profile_id: str
    expected_outcome: str
    description: str
    doors: tuple[DoorSpec, ...]


ISSUE_CASES: tuple[IssueCase, ...] = (
    IssueCase(
        issue_id="issue-01-no-doors",
        title="Model without door elements",
        issue_type="zero_doors",
        profile_id="demo_hku",
        expected_outcome="NO_FINDINGS",
        description="The model has valid spatial structure but no IfcDoor, so door rules have no applicable target.",
        doors=(),
    ),
    IssueCase(
        issue_id="issue-02-missing-exit-door-name",
        title="Confirmed exit has no name",
        issue_type="missing_door_name",
        profile_id="demo_hku",
        expected_outcome="REVIEW",
        description="IfcDoor.Name is missing while the explicit exit classification is present.",
        doors=(DoorSpec("D-02", None, True, "60min", 31, 950, 1000, "Single swing fire exit"),),
    ),
    IssueCase(
        issue_id="issue-03-missing-exit-classification",
        title="Exit classification is missing",
        issue_type="missing_exit_classification",
        profile_id="demo_hku",
        expected_outcome="REVIEW",
        description="The door is named like an exit but Pset_DoorCommon.FireExit is not populated.",
        doors=(
            DoorSpec(
                "D-03",
                "Candidate Exit D-03",
                None,
                None,
                31,
                950,
                1000,
                "Exit door awaiting classification",
            ),
        ),
    ),
    IssueCase(
        issue_id="issue-04-invalid-exit-classification",
        title="Exit classification cannot be normalized",
        issue_type="invalid_exit_classification",
        profile_id="demo_hku",
        expected_outcome="REVIEW",
        description="The model contains a non-boolean classification value and the engine must not infer applicability.",
        doors=(
            DoorSpec(
                "D-04",
                "Unresolved Exit D-04",
                "maybe",
                None,
                31,
                950,
                1000,
                "Exit classification unresolved",
            ),
        ),
    ),
    IssueCase(
        issue_id="issue-05-missing-fire-rating",
        title="Confirmed exit has no fire rating",
        issue_type="missing_fire_rating",
        profile_id="demo_hku",
        expected_outcome="REVIEW",
        description="A confirmed exit door is missing Pset_DoorCommon.FireRating evidence.",
        doors=(DoorSpec("D-05", "Exit D-05", True, None, 31, 950, 1000, "Single swing fire exit"),),
    ),
    IssueCase(
        issue_id="issue-06-empty-fire-rating",
        title="Fire rating is an empty string",
        issue_type="invalid_fire_rating",
        profile_id="demo_hku",
        expected_outcome="REVIEW",
        description="The fire-rating property exists but contains no usable value.",
        doors=(DoorSpec("D-06", "Exit D-06", True, "", 31, 950, 1000, "Single swing fire exit"),),
    ),
    IssueCase(
        issue_id="issue-07-missing-clear-width",
        title="Exit has no measured clear width",
        issue_type="missing_clear_width",
        profile_id="demo_hku",
        expected_outcome="REVIEW",
        description="The model has only nominal OverallWidth; the engine must not treat it as verified clear opening.",
        doors=(
            DoorSpec("D-07", "Exit D-07", True, "60min", 31, None, 900, "Single swing fire exit"),
        ),
    ),
    IssueCase(
        issue_id="issue-08-proxy-only-width",
        title="Only nominal width is available",
        issue_type="proxy_width_only",
        profile_id="cn-fire-55037-2022",
        expected_outcome="REVIEW",
        description="The model reports OverallWidth but omits Pset_BIMReview.ClearWidth, so the mainland pre-check must return REVIEW.",
        doors=(
            DoorSpec(
                "D-08", "Service Exit D-08", True, "60min", 31, None, 800, "Single swing fire exit"
            ),
        ),
    ),
    IssueCase(
        issue_id="issue-09-width-below-mainland-threshold",
        title="Clear width is below 800 mm",
        issue_type="mainland_width_fail",
        profile_id="cn-fire-55037-2022",
        expected_outcome="FAIL",
        description="The explicit clear width is 799 mm, below the configured GB 55037-2022 pre-check threshold.",
        doors=(
            DoorSpec(
                "D-09", "Narrow Exit D-09", True, "60min", 31, 799, 850, "Single swing fire exit"
            ),
        ),
    ),
    IssueCase(
        issue_id="issue-10-width-below-demo-threshold",
        title="Clear width is below the demonstration threshold",
        issue_type="demo_width_fail",
        profile_id="demo_hku",
        expected_outcome="FAIL",
        description="The explicit clear width is 899 mm, below the demo pack's 900 mm threshold.",
        doors=(
            DoorSpec(
                "D-10", "Narrow Exit D-10", True, "60min", 31, 899, 950, "Single swing fire exit"
            ),
        ),
    ),
    IssueCase(
        issue_id="issue-11-zero-clear-width",
        title="Clear width is zero",
        issue_type="non_positive_clear_width",
        profile_id="cn-fire-55037-2022",
        expected_outcome="REVIEW",
        description="A non-positive measured width is invalid evidence and must not become a passing comparison.",
        doors=(
            DoorSpec(
                "D-11",
                "Invalid Width Exit D-11",
                True,
                "60min",
                31,
                0,
                850,
                "Single swing fire exit",
            ),
        ),
    ),
    IssueCase(
        issue_id="issue-12-negative-clear-width",
        title="Clear width is negative",
        issue_type="negative_clear_width",
        profile_id="demo_hku",
        expected_outcome="REVIEW",
        description="A negative width value is invalid evidence and should be surfaced for correction.",
        doors=(
            DoorSpec(
                "D-12",
                "Invalid Width Exit D-12",
                True,
                "60min",
                31,
                -1,
                850,
                "Single swing fire exit",
            ),
        ),
    ),
    IssueCase(
        issue_id="issue-13-hk-capacity-missing",
        title="Hong Kong capacity evidence is missing",
        issue_type="missing_occupant_capacity",
        profile_id="hk-fire-safety-2011-2024",
        expected_outcome="REVIEW",
        description="A confirmed exit has width evidence but no occupant capacity to select a Table B2 row.",
        doors=(
            DoorSpec("D-13", "Exit D-13", True, "60min", None, 900, 950, "Single swing fire exit"),
        ),
    ),
    IssueCase(
        issue_id="issue-14-hk-capacity-fractional",
        title="Hong Kong capacity is fractional",
        issue_type="invalid_occupant_capacity",
        profile_id="hk-fire-safety-2011-2024",
        expected_outcome="REVIEW",
        description="Table B2 requires an integer occupant count; 30.5 cannot select a deterministic row.",
        doors=(
            DoorSpec("D-14", "Exit D-14", True, "60min", 30.5, 900, 950, "Single swing fire exit"),
        ),
    ),
    IssueCase(
        issue_id="issue-15-hk-capacity-out-of-range",
        title="Hong Kong capacity is outside the direct-check range",
        issue_type="table_row_not_machine_checkable",
        profile_id="hk-fire-safety-2011-2024",
        expected_outcome="REVIEW",
        description="A capacity above the directly machine-checkable Table B2 rows requires authority or professional review.",
        doors=(
            DoorSpec(
                "D-15",
                "High Occupancy Exit D-15",
                True,
                "120min",
                3001,
                1500,
                1600,
                "Double leaf fire exit",
            ),
        ),
    ),
    IssueCase(
        issue_id="issue-16-hk-boundary-30-narrow",
        title="Capacity 30 with a 749 mm clear opening",
        issue_type="hk_boundary_width_fail",
        profile_id="hk-fire-safety-2011-2024",
        expected_outcome="FAIL",
        description="This boundary case is one millimetre below the 750 mm minimum for 4-30 occupants.",
        doors=(
            DoorSpec(
                "D-16", "Boundary Exit D-16", True, "60min", 30, 749, 800, "Single swing fire exit"
            ),
        ),
    ),
    IssueCase(
        issue_id="issue-17-hk-boundary-31-narrow",
        title="Capacity 31 with an 849 mm clear opening",
        issue_type="hk_boundary_width_fail",
        profile_id="hk-fire-safety-2011-2024",
        expected_outcome="FAIL",
        description="This boundary case is one millimetre below the 850 mm minimum for 31-200 occupants.",
        doors=(
            DoorSpec(
                "D-17", "Boundary Exit D-17", True, "60min", 31, 849, 900, "Single swing fire exit"
            ),
        ),
    ),
    IssueCase(
        issue_id="issue-18-contradictory-exit-signal",
        title="Name suggests exit but property says non-exit",
        issue_type="exit_classification_contradiction",
        profile_id="demo_hku",
        expected_outcome="REVIEW",
        description="The explicit non-exit property conflicts with exit-related naming metadata.",
        doors=(
            DoorSpec("D-18", "Emergency Exit D-18", False, None, None, 700, 750, "Internal door"),
        ),
    ),
    IssueCase(
        issue_id="issue-19-missing-internal-door-name",
        title="Internal door has no name",
        issue_type="missing_door_name_internal",
        profile_id="demo_hku",
        expected_outcome="REVIEW",
        description="All doors are subject to the configured information check, including non-exit doors.",
        doors=(DoorSpec("D-19", None, False, None, None, None, 850, "Internal door"),),
    ),
    IssueCase(
        issue_id="issue-20-multiple-missing-fields",
        title="Exit is missing several required fields",
        issue_type="multiple_missing_fields",
        profile_id="cn-fire-55037-2022",
        expected_outcome="REVIEW",
        description="The exit has no name, fire rating, clear width, or occupant capacity evidence.",
        doors=(
            DoorSpec("D-20", None, True, None, None, None, None, "Exit door awaiting coordination"),
        ),
    ),
)


def _manifest_case(case: IssueCase, filename: str) -> dict[str, object]:
    return {
        "issue_id": case.issue_id,
        "title": case.title,
        "issue_type": case.issue_type,
        "profile_id": case.profile_id,
        "expected_outcome": case.expected_outcome,
        "description": case.description,
        "path": filename,
        "door_spec_count": len(case.doors),
    }


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest_cases: list[dict[str, object]] = []
    for case in ISSUE_CASES:
        model = build_model(case.issue_id, case.title, list(case.doors))
        filename = f"{case.issue_id}.ifc"
        (OUTPUT_DIR / filename).write_text(model.to_string(), encoding="utf-8")
        manifest_cases.append(_manifest_case(case, filename))
        print(f"generated {OUTPUT_DIR.relative_to(PROJECT_ROOT) / filename}")

    (OUTPUT_DIR / "cases.json").write_text(
        json.dumps(
            {
                "version": 1,
                "purpose": "Deterministic issue fixtures for supported door evidence and egress rules.",
                "cases": manifest_cases,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
