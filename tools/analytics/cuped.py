"""CUPED helper utilities.

Implements the variance reduction technique described in TD-0076 for experimentation.
"""

from __future__ import annotations

from typing import Iterable, Sequence


def _to_float_sequence(values: Iterable[float]) -> list[float]:
    seq = [float(v) for v in values]
    if not seq:
        raise ValueError("sequence must not be empty")
    return seq


def compute_theta(pre_period: Sequence[float], outcome: Sequence[float]) -> float:
    """Return the CUPED theta coefficient.

    Theta = cov(pre_period, outcome) / var(pre_period).

    If the variance of the pre-period metric is ~0 the function returns 0.0 to
    avoid blowing up downstream adjustments.
    """

    x = _to_float_sequence(pre_period)
    y = _to_float_sequence(outcome)
    if len(x) != len(y):
        raise ValueError("pre_period and outcome must have identical lengths")
    n = len(x)
    if n < 2:
        # Not enough data to estimate covariance; return neutral theta.
        return 0.0

    mean_x = sum(x) / n
    mean_y = sum(y) / n
    cov_xy = sum((xi - mean_x) * (yi - mean_y) for xi, yi in zip(x, y)) / (n - 1)
    var_x = sum((xi - mean_x) ** 2 for xi in x) / (n - 1)
    if abs(var_x) < 1e-12:
        return 0.0
    return cov_xy / var_x


def apply_cuped_adjustment(
    outcome: Sequence[float],
    pre_period: Sequence[float],
    theta: float | None = None,
) -> list[float]:
    """Return CUPED-adjusted outcomes for each observation.

    Args:
        outcome: Raw post-treatment metric values.
        pre_period: Pre-treatment metric values aligned per identity.
        theta: Optional pre-computed theta. When omitted it is derived from the inputs.

    Returns:
        List with CUPED-adjusted values.
    """

    if theta is None:
        theta = compute_theta(pre_period, outcome)

    x = _to_float_sequence(pre_period)
    y = _to_float_sequence(outcome)
    if len(x) != len(y):
        raise ValueError("pre_period and outcome must have identical lengths")

    mean_x = sum(x) / len(x)
    adjusted = [yi - theta * (xi - mean_x) for xi, yi in zip(x, y)]
    return adjusted
