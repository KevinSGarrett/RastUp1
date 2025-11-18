"""Sample Ratio Mismatch (SRM) guardrail helpers."""

from __future__ import annotations

import math
from statistics import NormalDist
from typing import Iterable, Sequence


def _normalize_allocations(allocations: Iterable[float]) -> list[float]:
    alloc_list = [float(a) for a in allocations]
    if not alloc_list:
        raise ValueError("allocations must not be empty")
    total = sum(alloc_list)
    if total <= 0:
        raise ValueError("allocations must sum to a positive value")
    return [a / total for a in alloc_list]


def chi_square_srm(counts: Sequence[int], allocations: Sequence[float]) -> dict[str, float]:
    """Compute chi-squared statistic and approximate p-value for SRM detection.

    Args:
        counts: Observed assignment counts per variant.
        allocations: Expected allocation weights (not necessarily normalized).

    Returns:
        Dictionary containing:
            - `chi2`: chi-squared statistic.
            - `p_value`: upper-tail probability (approximation via normal).
    """

    observed = [int(c) for c in counts]
    if not observed:
        raise ValueError("counts must not be empty")

    expected_ratios = _normalize_allocations(allocations)
    if len(expected_ratios) != len(observed):
        raise ValueError("counts and allocations must have identical lengths")

    total = sum(observed)
    if total == 0:
        return {"chi2": 0.0, "p_value": 1.0}

    expected_counts = [total * ratio for ratio in expected_ratios]
    chi2 = 0.0
    for obs, exp in zip(observed, expected_counts):
        if exp > 0:
            chi2 += (obs - exp) ** 2 / exp

    degrees_of_freedom = max(len(observed) - 1, 1)

    # Use Wilson-Hilferty transformation (normal approximation) for upper tail.
    z = (chi2 - degrees_of_freedom) / math.sqrt(2 * degrees_of_freedom)
    nd = NormalDist()
    p_value = max(0.0, min(1.0, nd.cdf(-z)))

    return {"chi2": chi2, "p_value": p_value}
