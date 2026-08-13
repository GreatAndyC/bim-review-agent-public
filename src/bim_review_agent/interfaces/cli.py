"""Command-line entry points for reviewing and validating IFC files."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from bim_review_agent.application.review_service import review_ifc_bytes
from bim_review_agent.domain.ifc import validate_ifc_bytes


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="bim-review-agent",
        description="Run the evidence-first IFC review prototype.",
    )
    subcommands = parser.add_subparsers(dest="command")

    review = subcommands.add_parser("review", help="Review one IFC file and print JSON.")
    review.add_argument("ifc_file", type=Path)
    review.add_argument("--output", "-o", type=Path)
    review.add_argument(
        "--profile",
        default="demo_hku",
        choices=("demo_hku", "hk-fire-safety-2011-2024", "cn-fire-55037-2022"),
        help="Deterministic review profile to run.",
    )

    validate = subcommands.add_parser(
        "validate-schema",
        help="Validate one IFC file against the IFC4.0.2.1 schema profile.",
    )
    validate.add_argument("ifc_file", type=Path)
    validate.add_argument("--output", "-o", type=Path)
    return parser


def main() -> None:
    parser = _parser()
    args = parser.parse_args()
    if args.command is None:
        parser.print_help()
        return

    if args.command == "review":
        path: Path = args.ifc_file
        run = review_ifc_bytes(path.name, path.read_bytes(), profile_id=args.profile)
        payload = json.dumps(run.model_dump(mode="json"), indent=2, ensure_ascii=False)
        if args.output:
            args.output.write_text(f"{payload}\n", encoding="utf-8")
        else:
            print(payload)
        return

    if args.command == "validate-schema":
        path: Path = args.ifc_file
        result = validate_ifc_bytes(path.read_bytes())
        payload = json.dumps(result.as_dict(), indent=2, ensure_ascii=False)
        if args.output:
            args.output.write_text(f"{payload}\n", encoding="utf-8")
        else:
            print(payload)
        if not result.passed:
            raise SystemExit(2)
        return

    parser.error(f"Unknown command: {args.command}")


if __name__ == "__main__":
    main()
