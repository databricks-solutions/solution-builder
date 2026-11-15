# 01 — Synthetic security telemetry + the planted signal

Source: `data_generation/generate_data.py` (`--catalog cybersecurity --schema threat_hunting_copilot`). Deterministic
(seeded Python + `xxhash64` in Spark SQL), generated relative to the run date (`D-n` = n days before generation).
All public IPs are RFC 5737 documentation ranges, attacker domains end in `.example`, ASNs are documentation/private.

| Table | Rows (live) | Grain / notes |
|---|--:|---|
| identities | 1,180 | CDOR workforce: department, office, title, privileged, home ISP IP, laptop |
| assets | 1,211 | laptops, WS-FIN-011..030 finance desktops, 12 servers (FS-TAX-01 holds FTI) |
| travel_approvals | 47 | incl. TR-2026-118 (jliu, Vancouver) |
| it_tickets | 83 | incl. HD-58213, HD-58190, HD-58240 (benign explanations) |
| attack_techniques | 28 | ATT&CK technique, tactic, CDOR coverage full/partial/none, playbook section |
| siem_alerts | 7,521 | 10 rules + UEBA, disposition true_positive / benign_true_positive / false_positive / open |
| incidents | 167 | 18 months; MTTD = detected − first_malicious, MTTR = contained − detected |
| auth_logs | 269,744 | IdP sign-ins with result, failure_reason, MFA outcome, IP / ASN / geo |
| vpn_sessions | 27,955 | device managed flag, EDR posture, assigned 10.200.x.x IP, bytes |
| endpoint_events | 509,371 | logon (type 10 = RDP), process_start + command_line, file_read/file_write batches |
| dns_logs | 866,859 | query, type, Shannon entropy of the left-most label |

## Planted attack (hero lead L-1042 / L-1043)
1. D-24..D-6: spray from 12 IPs in 203.0.113.0/24 (AS64500 "NightOwl VPS Hosting", NL) — 1,971 bad passwords on 212 accounts, **max 1 per account per day** (brute-force rule is >5 in 10 min).
2. D-6 02:47: dmorales' password correct → 5 MFA pushes denied/timed out → approved 03:04 → authenticator "Pixel-7a" registered 03:06.
3. D-6..D-2: nightly VPN from DESKTOP-7Q2M4KD (unmanaged, no EDR), RDP to WS-FIN-022 (owner akim).
4. D-6: discovery (whoami /all, net user/group /domain, nltest /domain_trusts, /dclist), `OneDriveUpdater.exe` dropped in C:\Users\Public\Music.
5. D-5/D-4: 4,812 files read from \\FS-TAX-01\AuditCases\2025; robocopy + `7z a -mhe=on -p` archive (1.96 GB).
6. D-6 03:41 → now: A-record beacon to `update-cdnsync.example` every ~300 s; D-3/D-2: 58,000 TXT lookups (entropy ≈4.6).
7. Tier 1 closed AL-900417 (impossible travel) and AL-900588 (newly-registered domain) as false positives.

Decoys: jliu (approved Vancouver travel, managed laptop), tnakamura (new service-desk hire), pwhitaker (new phone),
cvasquez (quarter-end audit sampling) — multi-signal but explained.

Verification query (planted signal):
```sql
SELECT count(*) attempts, count(DISTINCT user_id) accounts, max(c) max_per_account_day
FROM (SELECT *, count(*) OVER (PARTITION BY user_id, date(event_ts)) c FROM cybersecurity.threat_hunting_copilot.auth_logs
      WHERE src_ip LIKE '203.0.113.%' AND failure_reason = 'invalid_password');   -- 1971 | 212 | 1
```
