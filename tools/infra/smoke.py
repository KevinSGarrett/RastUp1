"""Lightweight smoke validation that builds on the infrastructure preflight."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import List

from . import common, preflight, rotation_report


@dataclass
class SmokeReport:
    preflight_results: List[preflight.CheckResult]
    supplemental_checks: List[preflight.CheckResult]
    rotation_summary: dict

    def to_dict(self) -> dict:
        return {
            "preflight": [result.to_dict() for result in self.preflight_results],
            "supplemental": [result.to_dict() for result in self.supplemental_checks],
            "rotation_summary": self.rotation_summary,
        }


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def run_smoke(repo_root: Path | None = None) -> SmokeReport:
    root = repo_root or _repo_root()
    preflight_results = preflight.run_checks(root)
    supplemental: List[preflight.CheckResult] = []

    registry_path = root / "ops" / "config" / "registry.md"
    entries = common.load_registry(registry_path)
    rotation_summary = rotation_report.generate_rotation_summary(entries)

    if rotation_summary.get("managed_entries", 0) == 0:
        supplemental.append(
            preflight.CheckResult(
                name="rotation-managed",
                passed=False,
                details=[
                    "Configuration registry does not contain any entries requiring rotation."
                ],
            )
        )
    else:
        supplemental.append(
            preflight.CheckResult(name="rotation-managed", passed=True)
        )

    flags_config = common.load_flags_config(root / "ops" / "config" / "flags.yaml")
    approvals = flags_config.get("metadata", {}).get("approvals_required", [])
    if isinstance(approvals, list) and len(approvals) >= 2:
        supplemental.append(
            preflight.CheckResult(name="flag-approvals", passed=True)
        )
    else:
        supplemental.append(
            preflight.CheckResult(
                name="flag-approvals",
                passed=False,
                details=["Feature flag metadata should list at least two approvers."],
            )
        )

    return SmokeReport(
        preflight_results=preflight_results,
        supplemental_checks=supplemental,
        rotation_summary=rotation_summary,
    )


def _format_check_results(results: List[preflight.CheckResult]) -> str:
    lines: List[str] = []
    for result in results:
        status = "PASS" if result.passed else "FAIL"
        lines.append(f"[{status}] {result.name}")
        for detail in result.details:
            lines.append(f"    - {detail}")
    return "\n".join(lines)


def _format_rotation(summary: dict) -> str:
    lines = [
        f"Total registry entries: {summary.get('total_entries', 0)}",
        f"Entries with rotation buckets: {summary.get('managed_entries', 0)}",
    ]
    buckets = summary.get("rotation_buckets", {})
    if not buckets:
        lines.append("No rotation-managed entries detected.")
    else:
        lines.append("Rotation buckets:")
        for bucket, keys in buckets.items():
            lines.append(f"  - {bucket}: {len(keys)}")
            for key in keys:
                lines.append(f"      * {key}")
    unmanaged = summary.get("unmanaged", [])
    if unmanaged:
        lines.append("Entries lacking rotation policy:")
        for key in unmanaged:
            lines.append(f"  - {key}")
    return "\n".join(lines)


def _format_text(report: SmokeReport) -> str:
    lines: List[str] = []
    lines.append("Preflight checks:")
    lines.append(_format_check_results(report.preflight_results))
    lines.append("")
    lines.append("Supplemental checks:")
    lines.append(_format_check_results(report.supplemental_checks))
    lines.append("")
    lines.append("Rotation summary:")
    lines.append(_format_rotation(report.rotation_summary))
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run infrastructure smoke validation (preflight + rotation summary)."
    )
    parser.add_argument(
        "--format", choices=("text", "json"), default="text", help="Output format."
    )
    args = parser.parse_args()

    report = run_smoke()
    all_passed = all(result.passed for result in report.preflight_results)
    all_passed = all_passed and all(result.passed for result in report.supplemental_checks)

    if args.format == "json":
        print(json.dumps(report.to_dict(), indent=2))
    else:
        print(_format_text(report))

    return 0 if all_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
