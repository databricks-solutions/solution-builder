# CSOC IR Playbook — Chapter 5 — Collection and exfiltration

### PB-5.1 Collection from network shares (T1039) and archiving (T1560.001)
The share \\FS-TAX-01\AuditCases holds taxpayer audit case files containing Federal Tax Information (FTI) and PII. Auditors normally read tens of files a day; the backup service account (svc_backup) reads the whole share nightly from SRV-BKP-03 and is expected.
Indicators: a user account reading hundreds of files per hour, from a host other than the user's laptop, at night; followed by copy tools (robocopy) and a password-protected archive (7z with -p / -mhe) in a user-writable folder.
Response: preserve the file-server audit logs (C-08); record the exact file count and folders; treat the incident as SEV-1 (PB-1.1) and start the FTI notification clock (PB-1.2). Records affected = files read by the attacker (each audit case file is one taxpayer case).

### PB-5.2 DNS command-and-control and exfiltration (T1071.004, T1048.003) and exfiltration over C2 (T1041)
Indicators:
- Beaconing: one internal host querying the same parent domain at a regular interval (for example every ~5 minutes, with small jitter), each query with a random-looking subdomain label.
- Tunneling: bursts of thousands of TXT queries with long labels (40+ characters) of high Shannon entropy (above ~4 bits per character) to a domain no other host resolves.
- A "newly registered domain" alert on the same domain is corroboration, not noise.
Response:
1. Sinkhole the domain at the internal resolvers and block it at the egress proxy and firewall (C-07).
2. Isolate the source host (C-05).
3. Estimate volume: each tunneled TXT query can carry roughly 30 bytes of encoded payload in a 52-character label; multiply by the query count and report the estimate as a range.
4. Exfiltration of FTI is SEV-1 and triggers the 24-hour IRS Office of Safeguards / TIGTA notification (PB-1.2).
