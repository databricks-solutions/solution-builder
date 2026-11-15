"""
Cascadia Department of Revenue (CDOR) — SOC threat hunting: synthetic security telemetry.

DEFENSIVE DEMO DATA ONLY. Every public IP is RFC 5737 documentation space (192.0.2.0/24,
198.51.100.0/24, 203.0.113.0/24) or RFC 6598 shared space (100.64.0.0/10); internal IPs are
RFC 1918; external attacker domains use the reserved `.example` TLD; ASNs are documentation /
private ASNs. No real indicators of compromise, no exploit code.

Self-contained plain Python file:
  * on Databricks (job spark_python_task / serverless): ambient SparkSession
  * locally: Databricks Connect (Python 3.12 venv), DATABRICKS_CONFIG_PROFILE=<profile>

    python generate_data.py --catalog cybersecurity --schema threat_hunting_copilot

Tables (Delta; every *_ts column is agency local time, TIMESTAMP_NTZ):
  identities          1,180 CDOR workforce identities (department, office, title, privileged flag)
  assets              laptops, finance workstations and servers (criticality, owner, IP)
  travel_approvals    approved staff travel (the analyst's "is this travel legit?" pivot)
  it_tickets          service-desk tickets (MFA re-registration, access grants, FYIs)
  auth_logs           90 days of identity-provider sign-ins (result, MFA outcome, IP, ASN, geo)
  vpn_sessions        remote-access VPN sessions (device posture, assigned IP, bytes)
  endpoint_events     EDR telemetry: logons (incl. RDP), process starts with command lines, file reads/writes
  dns_logs            DNS resolver logs per host (query, type, Shannon entropy of the left-most label)
  siem_alerts         90 days of SIEM / EDR / identity alerts with the analyst disposition
  incidents           18 months of closed incidents: first malicious activity, detection, containment (MTTD / MTTR)
  attack_techniques   MITRE ATT&CK techniques referenced by the IR playbook, with CDOR detection coverage

THE PLANTED SIGNAL — "low and slow":
  From D-24 to D-6 a password spray from 12 hosting IPs in 203.0.113.0/24 tries ~10 passwords
  against each of 212 CDOR accounts — at most one guess per account per day, so the SIEM's
  ">5 failures in 10 minutes" brute-force rule never fires. On D-6 at 02:47 the guess for
  Daniel Morales (dmorales, Senior Field Auditor, Harbor Point) works. After five MFA pushes he
  denies or ignores, he approves the sixth at 03:04 (MFA fatigue); a new authenticator device is
  registered and a VPN session opens from an unmanaged PC. Over five nights the session RDPs
  into finance workstation WS-FIN-022, runs domain discovery (net group / nltest), reads 4,812
  taxpayer audit files on FS-TAX-01, stages a password-protected 7z archive, and WS-FIN-022
  beacons to update-cdnsync.example every ~5 minutes — then ~58k TXT lookups (DNS exfiltration).
  Two alerts DID fire (impossible travel, newly-registered domain); tier 1 closed both as false
  positives. UEBA (src/ml/train_ueba.py) is what stitches it together.
  Decoys: Jenna Liu (IT) signs in from a Vancouver hotel D-3..D-1 — approved travel, managed
  laptop, MFA first try — an impossible-travel alert that is genuinely benign. Carmen Vasquez
  (late-night audit sampling, ticket HD-58240), Toby Nakamura (new service-desk hire, HD-58190) and
  Paula Whitaker (new phone, HD-58213) are multi-signal UEBA leads with a benign explanation.
"""
from __future__ import annotations

import argparse
import math
import random
import string
from datetime import date, datetime, timedelta

from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql import types as T

SEED = 20260929
rng = random.Random(SEED)
AS_OF = date.today()
WINDOW_DAYS = 90


def D(n: int) -> date:
    return AS_OF - timedelta(days=n)


def ts(day: date, hh: int, mm: int, ss: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hh, mm, ss)


def get_spark() -> SparkSession:
    try:
        active = SparkSession.getActiveSession()
        if active is not None:
            return active
    except Exception:
        pass
    try:
        from databricks.connect import DatabricksSession  # type: ignore

        return DatabricksSession.builder.serverless(True).getOrCreate()
    except Exception:
        return SparkSession.builder.getOrCreate()


# ─────────────────────────────────────────────────────────────────────────────
# Workforce + assets
# ─────────────────────────────────────────────────────────────────────────────
FIRST = ["James", "Maria", "Robert", "Linda", "Michael", "Sarah", "David", "Karen", "Joseph", "Nancy", "Thomas", "Lisa",
         "Carlos", "Angela", "Kevin", "Priya", "Brian", "Grace", "Anthony", "Rachel", "Mark", "Laura", "Steven", "Emily",
         "Paul", "Hannah", "Andrew", "Olivia", "Joshua", "Megan", "Samuel", "Julia", "Luis", "Aisha", "Ethan", "Sofia",
         "Nathan", "Chloe", "Victor", "Irene", "Omar", "Tessa", "Hiro", "Leah", "Diego", "Nora", "Ravi", "Mei", "Kofi",
         "Elena", "Marcus", "Fatima", "Ian", "Zoe", "Tariq", "Ruth", "Wes", "Anika", "Colin", "Rosa"]
LAST = ["Anderson", "Nguyen", "Patel", "Garcia", "Johnson", "Kim", "Brown", "Martinez", "Lee", "Wilson", "Clark",
        "Lopez", "Hall", "Young", "Allen", "Wright", "Scott", "Torres", "Hill", "Green", "Adams", "Baker", "Nelson",
        "Carter", "Mitchell", "Perez", "Roberts", "Turner", "Phillips", "Campbell", "Parker", "Evans", "Edwards",
        "Collins", "Stewart", "Sanchez", "Reyes", "Cruz", "Ortiz", "Gomez", "Murphy", "Cook", "Rogers", "Bell",
        "Bailey", "Rivera", "Cooper", "Howard", "Ward", "Ramos", "Hughes", "Price", "Myers", "Long", "Foster",
        "Sanders", "Ross", "Powell", "Jenkins", "Haddad", "Lindqvist", "Brennan", "Castillo", "Yamada"]
DEPTS = [  # department, share, titles
    ("Audit & Compliance", 0.22, ["Field Auditor", "Senior Field Auditor", "Audit Manager", "Compliance Analyst"]),
    ("Taxpayer Services", 0.24, ["Taxpayer Services Rep", "Senior Services Rep", "Services Supervisor"]),
    ("Collections", 0.14, ["Revenue Agent", "Senior Revenue Agent", "Collections Supervisor"]),
    ("Finance", 0.08, ["Accountant", "Senior Accountant", "Budget Analyst", "Finance Manager"]),
    ("Research & Analytics", 0.06, ["Economist", "Data Analyst", "Senior Data Analyst"]),
    ("Information Technology", 0.10, ["IT Specialist", "Systems Administrator", "Network Engineer", "Security Engineer"]),
    ("Legal", 0.05, ["Attorney", "Paralegal"]),
    ("Human Resources", 0.05, ["HR Consultant", "HR Manager"]),
    ("Executive Office", 0.06, ["Executive Assistant", "Deputy Director", "Program Manager"]),
]
OFFICES = {  # office -> (egress IP, city, laptop prefix, laptop subnet)
    "Capitol City HQ": ("198.51.100.10", "Capitol City", "HQ", 20),
    "Harbor Point": ("198.51.100.20", "Harbor Point", "HP", 30),
    "Eastgate": ("198.51.100.30", "Eastgate", "EG", 40),
}
N_USERS = 1180
HERO, DECOY, FIN_OWNER = "dmorales", "jliu", "akim"
ATTACK_IPS = [f"203.0.113.{n}" for n in (11, 14, 19, 23, 27, 31, 36, 40, 44, 47, 52, 58)]
FOOTHOLD_IP = "203.0.113.47"
HOTEL_IP = "192.0.2.77"
ATTACK_DOMAIN = "update-cdnsync.example"
ATTACKER_PC = "DESKTOP-7Q2M4KD"
VPN_IP_ATTACK = "10.200.8.77"
HOSTING = ("AS64500", "NightOwl VPS Hosting", "NL", "Amsterdam")
HOTEL = ("AS64501", "Harbourfront Hotel Guest WiFi", "CA", "Vancouver")
STATE_NET = ("AS64496", "Cascadia State Network")
HOME_ISP = ("AS64497", "Cascade Broadband")


def build_identities():
    users, seen = [], set()
    fixed = [
        (HERO, "Daniel", "Morales", "Audit & Compliance", "Senior Field Auditor", "Harbor Point", False, date(2014, 3, 17)),
        (DECOY, "Jenna", "Liu", "Information Technology", "Systems Administrator", "Capitol City HQ", True, date(2017, 8, 7)),
        (FIN_OWNER, "Alicia", "Kim", "Finance", "Senior Accountant", "Capitol City HQ", False, date(2019, 1, 22)),
        ("mokafor", "Maya", "Okafor", "Information Technology", "SOC Threat Hunter (Tier 2)", "Capitol City HQ", True, date(2021, 5, 3)),
        ("gtran", "Gloria", "Tran", "Executive Office", "Chief Information Security Officer", "Capitol City HQ", True, date(2016, 10, 10)),
        ("cvasquez", "Carmen", "Vasquez", "Audit & Compliance", "Audit Manager", "Eastgate", False, date(2012, 6, 4)),
        ("tnakamura", "Toby", "Nakamura", "Information Technology", "IT Specialist (Service Desk)", "Capitol City HQ", True, AS_OF - timedelta(days=19)),
        ("pwhitaker", "Paula", "Whitaker", "Collections", "Senior Revenue Agent", "Harbor Point", False, date(2011, 2, 14)),
        ("svc_backup", "Backup", "Service", "Information Technology", "Service account (nightly backup)", "Capitol City HQ", True, date(2015, 1, 1)),
    ]
    for uid, fn, ln, dept, title, office, priv, hire in fixed:
        seen.add(uid)
        users.append(dict(user_id=uid, first=fn, last=ln, dept=dept, title=title, office=office, priv=priv, hire=hire))
    total = sum(d[1] for d in DEPTS)
    while len(users) < N_USERS:
        fn, ln = rng.choice(FIRST), rng.choice(LAST)
        base = (fn[0] + ln).lower()
        uid, k = base, 2
        while uid in seen:
            uid, k = f"{base}{k}", k + 1
        seen.add(uid)
        x, acc = rng.random() * total, 0.0
        for dept in DEPTS:
            acc += dept[1]
            if x <= acc:
                break
        o = rng.random()
        office = "Capitol City HQ" if o < 0.60 else "Harbor Point" if o < 0.82 else "Eastgate"
        title = rng.choice(dept[2])
        priv = dept[0] == "Information Technology" and title in ("Systems Administrator", "Network Engineer", "Security Engineer")
        users.append(dict(user_id=uid, first=fn, last=ln, dept=dept[0], title=title, office=office, priv=priv,
                          hire=date(2008, 1, 1) + timedelta(days=rng.randint(0, 6200))))
    out = []
    for i, u in enumerate(users):
        eg, city, pfx, _ = OFFICES[u["office"]]
        svc = u["user_id"].startswith("svc_")
        remote = 0.0 if svc else (0.55 if u["dept"] in ("Audit & Compliance", "Research & Analytics") else 0.30)
        out.append(dict(
            user_id=u["user_id"], display_name=f"{u['first']} {u['last']}" if not svc else "svc_backup (service account)",
            email=f"{u['user_id']}@cdor.cascadia.gov", department=u["dept"], title=u["title"], office=u["office"],
            office_city=city, is_privileged=u["priv"], is_service_account=svc, account_status="enabled",
            hire_date=u["hire"], remote_work_share=remote,
            home_ip=None if svc else f"100.{64 + (i * 7) % 60}.{(i * 13) % 250 + 1}.{(i * 31) % 250 + 2}",
            laptop_id=None if svc else f"LT-{pfx}-{1000 + i:04d}"))
    for u in out:
        if u["user_id"] == HERO:
            u["laptop_id"], u["home_ip"] = "LT-HP-0412", "100.72.14.9"
        if u["user_id"] == DECOY:
            u["laptop_id"] = "LT-HQ-0088"
    return out


SERVERS = [
    ("DC-01", "domain_controller", "critical", "10.10.0.11", "Active Directory domain controller"),
    ("DC-02", "domain_controller", "critical", "10.10.0.12", "Active Directory domain controller"),
    ("FS-TAX-01", "file_server", "critical", "10.10.4.21", "Taxpayer audit case files (federal tax information + PII), share AuditCases"),
    ("FS-HR-01", "file_server", "high", "10.10.4.22", "HR personnel files"),
    ("FS-SHARE-01", "file_server", "medium", "10.10.4.23", "Department shared drives"),
    ("SQL-REV-01", "database_server", "critical", "10.10.5.31", "Revenue accounting database"),
    ("SQL-TCMS-01", "database_server", "critical", "10.10.5.32", "Tax Case Management System database"),
    ("APP-TCMS-01", "app_server", "high", "10.10.6.41", "Tax Case Management System (TCMS) app tier"),
    ("APP-ETAX-01", "app_server", "high", "10.10.6.42", "eTax taxpayer portal back end"),
    ("SRV-BKP-03", "backup_server", "high", "10.10.7.51", "Nightly backup media server"),
    ("SRV-MGMT-01", "jump_server", "high", "10.10.7.53", "IT admin jump host"),
    ("SRV-WSUS-01", "patch_server", "medium", "10.10.7.54", "Patch distribution"),
]
FIN_WS = [f"WS-FIN-{n:03d}" for n in range(11, 31)]


def build_assets(users):
    assets = []
    for u in users:
        if u["laptop_id"]:
            _, _, pfx, net = OFFICES[u["office"]]
            n = int(u["laptop_id"].split("-")[2])
            assets.append(dict(host_id=u["laptop_id"], asset_type="laptop", os="Windows 11 Enterprise", criticality="standard",
                               owner_user_id=u["user_id"], location=u["office"], ip_address=f"10.{net}.{(n // 250) % 250}.{n % 250 + 2}",
                               description=f"Managed laptop of {u['display_name']}", edr_installed=True))
    fin = [u["user_id"] for u in users if u["department"] == "Finance" and u["user_id"] != FIN_OWNER]
    for i, h in enumerate(FIN_WS):
        owner = FIN_OWNER if h == "WS-FIN-022" else fin[i % len(fin)]
        assets.append(dict(host_id=h, asset_type="workstation", os="Windows 11 Enterprise", criticality="high",
                           owner_user_id=owner, location="Capitol City HQ", ip_address=f"10.10.12.{100 + i}",
                           description="Finance desktop (RDP enabled for remote accountants)", edr_installed=True))
    for h, t, c, ip, desc in SERVERS:
        assets.append(dict(host_id=h, asset_type=t, os="Windows Server 2022", criticality=c, owner_user_id=None,
                           location="Capitol City HQ", ip_address=ip, description=desc, edr_installed=True))
    return assets


# ─────────────────────────────────────────────────────────────────────────────
# ATT&CK techniques referenced by the IR playbook + CDOR detection coverage
# ─────────────────────────────────────────────────────────────────────────────
TECHNIQUES = [  # id, name, tactic, coverage, detecting rule, playbook section
    ("T1566.002", "Phishing: Spearphishing Link", "Initial Access", "full", "Phishing email reported", "PB-3.1"),
    ("T1190", "Exploit Public-Facing Application", "Initial Access", "full", "WAF critical signature on eTax portal", "PB-3.3"),
    ("T1133", "External Remote Services", "Initial Access", "partial", "VPN login from new country", "PB-2.3"),
    ("T1078", "Valid Accounts", "Defense Evasion", "partial", "Impossible travel", "PB-2.3"),
    ("T1110.001", "Brute Force: Password Guessing", "Credential Access", "full", "Multiple failed logins (>5 in 10 min)", "PB-2.1"),
    ("T1110.003", "Brute Force: Password Spraying", "Credential Access", "none", None, "PB-2.1"),
    ("T1621", "Multi-Factor Authentication Request Generation", "Credential Access", "none", None, "PB-2.2"),
    ("T1003.001", "OS Credential Dumping: LSASS Memory", "Credential Access", "full", "EDR credential theft", "PB-4.3"),
    ("T1558.003", "Steal or Forge Kerberos Tickets: Kerberoasting", "Credential Access", "partial", "Service account interactive logon", "PB-4.3"),
    ("T1098.005", "Account Manipulation: Device Registration", "Persistence", "none", None, "PB-2.2"),
    ("T1136.002", "Create Account: Domain Account", "Persistence", "full", "New privileged account", "PB-4.3"),
    ("T1059.001", "Command and Scripting Interpreter: PowerShell", "Execution", "full", "EDR suspicious PowerShell", "PB-4.1"),
    ("T1204.002", "User Execution: Malicious File", "Execution", "full", "Malware detected by EDR", "PB-3.2"),
    ("T1036.005", "Masquerading: Match Legitimate Name or Location", "Defense Evasion", "none", None, "PB-4.1"),
    ("T1070.001", "Indicator Removal: Clear Windows Event Logs", "Defense Evasion", "full", "Security log cleared", "PB-4.1"),
    ("T1087.002", "Account Discovery: Domain Account", "Discovery", "partial", "Admin tool executed on workstation", "PB-4.2"),
    ("T1482", "Domain Trust Discovery", "Discovery", "partial", "Admin tool executed on workstation", "PB-4.2"),
    ("T1033", "System Owner/User Discovery", "Discovery", "partial", "Admin tool executed on workstation", "PB-4.2"),
    ("T1021.001", "Remote Services: Remote Desktop Protocol", "Lateral Movement", "none", None, "PB-4.1"),
    ("T1039", "Data from Network Shared Drive", "Collection", "none", None, "PB-5.1"),
    ("T1560.001", "Archive Collected Data: Archive via Utility", "Collection", "none", None, "PB-5.1"),
    ("T1071.004", "Application Layer Protocol: DNS", "Command and Control", "partial", "DNS query to newly registered domain", "PB-5.2"),
    ("T1048.003", "Exfiltration Over Unencrypted Non-C2 Protocol", "Exfiltration", "none", None, "PB-5.2"),
    ("T1041", "Exfiltration Over C2 Channel", "Exfiltration", "partial", "Large outbound transfer", "PB-5.2"),
    ("T1567.002", "Exfiltration to Cloud Storage", "Exfiltration", "partial", "Large outbound transfer", "PB-5.2"),
    ("T1486", "Data Encrypted for Impact", "Impact", "full", "Malware detected by EDR", "PB-6.1"),
    ("T1490", "Inhibit System Recovery", "Impact", "full", "EDR shadow-copy deletion", "PB-6.1"),
    ("T1498", "Network Denial of Service", "Impact", "full", "eTax portal DDoS", "PB-6.2"),
]

ALERT_RULES = [  # rule_id, rule_name, source, severity, per weekday, true-positive rate, technique, entity kind
    ("R-101", "Impossible travel", "Identity", "medium", 21, 0.006, "T1078", "user"),
    ("R-102", "Multiple failed logins (>5 in 10 min)", "Identity", "medium", 14, 0.03, "T1110.001", "user"),
    ("R-103", "VPN login from new country", "Identity", "medium", 6, 0.02, "T1133", "user"),
    ("R-201", "Malware detected by EDR", "EDR", "high", 4, 0.42, "T1204.002", "host"),
    ("R-202", "Admin tool executed on workstation", "EDR", "low", 9, 0.02, "T1087.002", "host"),
    ("R-203", "EDR suspicious PowerShell", "EDR", "high", 3, 0.18, "T1059.001", "host"),
    ("R-301", "Phishing email reported", "Email", "low", 17, 0.12, "T1566.002", "user"),
    ("R-401", "DNS query to newly registered domain", "Network", "low", 28, 0.008, "T1071.004", "host"),
    ("R-402", "Large outbound transfer", "Network", "medium", 5, 0.04, "T1041", "host"),
    ("R-403", "Service account interactive logon", "Identity", "high", 2, 0.05, "T1558.003", "user"),
]
TIER1 = ["t1.rsingh", "t1.bcole", "t1.mfernandez", "t1.jpark"]


def build_alerts(users, assets):
    rows = []
    uids = [u["user_id"] for u in users if not u["is_service_account"] and u["user_id"] not in (HERO, DECOY)]
    hosts = [a["host_id"] for a in assets if a["host_id"] != "WS-FIN-022"]
    n = 0
    for back in range(WINDOW_DAYS, 0, -1):
        day = D(back)
        wk = 0.35 if day.weekday() >= 5 else 1.0
        for rid, name, src, sev, per_day, tp, tech, kind in ALERT_RULES:
            for _ in range(max(0, int(rng.gauss(per_day * wk, per_day * 0.2)))):
                n += 1
                created = ts(day, rng.randint(0, 23), rng.randint(0, 59), rng.randint(0, 59))
                is_tp = rng.random() < tp
                ack = created + timedelta(minutes=max(3, rng.gauss(35 if sev == "high" else 95, 40)))
                closed = ack + timedelta(minutes=max(5, rng.gauss(600, 200) if is_tp else rng.gauss(50, 30)))
                done = closed.date() < AS_OF
                disp = ("true_positive" if is_tp else "benign_true_positive" if rng.random() < 0.25 else "false_positive") if done else "open"
                rows.append(dict(alert_id=f"AL-{n:06d}", created_ts=created, rule_id=rid, rule_name=name, source=src, severity=sev,
                                 entity_user=rng.choice(uids) if kind == "user" else None,
                                 entity_host=rng.choice(hosts) if kind == "host" else None, src_ip=None, technique_id=tech,
                                 disposition=disp, acknowledged_ts=ack if done else None, closed_ts=closed if done else None,
                                 analyst=rng.choice(TIER1) if done else None, analyst_note=None))
    scripted = [
        ("AL-900417", ts(D(6), 3, 9, 12), "R-101", "Impossible travel", "Identity", "medium", HERO, None, FOOTHOLD_IP, "T1078",
         "false_positive", ts(D(6), 8, 31), ts(D(6), 8, 42), "t1.bcole", "Field auditor, travels often; MFA was approved. Closing as FP."),
        ("AL-900588", ts(D(6), 3, 44, 5), "R-401", "DNS query to newly registered domain", "Network", "low", None, "WS-FIN-022", None,
         "T1071.004", "false_positive", ts(D(6), 9, 12), ts(D(6), 9, 15), "t1.rsingh", "Looks like a CDN endpoint. Low severity, closing."),
        ("AL-900611", ts(D(3), 8, 14, 40), "R-101", "Impossible travel", "Identity", "medium", DECOY, None, HOTEL_IP, "T1078",
         "open", None, None, None, None),
        ("AL-900702", ts(D(1), 6, 0, 3), "U-001", "UEBA high-risk entity", "UEBA", "high", HERO, None, None, "T1078",
         "open", None, None, None, None),
    ]
    for a in scripted:
        rows.append(dict(zip(["alert_id", "created_ts", "rule_id", "rule_name", "source", "severity", "entity_user", "entity_host",
                              "src_ip", "technique_id", "disposition", "acknowledged_ts", "closed_ts", "analyst", "analyst_note"], a)))
    return rows


INCIDENT_CATS = [  # category, share, MTTD hours, MTTR hours, severity weights (low, medium, high)
    ("phishing", 0.34, 6, 5, (0.6, 0.35, 0.05)),
    ("malware", 0.22, 0.6, 3.5, (0.4, 0.45, 0.15)),
    ("credential_compromise", 0.16, 330, 30, (0.2, 0.5, 0.3)),
    ("data_mishandling", 0.10, 120, 20, (0.5, 0.4, 0.1)),
    ("web_application_attack", 0.08, 4, 8, (0.4, 0.4, 0.2)),
    ("lost_or_stolen_device", 0.07, 20, 2, (0.8, 0.2, 0.0)),
    ("denial_of_service", 0.03, 0.2, 2.5, (0.3, 0.5, 0.2)),
]
UNITS = ["Taxpayer Services", "Audit & Compliance", "Collections", "Finance", "IT", "eTax portal", "Executive Office"]


def build_incidents():
    rows, n, day, start = [], 0, D(548), D(548)
    while day < D(10):
        m = (day - start).days / 30.0
        if rng.random() < 0.26 + 0.004 * m:
            n += 1
            x, acc = rng.random(), 0.0
            for cat, share, mttd, mttr, sw in INCIDENT_CATS:
                acc += share
                if x <= acc:
                    break
            # endpoint/email detections improve ~2%/month; identity-based ones get WORSE (no spray/MFA-fatigue detections)
            f = 1.0 - 0.02 * m if cat not in ("credential_compromise", "data_mishandling") else 1.0 + 0.012 * m
            first = ts(day, rng.randint(0, 23), rng.randint(0, 59))
            detected = first + timedelta(hours=max(0.05, rng.expovariate(1 / (mttd * f))))
            contained = detected + timedelta(hours=max(0.25, rng.expovariate(1 / (mttr * max(0.6, f)))))
            closed = contained + timedelta(days=rng.randint(1, 14))
            src = ("user_report" if cat in ("phishing", "lost_or_stolen_device") and rng.random() < 0.6
                   else "external_notification" if cat in ("credential_compromise", "data_mishandling") and rng.random() < 0.45
                   else rng.choice(["SIEM", "EDR", "Email gateway", "WAF"]))
            sev = rng.choices(["low", "medium", "high"], weights=sw)[0]
            rows.append(dict(incident_id=f"IR-{first.year}-{n:04d}", category=cat, severity=sev,
                             title=f"{cat.replace('_', ' ').capitalize()} ({rng.choice(UNITS)})",
                             first_malicious_ts=first, detected_ts=detected, contained_ts=contained, closed_ts=closed,
                             detection_source=src,
                             records_affected=int(rng.expovariate(1 / 400)) if cat in ("credential_compromise", "data_mishandling") else 0,
                             reported_to_fusion_center=sev == "high"))
        day += timedelta(days=1)
    return rows


def build_travel(users):
    rows = [dict(travel_id="TR-2026-118", user_id=DECOY, destination_city="Vancouver", destination_country="CA",
                 start_date=D(4), end_date=D(0), purpose="Cascadia GovTech Summit (speaker, identity modernization track)",
                 approved_by="gtran")]
    cands = [u["user_id"] for u in users if not u["is_service_account"] and u["user_id"] not in (HERO, DECOY)]
    for i in range(46):
        s = D(rng.randint(5, 88))
        city, ctry = rng.choice([("Seattle", "US"), ("Sacramento", "US"), ("Denver", "US"), ("Washington", "US"),
                                 ("Toronto", "CA"), ("Boise", "US"), ("Chicago", "US")])
        rows.append(dict(travel_id=f"TR-2026-{i + 60:03d}", user_id=rng.choice(cands), destination_city=city,
                         destination_country=ctry, start_date=s, end_date=s + timedelta(days=rng.randint(1, 4)),
                         purpose=rng.choice(["Multistate tax commission meeting", "Field audit", "Training", "Conference"]),
                         approved_by="dept.manager"))
    return rows


def build_tickets(users):
    rows = [
        dict(ticket_id="HD-58213", user_id="pwhitaker", opened_ts=ts(D(5), 9, 12), category="MFA / authenticator",
             summary="New phone — old authenticator app still enrolled, please move MFA to the new iPhone", status="resolved", resolved_by="t1.jpark"),
        dict(ticket_id="HD-58190", user_id="tnakamura", opened_ts=ts(D(19), 8, 30), category="Access request",
             summary="New Service Desk hire: grant remote-assistance (RDP) rights to Taxpayer Services laptops", status="resolved", resolved_by="it.manager"),
        dict(ticket_id="HD-58240", user_id="cvasquez", opened_ts=ts(D(3), 15, 2), category="Audit program",
             summary="Q3 statistical audit sampling — pulling 1,450 case files this week (FYI to SOC)", status="resolved", resolved_by="audit.director"),
    ]
    cands = [u["user_id"] for u in users if not u["is_service_account"] and u["user_id"] not in (HERO, DECOY)]
    cats = [("Password reset", "Forgot password, locked out"), ("Software install", "Install approved software"),
            ("Hardware", "Docking station not detecting monitors"), ("MFA / authenticator", "Re-register authenticator"),
            ("Access request", "Access to department share")]
    for i in range(80):
        c = rng.choice(cats)
        rows.append(dict(ticket_id=f"HD-{57400 + i * 9}", user_id=rng.choice(cands), opened_ts=ts(D(rng.randint(6, 89)), rng.randint(8, 16), rng.randint(0, 59)),
                         category=c[0], summary=c[1], status="resolved", resolved_by=rng.choice(TIER1)))
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Telemetry schemas
# ─────────────────────────────────────────────────────────────────────────────
NTZ, STR, INT, LNG, DBL, BOOL, DATE = (T.TimestampNTZType(), T.StringType(), T.IntegerType(), T.LongType(),
                                       T.DoubleType(), T.BooleanType(), T.DateType())
AUTH_COLS = [("event_ts", NTZ), ("user_id", STR), ("src_ip", STR), ("asn", STR), ("asn_org", STR), ("geo_country", STR),
             ("geo_city", STR), ("application", STR), ("result", STR), ("failure_reason", STR), ("mfa_result", STR),
             ("device_id", STR), ("device_managed", BOOL), ("user_agent", STR)]
VPN_COLS = [("user_id", STR), ("session_start", NTZ), ("session_end", NTZ), ("src_ip", STR), ("asn", STR), ("asn_org", STR),
            ("geo_country", STR), ("geo_city", STR), ("device_id", STR), ("device_managed", BOOL), ("posture", STR),
            ("assigned_ip", STR), ("bytes_in", LNG), ("bytes_out", LNG)]
EP_COLS = [("event_ts", NTZ), ("host_id", STR), ("user_id", STR), ("event_type", STR), ("logon_type", INT), ("src_ip", STR),
           ("src_host", STR), ("process_name", STR), ("command_line", STR), ("parent_process", STR), ("file_path", STR),
           ("file_count", INT), ("bytes", LNG)]
DNS_COLS = [("event_ts", NTZ), ("host_id", STR), ("src_ip", STR), ("query", STR), ("query_type", STR),
            ("response_code", STR), ("label_entropy", DBL), ("response_bytes", INT)]


def schema(cols):
    return T.StructType([T.StructField(n, t, True) for n, t in cols])


def row(cols, **kw):
    return tuple(kw.get(n) for n, _ in cols)


def R(key: str, salt: str) -> str:
    """Deterministic uniform [0,1) from a SQL key expression."""
    return f"(pmod(xxhash64({key}, '{salt}'), 1000003) / 1000003.0)"


def MK(dcol: str, h: str, m: str, s: str = "0") -> str:
    return f"make_timestamp_ntz(year({dcol}), month({dcol}), day({dcol}), {h}, {m}, {s})"


BENIGN_DOMAINS = ["cdor.cascadia.gov", "tcms.cdor.cascadia.gov", "etax.cascadia.gov", "outlook.office365.com",
                  "login.microsoftonline.com", "www.bing.com", "windowsupdate.com", "teams.microsoft.com", "irs.gov",
                  "www.google.com", "fonts.gstatic.com", "cdn.jsdelivr.net", "cascadia.gov", "ocsp.digicert.com",
                  "time.windows.com", "news.cascadia-herald.example", "weather.example", "sharepoint.com"]
PROCESSES = ["msedge.exe", "outlook.exe", "excel.exe", "winword.exe", "teams.exe", "acrord32.exe", "tcms_client.exe",
             "explorer.exe", "onedrive.exe", "notepad.exe"]


def background(spark, fqs):
    """~1.1M auth/endpoint/DNS rows of normal behaviour, generated in Spark SQL (deterministic)."""
    spark.sql(f"CREATE OR REPLACE TEMP VIEW days AS SELECT explode(sequence(date_sub(DATE'{AS_OF}', {WINDOW_DAYS}), date_sub(DATE'{AS_OF}', 1))) AS d")
    spark.sql(f"""CREATE OR REPLACE TEMP VIEW ud AS
        SELECT u.*, d.d, dayofweek(d.d) IN (1,7) AS weekend,
               {R("concat(u.user_id, d.d)", "remote")} < u.remote_work_share AS remote_day,
               CASE u.office WHEN 'Harbor Point' THEN '198.51.100.20' WHEN 'Eastgate' THEN '198.51.100.30' ELSE '198.51.100.10' END AS egress_ip
        FROM {fqs}.identities u CROSS JOIN days d
        WHERE NOT (u.user_id = '{DECOY}' AND d.d >= DATE'{D(3)}')""")
    doms = "array(" + ",".join(f"'{x}'" for x in BENIGN_DOMAINS) + ")"
    procs = "array(" + ",".join(f"'{x}'" for x in PROCESSES) + ")"
    k = "concat(user_id, d, i)"
    auth = spark.sql(f"""
      WITH b AS (SELECT *, CASE WHEN is_service_account THEN 0
                                WHEN weekend THEN IF({R("concat(user_id,d)", "we")} < 0.12, 1, 0)
                                ELSE 2 + CAST({R("concat(user_id,d)", "n")} * 4 AS INT) END AS n FROM ud),
           x AS (SELECT *, explode(sequence(1, n)) AS i FROM b WHERE n > 0)
      SELECT {MK("d", f"7 + CAST({R(k, 'h')} * 11 AS INT)", f"CAST({R(k, 'm')} * 60 AS INT)", f"CAST({R(k, 's')} * 60 AS INT)")} AS event_ts,
             user_id, IF(remote_day, home_ip, egress_ip) AS src_ip,
             IF(remote_day, '{HOME_ISP[0]}', '{STATE_NET[0]}') AS asn, IF(remote_day, '{HOME_ISP[1]}', '{STATE_NET[1]}') AS asn_org,
             'US' AS geo_country, office_city AS geo_city,
             element_at(array('CDOR SSO portal', 'Microsoft 365', 'Tax Case Management System', 'VPN gateway'), 1 + CAST({R(k, 'app')} * 4 AS INT)) AS application,
             IF({R(k, 'f')} < 0.025, 'failure', 'success') AS result,
             IF({R(k, 'f')} < 0.025, 'invalid_password', NULL) AS failure_reason,
             IF({R(k, 'f')} < 0.025, NULL, IF({R(k, 'mfa')} < 0.5, 'approved', 'not_required')) AS mfa_result,
             laptop_id AS device_id, TRUE AS device_managed,
             'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/128.0' AS user_agent
      FROM x""")
    vpn = spark.sql(f"""
      SELECT user_id, {MK("d", f"7 + CAST({R('concat(user_id,d)', 'vh')} * 3 AS INT)", f"CAST({R('concat(user_id,d)', 'vm')} * 60 AS INT)")} AS session_start,
             {MK("d", f"13 + CAST({R('concat(user_id,d)', 've')} * 5 AS INT)", f"CAST({R('concat(user_id,d)', 'vm2')} * 60 AS INT)")} AS session_end,
             home_ip AS src_ip, '{HOME_ISP[0]}' AS asn, '{HOME_ISP[1]}' AS asn_org, 'US' AS geo_country, office_city AS geo_city,
             laptop_id AS device_id, TRUE AS device_managed, 'compliant' AS posture,
             concat('10.200.', CAST(pmod(xxhash64(user_id), 200) AS STRING), '.', CAST(pmod(xxhash64(user_id, d), 250) + 2 AS STRING)) AS assigned_ip,
             CAST(5e7 + {R('concat(user_id,d)', 'bi')} * 8e8 AS BIGINT) AS bytes_in,
             CAST(5e6 + {R('concat(user_id,d)', 'bo')} * 1.2e8 AS BIGINT) AS bytes_out
      FROM ud WHERE remote_day AND NOT weekend AND NOT is_service_account""")
    spark.sql(f"""CREATE OR REPLACE TEMP VIEW own_ws AS SELECT owner_user_id, host_id AS ws FROM {fqs}.assets WHERE asset_type = 'workstation'""")
    ep = spark.sql(f"""
      WITH w AS (SELECT ud.*, o.ws FROM ud LEFT JOIN own_ws o ON o.owner_user_id = ud.user_id
                 WHERE NOT weekend AND NOT is_service_account),
      logon AS (SELECT {MK("d", "8", f"CAST({R('concat(user_id,d)', 'lm')} * 50 AS INT)")} AS event_ts, laptop_id AS host_id, user_id,
                       'logon' AS event_type, IF(remote_day, 11, 2) AS logon_type, NULL AS src_ip, NULL AS src_host,
                       NULL AS process_name, NULL AS command_line, NULL AS parent_process, NULL AS file_path,
                       CAST(NULL AS INT) AS file_count, CAST(NULL AS BIGINT) AS bytes FROM w),
      procs AS (SELECT {MK("d", f"8 + CAST({R(k, 'ph')} * 9 AS INT)", f"CAST({R(k, 'pm')} * 60 AS INT)")} AS event_ts,
                       laptop_id AS host_id, user_id, 'process_start' AS event_type, CAST(NULL AS INT) AS logon_type, NULL AS src_ip,
                       NULL AS src_host, element_at({procs}, 1 + CAST({R(k, 'p')} * {len(PROCESSES)} AS INT)) AS process_name,
                       NULL AS command_line, 'explorer.exe' AS parent_process, NULL AS file_path,
                       CAST(NULL AS INT) AS file_count, CAST(NULL AS BIGINT) AS bytes
                FROM (SELECT *, explode(sequence(1, 5)) AS i FROM w)),
      files AS (SELECT {MK("d", f"9 + CAST({R('concat(user_id,d)', 'fh')} * 7 AS INT)", f"CAST({R('concat(user_id,d)', 'fm')} * 60 AS INT)")} AS event_ts,
                       IF(department = 'Audit & Compliance', 'FS-TAX-01', 'FS-SHARE-01') AS host_id, user_id, 'file_read' AS event_type,
                       CAST(NULL AS INT) AS logon_type, NULL AS src_ip, laptop_id AS src_host, NULL AS process_name, NULL AS command_line,
                       NULL AS parent_process,
                       IF(department = 'Audit & Compliance', concat('\\\\\\\\FS-TAX-01\\\\AuditCases\\\\', year(d), '\\\\'), concat('\\\\\\\\FS-SHARE-01\\\\', replace(department, ' ', ''), '\\\\')) AS file_path,
                       CAST(3 + {R('concat(user_id,d)', 'fc')} * 45 AS INT) AS file_count, CAST(NULL AS BIGINT) AS bytes
                FROM w WHERE {R('concat(user_id,d)', 'fr')} < 0.7),
      rdp AS (SELECT {MK("d", f"9 + CAST({R('concat(user_id,d)', 'rh')} * 7 AS INT)", f"CAST({R('concat(user_id,d)', 'rm')} * 60 AS INT)")} AS event_ts,
                     coalesce(ws, 'SRV-MGMT-01') AS host_id, user_id, 'logon' AS event_type, 10 AS logon_type, NULL AS src_ip,
                     laptop_id AS src_host, NULL AS process_name, NULL AS command_line, NULL AS parent_process, NULL AS file_path,
                     CAST(NULL AS INT) AS file_count, CAST(NULL AS BIGINT) AS bytes
              FROM w WHERE (ws IS NOT NULL AND {R('concat(user_id,d)', 'rdp')} < 0.35)
                        OR (is_privileged AND {R('concat(user_id,d)', 'rdp')} < 0.45)),
      admin AS (SELECT {MK("d", f"10 + CAST({R('concat(user_id,d)', 'ah')} * 6 AS INT)", f"CAST({R('concat(user_id,d)', 'am')} * 60 AS INT)")} AS event_ts,
                       'SRV-MGMT-01' AS host_id, user_id, 'process_start' AS event_type, CAST(NULL AS INT) AS logon_type, NULL AS src_ip,
                       NULL AS src_host, IF({R('concat(user_id,d)', 'ac')} < 0.5, 'net.exe', 'nltest.exe') AS process_name,
                       IF({R('concat(user_id,d)', 'ac')} < 0.5, 'net group "Domain Admins" /domain', 'nltest /dclist:CDOR') AS command_line,
                       'cmd.exe' AS parent_process, NULL AS file_path, CAST(NULL AS INT) AS file_count, CAST(NULL AS BIGINT) AS bytes
                FROM w WHERE is_privileged AND {R('concat(user_id,d)', 'adm')} < 0.06),
      bkp AS (SELECT {MK("d", "1", f"CAST({R('concat(f,d)', 'bm')} * 50 AS INT)")} AS event_ts, f AS host_id, 'svc_backup' AS user_id,
                     'file_read' AS event_type, CAST(NULL AS INT) AS logon_type, '10.10.7.51' AS src_ip, 'SRV-BKP-03' AS src_host,
                     'bkpagent.exe' AS process_name, NULL AS command_line, 'services.exe' AS parent_process,
                     concat('\\\\\\\\', f, '\\\\') AS file_path, CAST(18000 + {R('concat(f,d)', 'bc')} * 9000 AS INT) AS file_count,
                     CAST(4e10 + {R('concat(f,d)', 'bb')} * 2e10 AS BIGINT) AS bytes
              FROM days CROSS JOIN (SELECT explode(array('FS-TAX-01', 'FS-HR-01', 'FS-SHARE-01')) AS f))
      SELECT * FROM logon UNION ALL SELECT * FROM procs UNION ALL SELECT * FROM files
      UNION ALL SELECT * FROM rdp UNION ALL SELECT * FROM admin UNION ALL SELECT * FROM bkp""")
    dns = spark.sql(f"""
      WITH h AS (SELECT a.host_id, a.ip_address, a.asset_type, d.d, dayofweek(d.d) IN (1,7) AS weekend
                 FROM {fqs}.assets a CROSS JOIN days d),
           x AS (SELECT *, explode(sequence(1, IF(asset_type = 'laptop' OR asset_type = 'workstation', IF(weekend, 1, 10), 8))) AS i FROM h)
      SELECT {MK("d", f"IF(asset_type IN ('laptop','workstation'), 7 + CAST({R('concat(host_id,d,i)', 'dh')} * 11 AS INT), CAST({R('concat(host_id,d,i)', 'dh')} * 24 AS INT))",
                f"CAST({R('concat(host_id,d,i)', 'dm')} * 60 AS INT)", f"CAST({R('concat(host_id,d,i)', 'ds')} * 60 AS INT)")} AS event_ts,
             host_id, ip_address AS src_ip, element_at({doms}, 1 + CAST({R('concat(host_id,d,i)', 'q')} * {len(BENIGN_DOMAINS)} AS INT)) AS query,
             IF({R('concat(host_id,d,i)', 't')} < 0.85, 'A', 'AAAA') AS query_type,
             IF({R('concat(host_id,d,i)', 'rc')} < 0.02, 'NXDOMAIN', 'NOERROR') AS response_code,
             round(1.6 + {R('concat(host_id,d,i)', 'e')} * 1.5, 2) AS label_entropy,
             CAST(60 + {R('concat(host_id,d,i)', 'rb')} * 200 AS INT) AS response_bytes
      FROM x""")
    return auth, vpn, ep, dns


def entropy(s: str) -> float:
    c = {ch: s.count(ch) for ch in set(s)}
    return round(-sum(v / len(s) * math.log2(v / len(s)) for v in c.values()), 2)


def rand_label(n: int) -> str:
    return "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(n))


def attack_rows(users):
    auth, vpn, ep, dns = [], [], [], []
    A = lambda **k: auth.append(row(AUTH_COLS, **k))  # noqa: E731
    host_ua = "python-requests/2.31"
    # ── 1. password spray, D-24 .. D-6, <=1 guess per account per day ──────────────────────
    pool = [u["user_id"] for u in users if not u["is_service_account"] and u["user_id"] not in (HERO, DECOY, "mokafor", "gtran")]
    targets = rng.sample(pool, 211) + [HERO]
    for t in targets:
        day = D(24) + timedelta(days=rng.randint(0, 2))
        while day <= D(6):
            if t == HERO and day == D(6):
                break
            hh = rng.choice([0, 1, 2, 3, 4, 5, 13, 14, 22, 23])
            ip = rng.choice(ATTACK_IPS)
            A(event_ts=ts(day, hh, rng.randint(0, 59), rng.randint(0, 59)), user_id=t, src_ip=ip, asn=HOSTING[0], asn_org=HOSTING[1],
              geo_country=HOSTING[2], geo_city=HOSTING[3], application="CDOR SSO portal", result="failure",
              failure_reason="invalid_password", mfa_result=None, device_id=None, device_managed=False, user_agent=host_ua)
            day += timedelta(days=rng.choice([1, 2, 2, 2, 3]))
    # ── 2. the guess that works + MFA fatigue + new device (D-6) ───────────────────────────
    f6 = D(6)
    A(event_ts=ts(f6, 2, 47, 18), user_id=HERO, src_ip=FOOTHOLD_IP, asn=HOSTING[0], asn_org=HOSTING[1], geo_country="NL",
      geo_city="Amsterdam", application="CDOR SSO portal", result="failure", failure_reason="mfa_required", mfa_result="pending",
      device_id=None, device_managed=False, user_agent=host_ua)
    for (mm, res) in [(48, "denied"), (51, "timeout"), (54, "denied"), (57, "timeout"), (60, "denied")]:
        A(event_ts=ts(f6, 2 + mm // 60, mm % 60, 5), user_id=HERO, src_ip=FOOTHOLD_IP, asn=HOSTING[0], asn_org=HOSTING[1],
          geo_country="NL", geo_city="Amsterdam", application="CDOR SSO portal", result="failure",
          failure_reason=f"mfa_{res}", mfa_result=res, device_id=None, device_managed=False, user_agent="Mozilla/5.0 (X11; Linux x86_64)")
    A(event_ts=ts(f6, 3, 4, 41), user_id=HERO, src_ip=FOOTHOLD_IP, asn=HOSTING[0], asn_org=HOSTING[1], geo_country="NL",
      geo_city="Amsterdam", application="CDOR SSO portal", result="success", failure_reason=None, mfa_result="approved",
      device_id=ATTACKER_PC, device_managed=False, user_agent="Mozilla/5.0 (X11; Linux x86_64)")
    A(event_ts=ts(f6, 3, 6, 2), user_id=HERO, src_ip=FOOTHOLD_IP, asn=HOSTING[0], asn_org=HOSTING[1], geo_country="NL",
      geo_city="Amsterdam", application="Authenticator device registration", result="success", failure_reason=None,
      mfa_result="approved", device_id="new authenticator: Pixel-7a (unregistered)", device_managed=False,
      user_agent="Mozilla/5.0 (X11; Linux x86_64)")
    # ── 3. five nights of VPN from the unmanaged PC ─────────────────────────────────────────
    nights = [(6, 3, 8, 5, 41), (5, 2, 12, 4, 55), (4, 1, 58, 4, 49), (3, 1, 21, 4, 38), (2, 2, 4, 4, 17)]
    for back, h1, m1, h2, m2 in nights:
        day = D(back)
        if back != 6:
            A(event_ts=ts(day, h1, m1 - 2 if m1 >= 2 else 0, 30), user_id=HERO, src_ip=FOOTHOLD_IP, asn=HOSTING[0], asn_org=HOSTING[1],
              geo_country="NL", geo_city="Amsterdam", application="VPN gateway", result="success", failure_reason=None,
              mfa_result="approved", device_id=ATTACKER_PC, device_managed=False, user_agent="Mozilla/5.0 (X11; Linux x86_64)")
        vpn.append(row(VPN_COLS, user_id=HERO, session_start=ts(day, h1, m1), session_end=ts(day, h2, m2), src_ip=FOOTHOLD_IP,
                       asn=HOSTING[0], asn_org=HOSTING[1], geo_country="NL", geo_city="Amsterdam", device_id=ATTACKER_PC,
                       device_managed=False, posture="non_compliant (no EDR agent)", assigned_ip=VPN_IP_ATTACK,
                       bytes_in=rng.randint(80, 160) * 10**6, bytes_out=rng.randint(40, 90) * 10**6))
        # RDP into WS-FIN-022 every night
        ep.append(row(EP_COLS, event_ts=ts(day, h1, m1) + timedelta(minutes=9), host_id="WS-FIN-022", user_id=HERO, event_type="logon", logon_type=10,
                      src_ip=VPN_IP_ATTACK, src_host=ATTACKER_PC))
    E = lambda day, h, m, proc, cmd, parent="cmd.exe", **k: ep.append(row(EP_COLS, event_ts=ts(day, h, m, rng.randint(0, 59)),  # noqa: E731
                                                                         host_id="WS-FIN-022", user_id=HERO, event_type="process_start",
                                                                         process_name=proc, command_line=cmd, parent_process=parent, **k))
    # ── 4. discovery on WS-FIN-022 (D-6) ────────────────────────────────────────────────────
    for m, proc, cmd in [(22, "whoami.exe", "whoami /all"), (24, "net.exe", 'net user dmorales /domain'),
                         (25, "net.exe", 'net group "Domain Admins" /domain'), (27, "nltest.exe", "nltest /domain_trusts"),
                         (28, "nltest.exe", "nltest /dclist:CDOR"), (31, "net.exe", "net view \\\\FS-TAX-01")]:
        E(f6, 3, m, proc, cmd)
    # masquerading beacon binary dropped + started
    ep.append(row(EP_COLS, event_ts=ts(f6, 3, 38, 12), host_id="WS-FIN-022", user_id=HERO, event_type="file_write",
                  file_path="C:\\Users\\Public\\Music\\OneDriveUpdater.exe", file_count=1, bytes=2_418_688))
    E(f6, 3, 40, "OneDriveUpdater.exe", "C:\\Users\\Public\\Music\\OneDriveUpdater.exe --silent", parent="explorer.exe")
    # ── 5. collection from FS-TAX-01 (D-5, D-4) ─────────────────────────────────────────────
    left = 4812
    for back, hh, batches in [(5, 2, 9), (4, 2, 7)]:
        for b in range(batches):
            nfiles = left if (back == 4 and b == batches - 1) else rng.randint(260, 330)
            left -= nfiles
            ep.append(row(EP_COLS, event_ts=ts(D(back), hh + b // 4, (b * 13) % 60, rng.randint(0, 59)), host_id="FS-TAX-01",
                          user_id=HERO, event_type="file_read", src_ip="10.10.12.111", src_host="WS-FIN-022",
                          process_name="System", file_path=f"\\\\FS-TAX-01\\AuditCases\\2025\\Batch-{b + 1:02d}\\",
                          file_count=nfiles, bytes=nfiles * rng.randint(380_000, 460_000)))
    E(D(4), 4, 12, "robocopy.exe", 'robocopy \\\\FS-TAX-01\\AuditCases\\2025 C:\\Users\\Public\\Music\\c /E /R:0 /NP')
    E(D(4), 4, 26, "7z.exe", '7z.exe a -mhe=on -p***** C:\\Users\\Public\\Music\\cache_0412.7z C:\\Users\\Public\\Music\\c\\*')
    ep.append(row(EP_COLS, event_ts=ts(D(4), 4, 39, 50), host_id="WS-FIN-022", user_id=HERO, event_type="file_write",
                  process_name="7z.exe", file_path="C:\\Users\\Public\\Music\\cache_0412.7z", file_count=1, bytes=1_964_331_008))
    E(D(4), 4, 41, "cmd.exe", 'cmd /c rmdir /s /q C:\\Users\\Public\\Music\\c', parent="explorer.exe")
    # ── 6. DNS: beacon every ~5 min from D-6 03:41, TXT exfil D-3 and D-2 ──────────────────
    t = ts(f6, 3, 41, 3)
    end = ts(D(0), 0, 0)
    while t < end:
        lbl = rand_label(12)
        dns.append(row(DNS_COLS, event_ts=t, host_id="WS-FIN-022", src_ip="10.10.12.111", query=f"{lbl}.{ATTACK_DOMAIN}",
                       query_type="A", response_code="NOERROR", label_entropy=entropy(lbl), response_bytes=76))
        t += timedelta(seconds=300 + rng.randint(-25, 25))
    for back, h1, h2, n in [(3, 1, 4, 31000), (2, 2, 4, 27000)]:
        span = (h2 - h1) * 3600
        for i in range(n):
            lbl = rand_label(52)
            dns.append(row(DNS_COLS, event_ts=ts(D(back), h1, 0) + timedelta(seconds=int(i * span / n)), host_id="WS-FIN-022",
                           src_ip="10.10.12.111", query=f"{lbl}.x.{ATTACK_DOMAIN}", query_type="TXT", response_code="NOERROR",
                           label_entropy=entropy(lbl), response_bytes=180))
    # hero's normal day-time life keeps going (background) — plus WS-FIN-022's owner is on leave? no: Alicia keeps working.
    # ── 7. decoy: Jenna Liu at a Vancouver conference, D-3 .. D-1 (all legit) ───────────────
    for back in (3, 2, 1):
        day = D(back)
        for hh, mm in [(8, 14), (12, 40), (16, 5)]:
            A(event_ts=ts(day, hh, mm, 11), user_id=DECOY, src_ip=HOTEL_IP, asn=HOTEL[0], asn_org=HOTEL[1], geo_country="CA",
              geo_city="Vancouver", application="CDOR SSO portal" if hh == 8 else "Microsoft 365", result="success",
              failure_reason=None, mfa_result="approved" if hh == 8 else "not_required", device_id="LT-HQ-0088",
              device_managed=True, user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/128.0")
        vpn.append(row(VPN_COLS, user_id=DECOY, session_start=ts(day, 8, 16), session_end=ts(day, 17, 2), src_ip=HOTEL_IP,
                       asn=HOTEL[0], asn_org=HOTEL[1], geo_country="CA", geo_city="Vancouver", device_id="LT-HQ-0088",
                       device_managed=True, posture="compliant", assigned_ip="10.200.31.18",
                       bytes_in=rng.randint(200, 500) * 10**6, bytes_out=rng.randint(20, 60) * 10**6))
        ep.append(row(EP_COLS, event_ts=ts(day, 8, 15), host_id="LT-HQ-0088", user_id=DECOY, event_type="logon", logon_type=11))
        ep.append(row(EP_COLS, event_ts=ts(day, 10, 30), host_id="SRV-MGMT-01", user_id=DECOY, event_type="logon", logon_type=10,
                      src_ip="10.200.31.18", src_host="LT-HQ-0088"))
    # ── 8. benign multi-signal leads (what tier 2 closes fast) ─────────────────────────────
    by = {u["user_id"]: u for u in users}
    cv = by["cvasquez"]
    for hh, mm in [(22, 31), (23, 48)]:  # quarter-end audit sampling, late from home
        A(event_ts=ts(D(2), hh, mm, 9), user_id="cvasquez", src_ip=cv["home_ip"], asn=HOME_ISP[0], asn_org=HOME_ISP[1],
          geo_country="US", geo_city="Eastgate", application="Tax Case Management System", result="success", failure_reason=None,
          mfa_result="approved", device_id=cv["laptop_id"], device_managed=True, user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/128.0")
    for b in range(5):
        ep.append(row(EP_COLS, event_ts=ts(D(2), 22, 35 + b * 4), host_id="FS-TAX-01", user_id="cvasquez", event_type="file_read",
                      src_host=cv["laptop_id"], file_path="\\\\FS-TAX-01\\AuditCases\\2026\\Q3-Sampling\\", file_count=290, bytes=290 * 410_000))
    tn = by["tnakamura"]
    helped = [u["laptop_id"] for u in users if u["department"] == "Taxpayer Services"][:4]
    for i, h in enumerate(helped):  # new service-desk hire doing remote support + learning the domain
        ep.append(row(EP_COLS, event_ts=ts(D(4), 10 + i, 12), host_id=h, user_id="tnakamura", event_type="logon", logon_type=10,
                      src_host=tn["laptop_id"]))
    for m, proc, cmd in [(5, "whoami.exe", "whoami /groups"), (7, "net.exe", "net user tnakamura /domain"),
                         (9, "net.exe", 'net group "Service Desk" /domain')]:
        ep.append(row(EP_COLS, event_ts=ts(D(4), 9, m), host_id=tn["laptop_id"], user_id="tnakamura", event_type="process_start",
                      process_name=proc, command_line=cmd, parent_process="cmd.exe"))
    pw = by["pwhitaker"]
    for mm, res in [(2, "timeout"), (6, "denied")]:  # new phone, old authenticator still enrolled
        A(event_ts=ts(D(5), 9, mm, 30), user_id="pwhitaker", src_ip=pw["home_ip"], asn=HOME_ISP[0], asn_org=HOME_ISP[1],
          geo_country="US", geo_city="Harbor Point", application="CDOR SSO portal", result="failure", failure_reason=f"mfa_{res}",
          mfa_result=res, device_id=pw["laptop_id"], device_managed=True, user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/128.0")
    A(event_ts=ts(D(5), 9, 41, 3), user_id="pwhitaker", src_ip=pw["home_ip"], asn=HOME_ISP[0], asn_org=HOME_ISP[1], geo_country="US",
      geo_city="Harbor Point", application="Authenticator device registration", result="success", failure_reason=None,
      mfa_result="approved", device_id="new authenticator: iPhone 15 (help desk ticket HD-58213)", device_managed=True,
      user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/128.0")
    return auth, vpn, ep, dns


# ─────────────────────────────────────────────────────────────────────────────
def write(spark, fqs, name, df, comment, pk=None):
    fq = f"{fqs}.{name}"
    df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(fq)
    spark.sql(f"COMMENT ON TABLE {fq} IS '{comment.replace(chr(39), chr(39) * 2)}'")
    if pk:
        spark.sql(f"ALTER TABLE {fq} ALTER COLUMN {pk} SET NOT NULL")
        spark.sql(f"ALTER TABLE {fq} ADD CONSTRAINT {name}_pk PRIMARY KEY ({pk}) RELY")
    print(f"  wrote {fq}: {spark.table(fq).count():,} rows")


def infer_df(spark, rows, cols):
    return spark.createDataFrame([tuple(r.get(c) for c, _ in cols) for r in rows], schema(cols))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", default="cybersecurity")
    ap.add_argument("--schema", default="threat_hunting_copilot")
    args, _ = ap.parse_known_args()
    fqs = f"{args.catalog}.{args.schema}"
    spark = get_spark()
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {fqs} COMMENT 'Cascadia DOR SOC — threat hunting copilot demo (synthetic telemetry, no real IOCs)'")
    spark.sql(f"CREATE VOLUME IF NOT EXISTS {fqs}.ir_playbook COMMENT 'CSOC incident response playbook - documents searched by the Genie agent'")
    print(f"AS_OF={AS_OF}")

    users = build_identities()
    assets = build_assets(users)
    write(spark, fqs, "identities", infer_df(spark, users, [
        ("user_id", STR), ("display_name", STR), ("email", STR), ("department", STR), ("title", STR), ("office", STR),
        ("office_city", STR), ("is_privileged", BOOL), ("is_service_account", BOOL), ("account_status", STR),
        ("hire_date", DATE), ("remote_work_share", DBL), ("home_ip", STR), ("laptop_id", STR)]),
        "CDOR workforce identities (synthetic). home_ip = the user's usual home ISP address (RFC 6598); laptop_id = managed laptop.",
        pk="user_id")
    write(spark, fqs, "assets", infer_df(spark, assets, [
        ("host_id", STR), ("asset_type", STR), ("os", STR), ("criticality", STR), ("owner_user_id", STR), ("location", STR),
        ("ip_address", STR), ("description", STR), ("edr_installed", BOOL)]),
        "CDOR hosts: managed laptops, finance workstations (WS-FIN-*) and servers. criticality: standard / medium / high / critical.",
        pk="host_id")
    write(spark, fqs, "travel_approvals", infer_df(spark, build_travel(users), [
        ("travel_id", STR), ("user_id", STR), ("destination_city", STR), ("destination_country", STR), ("start_date", DATE),
        ("end_date", DATE), ("purpose", STR), ("approved_by", STR)]),
        "Approved staff business travel — used to validate impossible-travel and new-country sign-ins.", pk="travel_id")
    write(spark, fqs, "attack_techniques", infer_df(spark, [dict(zip(
        ["technique_id", "technique_name", "tactic", "detection_coverage", "detection_rule", "playbook_section"], t)) for t in TECHNIQUES], [
        ("technique_id", STR), ("technique_name", STR), ("tactic", STR), ("detection_coverage", STR), ("detection_rule", STR),
        ("playbook_section", STR)]),
        "MITRE ATT&CK techniques referenced by the CSOC IR playbook, with CDOR detection coverage (full / partial / none) and the detecting SIEM rule.",
        pk="technique_id")
    write(spark, fqs, "it_tickets", infer_df(spark, build_tickets(users), [
        ("ticket_id", STR), ("user_id", STR), ("opened_ts", NTZ), ("category", STR), ("summary", STR), ("status", STR), ("resolved_by", STR)]),
        "IT service-desk tickets (MFA changes, access requests, FYIs) — the analyst's pivot to explain benign anomalies.", pk="ticket_id")
    alert_cols = [("alert_id", STR), ("created_ts", NTZ), ("rule_id", STR), ("rule_name", STR), ("source", STR), ("severity", STR),
                  ("entity_user", STR), ("entity_host", STR), ("src_ip", STR), ("technique_id", STR), ("disposition", STR),
                  ("acknowledged_ts", NTZ), ("closed_ts", NTZ), ("analyst", STR), ("analyst_note", STR)]
    write(spark, fqs, "siem_alerts", infer_df(spark, build_alerts(users, assets), alert_cols),
          "SIEM / EDR / identity / UEBA alerts, last 90 days. disposition: true_positive | benign_true_positive | false_positive | open. "
          "Time to acknowledge = acknowledged_ts - created_ts.", pk="alert_id")
    write(spark, fqs, "incidents", infer_df(spark, build_incidents(), [
        ("incident_id", STR), ("category", STR), ("severity", STR), ("title", STR), ("first_malicious_ts", NTZ),
        ("detected_ts", NTZ), ("contained_ts", NTZ), ("closed_ts", NTZ), ("detection_source", STR), ("records_affected", INT),
        ("reported_to_fusion_center", BOOL)]),
        "Closed security incidents, last 18 months. MTTD = detected_ts - first_malicious_ts; MTTR (time to contain) = contained_ts - detected_ts.",
        pk="incident_id")

    auth_bg, vpn_bg, ep_bg, dns_bg = background(spark, fqs)
    a_auth, a_vpn, a_ep, a_dns = attack_rows(users)
    auth = auth_bg.unionByName(spark.createDataFrame(a_auth, schema(AUTH_COLS)))
    auth = auth.withColumn("event_id", F.concat(F.lit("AU-"), F.substring(F.md5(F.concat_ws("|", *[F.col(c).cast("string") for c, _ in AUTH_COLS])), 1, 14)))
    write(spark, fqs, "auth_logs", auth.select("event_id", *[c for c, _ in AUTH_COLS]),
          "Identity-provider sign-in log, last 90 days (agency local time). result success/failure; failure_reason invalid_password / mfa_denied / "
          "mfa_timeout / mfa_required; mfa_result approved / denied / timeout / not_required. src_ip geo + ASN enriched.")
    vpn = vpn_bg.unionByName(spark.createDataFrame(a_vpn, schema(VPN_COLS)))
    vpn = vpn.withColumn("session_id", F.concat(F.lit("VPN-"), F.substring(F.md5(F.concat_ws("|", "user_id", F.col("session_start").cast("string"))), 1, 12)))
    write(spark, fqs, "vpn_sessions", vpn.select("session_id", *[c for c, _ in VPN_COLS]),
          "Remote-access VPN sessions. device_managed=false / posture non_compliant = a device without the CDOR EDR agent.")
    ep = ep_bg.unionByName(spark.createDataFrame(a_ep, schema(EP_COLS)))
    ep = ep.withColumn("event_id", F.concat(F.lit("EP-"), F.substring(F.md5(F.concat_ws("|", *[F.col(c).cast("string") for c, _ in EP_COLS])), 1, 14)))
    write(spark, fqs, "endpoint_events", ep.select("event_id", *[c for c, _ in EP_COLS]),
          "EDR telemetry. event_type logon (logon_type 2 interactive, 10 = RDP remote interactive, 11 cached) | process_start (command_line) | "
          "file_read / file_write (file_count files in one batch, on host_id, from src_host).")
    dns = dns_bg.unionByName(spark.createDataFrame(a_dns, schema(DNS_COLS)))
    write(spark, fqs, "dns_logs", dns,
          "Internal DNS resolver log per host. label_entropy = Shannon entropy (bits/char) of the left-most label; > 3.5 on long labels suggests encoded data (tunneling).")
    print("done.")


if __name__ == "__main__":
    main()
