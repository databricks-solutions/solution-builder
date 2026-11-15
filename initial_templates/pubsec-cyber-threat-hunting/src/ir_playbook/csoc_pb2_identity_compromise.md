# CSOC IR Playbook — Chapter 2 — Identity compromise

### PB-2.1 Password spraying (ATT&CK T1110.003) and password guessing (T1110.001)
Indicators: failed sign-ins against MANY accounts with FEW attempts per account (typically 1 per account per day or less) from the same /24 range or hosting ASN, often at night, often with scripted user agents. A spray deliberately stays below the lockout threshold (5 failures in 30 minutes) and below the SIEM brute-force rule (more than 5 failures in 10 minutes), so the absence of a brute-force alert does NOT rule it out.
Response:
1. Block the source ranges at the identity provider conditional-access policy, the VPN gateway and the perimeter firewall (containment action C-06).
2. Find every targeted account that had a SUCCESSFUL sign-in or an MFA prompt from the spraying range. An MFA prompt means the password was correct. Treat those accounts as compromised (PB-2.2).
3. Force a password reset for all targeted accounts (C-04) once the attacker is contained; prioritise accounts with a success.
4. Scope: count distinct accounts targeted, attempts, first and last attempt, source IPs.
Severity: SEV-3 with no success; SEV-2 or higher once any account shows a correct password.

### PB-2.2 MFA fatigue (T1621) and authenticator device registration (T1098.005)
Indicators: three or more MFA pushes denied or timed out within minutes, followed by an approval; especially at night and from an unfamiliar network. A new authenticator device registered right after such an approval is attacker persistence.
Response (all within the SEV containment window):
1. Disable the account (C-01) — disable, do not delete.
2. Revoke all sessions and refresh tokens, including VPN sessions (C-02).
3. Remove any authenticator device registered during the suspicious window (C-03) and require number-matching MFA.
4. Verify with the user by phone call-back (PB-1.2) before re-enabling; reset the password (C-04).
5. Pivot: every VPN session, host logon and file access by the account after the approval is attacker activity until proven otherwise.

### PB-2.3 Valid accounts from unfamiliar infrastructure and impossible travel (T1078, T1133)
Triage an impossible-travel or new-country alert with ALL of the following before closing it as benign:
- Is there an approved travel request covering the date and destination (travel approvals)?
- Is the device managed (CDOR laptop with EDR) and compliant? Unmanaged device = not benign.
- Did MFA succeed on the first push? Repeated denials before approval = PB-2.2, not travel.
- Is the network a hotel, conference or carrier network, or a hosting / VPS provider? Hosting ASNs are not travel.
- Is the sign-in during the traveller's local business hours?
If travel is approved, the device is managed, MFA succeeded on the first push and the network is a hotel/carrier network, close as benign true positive and note each check. Otherwise escalate to tier 2.
Service-desk tickets (for example a new phone requiring authenticator re-registration) are valid explanations for MFA anomalies when the ticket predates the activity and the source is the user's usual network.
