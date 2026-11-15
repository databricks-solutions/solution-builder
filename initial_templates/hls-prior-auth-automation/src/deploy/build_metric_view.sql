-- =====================================================================
-- Semantic layer + write-back target
-- =====================================================================
-- pa_ops_metrics : UC metric view — the governed CMS-0057-F KPIs (approval /
--                  denial rate, SLA compliance, turnaround, auto-approval rate,
--                  first-pass-clean rate, pend rate) shared by the dashboard,
--                  Genie and the app.
-- um_decisions   : Delta write-back table — every decision taken in the
--                  Prior Auth Copilot app (nurse or auto-approval rule) lands
--                  here, so the dashboard + Genie see the workbench's impact.
-- Runs on a SQL warehouse (src/deploy/run_sql_on_warehouse.py).
-- =====================================================================
CREATE TABLE IF NOT EXISTS {{CATALOG}}.{{SCHEMA}}.um_decisions (
  decision_id STRING NOT NULL,
  request_id STRING NOT NULL,
  decision STRING COMMENT 'Approved, Auto-approved, Pended - Info Requested, Referred to Medical Director',
  decided_by STRING COMMENT 'Nurse email, or AUTO-RULE-v1 for the auto-approval lane',
  decided_at TIMESTAMP,
  ai_recommendation STRING COMMENT 'The AI pre-review recommendation at decision time (APPROVE / PEND / REFER_MD)',
  agreed_with_ai BOOLEAN,
  note STRING
) COMMENT 'Write-back from the Prior Auth Copilot app: one row per decision taken in the nurse workbench or by the auto-approval rule.';

CREATE OR REPLACE VIEW {{CATALOG}}.{{SCHEMA}}.pa_ops_metrics
WITH METRICS
LANGUAGE YAML
COMMENT 'Prior-authorization operations KPIs (CMS-0057-F): volume, approval/denial rate, SLA compliance vs 72h expedited / 7-day standard, turnaround, auto-approval and first-pass-clean rates.'
AS $$
version: 1.1
source: {{CATALOG}}.{{SCHEMA}}.pa_requests
joins:
  - name: prv
    source: {{CATALOG}}.{{SCHEMA}}.providers
    on: source.provider_id = prv.provider_id
  - name: pol
    source: {{CATALOG}}.{{SCHEMA}}.medical_policies
    on: source.policy_id = pol.policy_id
dimensions:
  - name: Received Date
    expr: DATE(received_ts)
  - name: Received Week
    expr: DATE_TRUNC('WEEK', received_ts)
  - name: Urgency
    expr: urgency
  - name: Channel
    expr: channel
  - name: Line of Business
    expr: line_of_business
  - name: Service Category
    expr: service_category
  - name: Policy
    expr: CONCAT(pol.policy_id, ' ', pol.policy_title)
  - name: Practice Group
    expr: prv.practice_group
  - name: Final Outcome
    expr: final_outcome
  - name: Decision Path
    expr: decision_path
  - name: Arrival Window
    expr: CASE WHEN DAYOFWEEK(received_ts) IN (1, 7) OR (DAYOFWEEK(received_ts) = 6 AND HOUR(received_ts) >= 15) THEN 'Weekend (Fri 3pm - Sun)' ELSE 'Weekday' END
    comment: Friday 3pm through Sunday arrivals wait for Monday fax indexing
measures:
  - name: Requests
    expr: COUNT(1)
  - name: Decided Requests
    expr: COUNT(1) FILTER (WHERE final_outcome IN ('Approved', 'Denied'))
  - name: Open Backlog
    expr: COUNT(1) FILTER (WHERE final_outcome = 'Open')
  - name: Approval Rate
    expr: COUNT(1) FILTER (WHERE final_outcome = 'Approved') / NULLIF(COUNT(1) FILTER (WHERE final_outcome IN ('Approved', 'Denied')), 0)
  - name: Denial Rate
    expr: COUNT(1) FILTER (WHERE final_outcome = 'Denied') / NULLIF(COUNT(1) FILTER (WHERE final_outcome IN ('Approved', 'Denied')), 0)
  - name: SLA Compliance
    expr: COUNT(1) FILTER (WHERE sla_met) / NULLIF(COUNT(1) FILTER (WHERE sla_met IS NOT NULL), 0)
    comment: Share of decided requests within 72h (expedited) / 168h (standard)
  - name: SLA Breaches
    expr: COUNT(1) FILTER (WHERE sla_met = false)
  - name: Avg Turnaround Hours
    expr: AVG(turnaround_hours)
  - name: Median Turnaround Hours
    expr: PERCENTILE(turnaround_hours, 0.5)
  - name: Auto-Approval Rate
    expr: COUNT(1) FILTER (WHERE decided_by_role = 'Automation') / NULLIF(COUNT(1) FILTER (WHERE final_outcome IN ('Approved', 'Denied')), 0)
  - name: First-Pass Clean Rate
    expr: COUNT(1) FILTER (WHERE criteria_met_on_first_review) / NULLIF(COUNT(1) FILTER (WHERE criteria_met_on_first_review IS NOT NULL), 0)
    comment: Share of reviewed requests where every policy criterion was documented at first review (auto-approval candidates)
  - name: Pend Rate
    expr: COUNT(1) FILTER (WHERE pend_count > 0) / NULLIF(COUNT(1) FILTER (WHERE final_outcome <> 'Open'), 0)
$$;
