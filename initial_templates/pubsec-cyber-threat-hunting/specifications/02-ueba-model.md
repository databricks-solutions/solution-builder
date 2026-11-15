# 02 — UEBA (Isolation Forest, Unity Catalog)

`src/ml/train_ueba.py`. Features per user-day: failed sign-ins, MFA denials, successful sign-ins from an unfamiliar ASN
and from outside the US, off-hours successes, new authenticator devices, unmanaged-device VPN minutes, RDP logons to
hosts the user does not own (excl. the admin jump host), discovery commands, files read. Per host-day: high-entropy DNS
(entropy > 3.5 on labels ≥ 12 chars), TXT lookups, rare domains, inbound RDP from VPN space, staging writes in
C:\Users\Public.

Model: `log1p` → `IsolationForest(n_estimators=300, max_samples=4096)`, logged to MLflow
(`…/PUBSEC-Cyber-Threat-Hunting/ueba_experiment`), registered as `cybersecurity.threat_hunting_copilot.ueba_user_model`
and `ueba_host_model`, alias `@champion`.

Risk 0-100 = `100 · (1 − 0.5^n_dev) · (0.6 + 0.4 · IF percentile)`, where `n_dev` = behaviours > 3σ above the
population that day. Rationale: an isolation forest isolates a single rare behaviour (one failed sign-in) as fast as a
multi-behaviour attack day; breadth is what separates them. Top factors = up to 3 behaviours with z ≥ 3.

Outputs: `ueba_user_daily`, `ueba_host_daily`, `investigation_leads` (7-day peak ≥ 55; lead ids in risk order from
L-1042). Live queue: L-1042 dmorales 99.6, L-1043 WS-FIN-022 93.7, then six explained leads 70–75.
