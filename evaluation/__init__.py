"""Maintainer-only evaluation tooling for Solution Builder.

This package is deliberately rooted outside ``app/`` and is not included in
the generator wheel, installer, or copied demo-generator skill.
"""

from .models import EvalRun, Scenario

__all__ = ["EvalRun", "Scenario"]
