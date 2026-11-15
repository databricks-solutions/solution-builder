# CSOC IR Playbook — Chapter 4 — Lateral movement, discovery and credential access

### PB-4.1 Remote Desktop lateral movement (T1021.001) and masquerading (T1036.005)
Indicators: RDP (logon type 10) into a host the account does not own and has never used, especially from VPN address space (10.200.0.0/16) at night; finance workstations (WS-FIN-*) accept RDP for remote accountants, so the owner of the workstation is the only expected user.
Response:
1. Isolate the host with EDR network containment (C-05). Isolation keeps the host powered on so memory can be captured; do not reboot or reimage before evidence is preserved (C-08).
2. Hunt the host for executables written to user-writable folders (C:\Users\Public, %TEMP%) with names imitating legitimate software (for example "OneDriveUpdater.exe" outside Program Files) — masquerading.
3. Identify every host the account reached from the isolated host.

### PB-4.2 Domain discovery (T1087.002, T1482, T1033)
Commands such as `whoami /all`, `net user <name> /domain`, `net group "Domain Admins" /domain`, `nltest /domain_trusts` and `nltest /dclist` are routine for IT administrators on the jump host SRV-MGMT-01. The same commands run by a non-IT account, or on a finance workstation, are reconnaissance and indicate hands-on-keyboard attacker activity. Record each command with timestamp and host in the timeline.

### PB-4.3 Credential access and privileged accounts (T1003.001, T1558.003, T1136.002)
Any sign of credential dumping or a new privileged account is SEV-1. Reset the krbtgt account twice (12 hours apart) only on the incident commander's instruction.
