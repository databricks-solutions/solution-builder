#!/usr/bin/env python3
"""
Usage tracking for the databricks-solution-builder skill.

Usage: python track.py <EVENT> [<demo_name>]

Posts a usage event to the dbdemos analytics endpoint, mirroring what the
app middleware sends so skill-only and app-driven sessions aggregate together.

Databricks employees (@databricks.com) send raw email + sha256 hash;
non-Databricks users send only the anonymous fields.

Opt out by setting DBDEMOS_TRACKER_DISABLED=1.
Set DBDEMOS_TRACKER_DEBUG=1 to print the request URL to stderr.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request

ENDPOINT = "https://ppxrzfxige.execute-api.us-west-2.amazonaws.com/v1/analytics"
CATEGORY = "industry-solution-builder-skill"
DISABLED_WORKSPACE = "1660015457675682"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36"
)


def resolve_context():
    try:
        out = subprocess.run(
            ["databricks", "auth", "describe", "-o", "json"],
            capture_output=True, text=True, timeout=3,
        )
        d = json.loads(out.stdout)
        email = d.get("username", "") or ""
        host = d.get("details", {}).get("host", "")
        m = re.search(r"adb-(\d+)\.", host)
        org_id = m.group(1) if m else "unknown"
        return email, org_id
    except Exception:
        return "", "unknown"


def main():
    if os.environ.get("DBDEMOS_TRACKER_DISABLED") == "1":
        return

    if len(sys.argv) < 2:
        return
    event = sys.argv[1]
    demo_name = sys.argv[2] if len(sys.argv) > 2 else "unspecified"

    email, org_id = resolve_context()
    if org_id == DISABLED_WORKSPACE:
        return

    params = {
        "category": CATEGORY,
        "org_id": org_id,
        "demo_name": demo_name,
        "event": event,
        "version": "1",
        "path": f"/_dbdemos/{CATEGORY}/{demo_name}",
        "app_path": f"/skill/{event.lower()}",
    }
    if email.endswith("@databricks.com"):
        params["email"] = email
        params["user_hash"] = hashlib.sha256(email.encode()).hexdigest()

    url = ENDPOINT + "?" + urllib.parse.urlencode(params)
    debug = os.environ.get("DBDEMOS_TRACKER_DEBUG") == "1"
    if debug:
        print(url, file=sys.stderr)

    req = urllib.request.Request(url, method="GET", headers={"user-agent": USER_AGENT})
    try:
        resp = urllib.request.urlopen(req, timeout=1)
        body = resp.read()
        if debug:
            print(f"HTTP {resp.status} {resp.reason} ({len(body)}B)", file=sys.stderr)
    except Exception as e:
        if debug:
            print(f"error: {type(e).__name__}: {e}", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
