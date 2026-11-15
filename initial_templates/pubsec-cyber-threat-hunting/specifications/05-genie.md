# 05 — Genie agent (tables + IR playbook)

**Genie agent "Cascadia SOC - Threat Hunting"** (`src/genie/genie_space.json`, serialized v2, 14 tables sorted). Instructions
define MTTD/MTTR, identity-based incidents, TP rate, hosting networks / spray, high-entropy DNS, UEBA semantics and
the "relative to the latest event" time rule. Sample questions (all verified via the conversation API):
1. What is our mean time to detect and respond by incident category? → credential_compromise 316.4 h (13.2 d) detect, 21.4 h respond …
2. Which detection rules have the lowest true-positive rate? → Impossible travel 0.7%, DNS newly-registered domain 0.9% …
3. How many accounts were targeted by failed passwords from hosting networks in the last 30 days, and the most failures any account had in one day? → 212 accounts, 1,971 attempts, 12 IPs, max 1
4. Which entities have the highest UEBA risk score this week? → Daniel Morales 99.6, WS-FIN-022 93.7, …
5. Which ATT&CK techniques in our playbook have no detection coverage? → 8 (T1039, T1560.001, T1110.003, T1621, …)

**Documents** — the agent's `ir_playbook` volume (`/Volumes/<catalog>/<schema>/ir_playbook`, answered in Agent mode)
(6 chapters, `src/ir_playbook/`): PB-1 severity / escalation / notification (FTI → IRS Office of Safeguards + TIGTA 24 h),
PB-2 identity compromise (spray, MFA fatigue, impossible-travel closure criteria), PB-3 phishing/malware/web,
PB-4 lateral movement & discovery, PB-5 collection & DNS exfiltration, PB-6/7 impact, ATT&CK mapping, containment catalog C-01..C-09.
