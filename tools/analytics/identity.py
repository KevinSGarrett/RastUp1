"""Identity stitching helpers for analytics ingestion."""

from __future__ import annotations

import hashlib
from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable, Sequence


def _hash_identifier(kind: str, value: str, salt: str) -> str:
    """Return deterministic hashed identifier preserving kind prefix."""

    digest = hashlib.sha256(f"{kind}:{value}:{salt}".encode("utf-8")).hexdigest()
    return f"{kind}:{digest[:32]}"


@dataclass
class EventIdentifiers:
    nodes: list[str]
    has_user: bool
    has_secondary: bool


class UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}
        self.rank: dict[str, int] = {}

    def add(self, item: str) -> None:
        if item not in self.parent:
            self.parent[item] = item
            self.rank[item] = 0

    def find(self, item: str) -> str:
        parent = self.parent[item]
        if parent != item:
            self.parent[item] = self.find(parent)
        return self.parent[item]

    def union(self, a: str, b: str) -> str:
        root_a = self.find(a)
        root_b = self.find(b)
        if root_a == root_b:
            return root_a
        rank_a = self.rank[root_a]
        rank_b = self.rank[root_b]
        if rank_a < rank_b:
            self.parent[root_a] = root_b
            return root_b
        if rank_a > rank_b:
            self.parent[root_b] = root_a
            return root_a
        # Same rank; choose root_a and increment.
        self.parent[root_b] = root_a
        self.rank[root_a] += 1
        return root_a


def stitch_identities(
    events: Sequence[dict[str, str | None]],
    *,
    salt: str,
) -> list[dict[str, object]]:
    """Return stitched identities with confidence estimates.

    Args:
        events: Sequence of event dictionaries containing identifiers (`user_id`,
            `anon_id`, `session_id`, `device_id`).
        salt: Secret salt applied when hashing identifiers.

    Returns:
        List of identity dictionaries with structure:
            {
              "identity_id": str,
              "members": {"user_id": [...], "anon_id": [...], ...},
              "confidence": float,
              "size": int,
            }
    """

    uf = UnionFind()
    all_nodes: set[str] = set()
    processed_events: list[EventIdentifiers] = []

    for event in events:
        identifiers: list[str] = []
        has_user = False
        has_secondary = False
        for kind in ("user_id", "anon_id", "session_id", "device_id"):
            value = event.get(kind)
            if value:
                hashed = _hash_identifier(kind, str(value), salt)
                uf.add(hashed)
                identifiers.append(hashed)
                all_nodes.add(hashed)
                if kind == "user_id":
                    has_user = True
                else:
                    has_secondary = True
        if identifiers:
            base = identifiers[0]
            for other in identifiers[1:]:
                uf.union(base, other)
        processed_events.append(
            EventIdentifiers(nodes=identifiers, has_user=has_user, has_secondary=has_secondary)
        )

    if not all_nodes:
        return []

    members_by_root: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for node in all_nodes:
        root = uf.find(node)
        kind, _digest = node.split(":", 1)
        members_by_root[root][kind].add(node)

    edge_counts: dict[str, int] = defaultdict(int)
    strong_edges: dict[str, int] = defaultdict(int)

    for event_identifiers in processed_events:
        if not event_identifiers.nodes:
            continue
        root = uf.find(event_identifiers.nodes[0])
        edge_counts[root] += max(len(event_identifiers.nodes) - 1, 0)
        if event_identifiers.has_user and event_identifiers.has_secondary and len(
            event_identifiers.nodes
        ) > 1:
            strong_edges[root] += 1

    identities: list[dict[str, object]] = []
    for root, members in members_by_root.items():
        total_edges = edge_counts[root]
        confidence = 0.0
        if total_edges > 0:
            confidence = min(1.0, strong_edges[root] / total_edges)
        identity_id = hashlib.sha256(f"identity:{root}:{salt}".encode("utf-8")).hexdigest()[:24]
        member_counts = sum(len(group) for group in members.values())
        identities.append(
            {
                "identity_id": identity_id,
                "members": {kind: sorted(values) for kind, values in members.items()},
                "confidence": confidence,
                "size": member_counts,
            }
        )

    identities.sort(key=lambda item: item["identity_id"])
    return identities
