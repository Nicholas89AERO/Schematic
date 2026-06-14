"""
Compliance data models — rule results and reports.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class RuleSeverity(str, Enum):
    ERROR   = "error"
    WARNING = "warning"
    INFO    = "info"


class RuleStatus(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    SKIP = "skip"


@dataclass
class RuleResult:
    rule_id: str = ""
    rule_title: str = ""
    severity: RuleSeverity = RuleSeverity.ERROR
    status: RuleStatus = RuleStatus.PASS
    message: str = ""
    element_id: Optional[str] = None
    element_ref: Optional[str] = None
    layer: Optional[str] = None
    sheet: Optional[int] = None
    fix_available: bool = False
    fix_description: str = ""


@dataclass
class ComplianceReport:
    project_id: str = ""
    layer: Optional[str] = None  # None = all layers
    score: int = 100             # 0-100
    total_rules: int = 0
    passed: int = 0
    warnings: int = 0
    errors: int = 0
    results: list[RuleResult] = field(default_factory=list)
    summary: str = ""

    def calculate_score(self) -> int:
        """Compute score: start at 100, deduct per error (-5) and warning (-2)."""
        if self.total_rules == 0:
            return 100
        deductions = (self.errors * 5) + (self.warnings * 2)
        self.score = max(0, 100 - deductions)
        return self.score

    def add_result(self, result: RuleResult) -> None:
        self.results.append(result)
        self.total_rules += 1
        if result.status == RuleStatus.PASS:
            self.passed += 1
        elif result.status == RuleStatus.FAIL:
            if result.severity == RuleSeverity.ERROR:
                self.errors += 1
            else:
                self.warnings += 1
        self.calculate_score()
