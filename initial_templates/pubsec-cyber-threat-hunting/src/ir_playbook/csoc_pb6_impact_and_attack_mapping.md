# CSOC IR Playbook — Chapter 6 — Impact, and Chapter 7 — ATT&CK mapping and containment catalog

### PB-6.1 Ransomware (T1486, T1490)
Isolate every affected host (C-05), disconnect backups from the network, SEV-1, incident commander leads.

### PB-6.2 Denial of service against the eTax portal (T1498)
Engage the upstream DDoS provider; SEV-2 during filing season (January to April), otherwise SEV-3.

### PB-7 ATT&CK mapping standard
Every IR case lists each MITRE ATT&CK technique observed, with the technique ID (for example T1110.003), the tactic, and the timeline event that evidences it. Map only what the evidence shows; list suspected techniques separately as "suspected". CDOR detection coverage per technique is tracked in the attack_techniques table; a technique observed in an incident with no detection coverage becomes a detection-engineering backlog item.

Common chain for credential-based intrusions at CDOR: password spraying (T1110.003) → MFA fatigue (T1621) → valid accounts (T1078) over external remote services / VPN (T1133) → authenticator registration for persistence (T1098.005) → RDP lateral movement (T1021.001) → domain discovery (T1087.002, T1482, T1033) → data from network share (T1039) → archive via utility (T1560.001) → DNS C2 (T1071.004) → exfiltration over DNS (T1048.003).

### PB-7.1 Containment action catalog
Use these codes in the IR case:
- C-01 Disable the user account (identity provider + Active Directory). Disable, do not delete.
- C-02 Revoke all sessions and refresh tokens, and terminate active VPN sessions.
- C-03 Remove attacker-registered MFA / authenticator devices; enforce number matching.
- C-04 Force password reset (single account or all accounts targeted by a spray).
- C-05 Isolate the host with EDR network containment (keeps memory for forensics).
- C-06 Block source IP ranges at identity-provider conditional access, VPN gateway and firewall.
- C-07 Sinkhole the domain at internal DNS and block it at the egress proxy.
- C-08 Preserve evidence: memory image of isolated hosts, file-server audit logs, VPN logs.
- C-09 Notify: CISO (1 hour, SEV-1), IRS Office of Safeguards and TIGTA (24 hours, FTI), Cascadia Fusion Center (24 hours, SEV-1).
Order for a SEV-1 identity-led intrusion: C-02 and C-01 first (cut the attacker's access), then C-05 and C-07 (stop the exfiltration channel), C-06, C-03, C-08, C-04, and C-09 in parallel.
