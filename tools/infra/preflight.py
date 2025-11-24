"""Repository preflight checks for infrastructure automation."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List

from . import common


@dataclass
class CheckResult:
    name: str
    passed: bool
    details: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"name": self.name, "passed": self.passed, "details": self.details}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def run_checks(repo_root: Path | None = None) -> List[CheckResult]:
    root = repo_root or _repo_root()

    registry_path = root / "ops" / "config" / "registry.md"
    flags_path = root / "ops" / "config" / "flags.yaml"
    runbook_path = root / "ops" / "runbooks" / "secret_rotation.md"
    roadmap_path = root / "docs" / "infra" / "bootstrap-plan.md"

    results: List[CheckResult] = []

    required_paths = [registry_path, flags_path, runbook_path, roadmap_path]
    missing = common.find_missing_paths(required_paths)
    if missing:
        results.append(
            CheckResult(
                name="required-files",
                passed=False,
                details=[f"Missing required path: {path}" for path in missing],
            )
        )
        # No need to continue when core files are absent.
        return results
    else:
        results.append(CheckResult(name="required-files", passed=True))

    try:
        registry_entries = common.load_registry(registry_path)
        registry_errors = common.validate_registry(registry_entries)
        results.append(
            CheckResult(
                name="registry-consistency",
                passed=not registry_errors,
                details=registry_errors,
            )
        )
    except Exception as exc:  # pragma: no cover - defensive
        results.append(
            CheckResult(
                name="registry-consistency",
                passed=False,
                details=[f"Exception while parsing registry: {exc}"],
            )
        )

    try:
        flags_config = common.load_flags_config(flags_path)
        flags_errors = common.validate_flags_config(flags_config)
        results.append(
            CheckResult(
                name="feature-flags",
                passed=not flags_errors,
                details=flags_errors,
            )
        )
    except Exception as exc:  # pragma: no cover - defensive
        results.append(
            CheckResult(
                name="feature-flags",
                passed=False,
                details=[f"Exception while parsing feature flags: {exc}"],
            )
        )

    runbook_errors = common.validate_runbook_structure(
        runbook_path,
        required_headings=[
            "## 1. Preconditions",
            "## 2. Create New Version",
            "## 3. Deploy & Validate",
            "## 4. Decommission Old Material",
            "## 5. Rollback Plan",
            "## 6. Evidence & Logging",
            "## 7. Escalation Matrix",
            "## 8. Checklist",
        ],
    )
    results.append(
        CheckResult(
            name="runbook-structure",
            passed=not runbook_errors,
            details=runbook_errors,
        )
    )

    roadmap_errors = _validate_roadmap_structure(
        roadmap_path,
        required_headings=[
            "## Context",
            "## Account & Environment Matrix",
            "## Amplify Gen 2 & CDK Structure",
            "## Implementation Phases",
            "## Testing & Validation Plan",
        ],
    )
    results.append(
        CheckResult(
            name="roadmap-structure",
            passed=not roadmap_errors,
            details=roadmap_errors,
        )
    )

    return results


def _validate_roadmap_structure(path: Path, required_headings: Iterable[str]) -> List[str]:
    text = path.read_text(encoding="utf-8")
    errors: List[str] = []
    for heading in required_headings:
        if heading not in text:
            errors.append(f"Infrastructure roadmap missing heading '{heading}'.")
    return errors


def _format_text(results: Iterable[CheckResult]) -> str:
    lines: List[str] = []
    for result in results:
        status = "PASS" if result.passed else "FAIL"
        lines.append(f"[{status}] {result.name}")
        for detail in result.details:
            lines.append(f"    - {detail}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run infrastructure preflight checks.")
    parser.add_argument(
        "--format", choices=("text", "json"), default="text", help="Output format."
    )
    args = parser.parse_args()

    results = run_checks()
    all_passed = all(result.passed for result in results)

    if args.format == "json":
        payload = {
            "status": "pass" if all_passed else "fail",
            "results": [result.to_dict() for result in results],
        }
        print(json.dumps(payload, indent=2))
    else:
        print(_format_text(results))

    return 0 if all_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
