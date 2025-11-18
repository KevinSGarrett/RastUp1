"""
Analytics utility helpers (identity stitching, experimentation math, attribution checks).

This package is produced as part of WBS-020 to support unit tests and CI guardrails.
"""

from .cuped import compute_theta, apply_cuped_adjustment
from .srm import chi_square_srm
from .identity import stitch_identities
from .attribution import (
    generate_click_token,
    verify_click_token,
    classify_channel_group,
    can_attribute_conversion,
)

__all__ = [
    "compute_theta",
    "apply_cuped_adjustment",
    "chi_square_srm",
    "stitch_identities",
    "generate_click_token",
    "verify_click_token",
    "classify_channel_group",
    "can_attribute_conversion",
]
