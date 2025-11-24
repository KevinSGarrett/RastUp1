"""Shared helpers for infrastructure automation tooling."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Iterable, List, Sequence

import yaml


ROTATION_OPTIONALS = {"", "n/a", "na", "not-applicable", "none"}
ROTATION_OPTIONALS.add("—")  # em dash placeholder

# Stores that should always have an explicit rotation policy.
ROTATION_REQUIRED_STORES = {"secrets manager", "kms"}


@dataclass(frozen=True)
class RegistryEntry:
    """Single row extracted from the configuration registry table."""

    key: str
    service: str
    env: str
    type: str
    default: str
    allowed_values: str
    secret_store: str
    owner: str
    rotation: str
    notes: str

    @property
    def rotation_normalized(self) -> str:
        cleaned = self.rotation.replace("—", "").strip().lower()
        return cleaned

    @property
    def secret_store_normalized(self) -> str:
        return self.secret_store.strip().lower()

    @property
    def environments(self) -> List[str]:
        return [segment.strip() for segment in self.env.split(",") if segment.strip()]

    def requires_rotation_policy(self) -> bool:
        return self.secret_store_normalized in ROTATION_REQUIRED_STORES


def _strip_cell(value: str) -> str:
    return value.strip().strip("`").strip()


def parse_registry_markdown(raw_text: str) -> List[RegistryEntry]:
    """Parse the Markdown table from the registry document into structured rows."""
    lines = [
        line.strip()
        for line in raw_text.splitlines()
        if line.strip().startswith("|") and "---" not in line
    ]
    if not lines:
        raise ValueError("Registry table missing or malformed (no table rows found).")

    header_cells = [_strip_cell(cell) for cell in lines[0].strip("|").split("|")]
    expected_columns = [
        "Key",
        "Service",
        "Env",
        "Type",
        "Default",
        "Allowed Values",
        "Secret Store",
        "Owner",
        "Rotation",
        "Notes",
    ]
    if header_cells != expected_columns:
        raise ValueError(f"Unexpected registry columns: {header_cells!r}")

    entries: List[RegistryEntry] = []
    for row in lines[1:]:
        cells = [_strip_cell(cell) for cell in row.strip("|").split("|")]
        if len(cells) != len(expected_columns):
            raise ValueError(f"Malformed registry row: {row}")
        entry_data = dict(zip(expected_columns, cells))
        entries.append(
            RegistryEntry(
                key=entry_data["Key"],
                service=entry_data["Service"],
                env=entry_data["Env"],
                type=entry_data["Type"],
                default=entry_data["Default"],
                allowed_values=entry_data["Allowed Values"],
                secret_store=entry_data["Secret Store"],
                owner=entry_data["Owner"],
                rotation=entry_data["Rotation"],
                notes=entry_data["Notes"],
            )
        )
    return entries


def load_registry(path: Path) -> List[RegistryEntry]:
    return parse_registry_markdown(path.read_text(encoding="utf-8"))


def validate_registry(entries: Sequence[RegistryEntry]) -> List[str]:
    errors: List[str] = []
    seen_keys = set()

    for entry in entries:
        if entry.key in seen_keys:
            errors.append(f"Duplicate registry key detected: {entry.key}")
        else:
            seen_keys.add(entry.key)

        if not entry.owner:
            errors.append(f"Owner not specified for registry key {entry.key}")

        if entry.requires_rotation_policy() and entry.rotation_normalized in ROTATION_OPTIONALS:
            errors.append(
                f"Rotation policy missing for {entry.key} ({entry.secret_store})."
            )

        if entry.type.lower() == "secret" and entry.secret_store_normalized == "plain":
            errors.append(
                f"Registry key {entry.key} marked as secret but stored as plain text."
            )

        if not entry.environments:
            errors.append(f"At least one environment must be specified for {entry.key}")

    return errors


def load_flags_config(path: Path) -> dict:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or "flags" not in data:
        raise ValueError("Feature flag configuration missing top-level 'flags' key.")
    return data


FLAG_REQUIRED_FIELDS = {"owner", "description", "default_state", "environments", "kill_switch"}
ENVIRONMENT_REQUIRED_KEYS = {"dev", "stage", "prod"}
ALLOWED_STATE_PATTERN = re.compile(r"^(on|off|canary-\d+|manual|auto-[a-z0-9\-]+)$")


def validate_flags_config(config: dict) -> List[str]:
    errors: List[str] = []
    flags = config.get("flags", {})

    if not isinstance(flags, dict) or not flags:
        errors.append("No feature flags defined; expected at least one entry.")
        return errors

    for key, payload in flags.items():
        if not isinstance(payload, dict):
            errors.append(f"Flag '{key}' must be a mapping.")
            continue

        missing_fields = [field for field in FLAG_REQUIRED_FIELDS if field not in payload]
        if missing_fields:
            errors.append(f"Flag '{key}' missing fields: {missing_fields}")
            continue

        environments = payload["environments"]
        if not isinstance(environments, dict):
            errors.append(f"Flag '{key}' environments must be a mapping.")
            continue

        missing_envs = [env for env in ENVIRONMENT_REQUIRED_KEYS if env not in environments]
        if missing_envs:
            errors.append(f"Flag '{key}' missing environments: {missing_envs}")

        for env_name, state in environments.items():
            if isinstance(state, bool):
                state_value = "on" if state else "off"
            elif isinstance(state, str):
                state_value = state.strip().lower()
            else:
                errors.append(
                    f"Flag '{key}' environment '{env_name}' state must be a string or boolean."
                )
                continue
            if not ALLOWED_STATE_PATTERN.match(state_value):
                errors.append(
                    f"Flag '{key}' environment '{env_name}' has unsupported state '{state}'."
                )

    metadata = config.get("metadata")
    if not isinstance(metadata, dict):
        errors.append("Feature flag metadata missing or not a mapping.")
    else:
        approvals = metadata.get("approvals_required")
        if not isinstance(approvals, Iterable) or not approvals:
            errors.append(
                "Feature flag metadata must include non-empty approvals_required list."
            )

        update_process = metadata.get("update_process")
        if not isinstance(update_process, Iterable) or not list(update_process):
            errors.append("Feature flag metadata must define update_process steps.")

    return errors


def find_missing_paths(paths: Sequence[Path]) -> List[Path]:
    return [path for path in paths if not path.exists()]


def validate_runbook_structure(path: Path, required_headings: Sequence[str]) -> List[str]:
    text = path.read_text(encoding="utf-8")
    errors: List[str] = []
    for heading in required_headings:
        if heading not in text:
            errors.append(f"Runbook '{path.name}' missing heading '{heading}'.")
    return errors
