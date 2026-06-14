export type RuleSeverity = 'error' | 'warning' | 'info';
export type RuleStatus = 'pass' | 'fail' | 'skip';

export interface RuleResult {
  rule_id: string;
  rule_title: string;
  severity: RuleSeverity;
  status: RuleStatus;
  message: string;
  element_id: string | null;
  element_ref: string | null;
  layer: string | null;
  sheet: number | null;
  fix_available: boolean;
  fix_description: string;
}

export interface ComplianceReport {
  project_id: string;
  layer: string | null;
  score: number;
  total_rules: number;
  passed: number;
  warnings: number;
  errors: number;
  results: RuleResult[];
  summary: string;
}
