"""Versioned scenario contracts for Solution Builder tests.

This package is deliberately rooted outside ``app/`` and is not included in
the generator wheel, installer, or copied demo-generator skill.
"""

from .models import Scenario

__all__ = ["Scenario"]
