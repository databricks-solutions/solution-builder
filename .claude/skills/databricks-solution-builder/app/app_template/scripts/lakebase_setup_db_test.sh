#!/usr/bin/env bash
# Unit tests for lakebase_setup_db.sh's proactive shared-project selection.
#
# Sources the script (which must be main-guarded so sourcing defines the
# functions without running the CLI) and stubs `databricks` as a shell
# function, then drives pick_shared_project through the pool-distribution
# logic. No live Databricks/CLI needed.
#
# Run: bash lakebase_setup_db_test.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/lakebase_setup_db.sh"

pass=0; fail=0
check() {  # desc  expected  actual
  if [[ "$2" == "$3" ]]; then echo "  [PASS] $1"; pass=$((pass+1))
  else echo "  [FAIL] $1 — expected '$2' got '$3'"; fail=$((fail+1)); fi
}

# ── Stub the databricks CLI ──────────────────────────────────────────────────
# Driven by two globals the tests set:
#   TEST_MISSING  — space-separated project slugs that do NOT exist (get-project → 1)
#   TEST_COUNTS   — "slug=N;slug=N" database counts for list-databases
databricks() {
  local args="$*" proj
  proj="$(sed -E 's#.*projects/([^/ ]+).*#\1#' <<<"$args")"
  case "$args" in
    *"get-project"*)
      case " ${TEST_MISSING:-} " in *" $proj "*) return 1 ;; *) return 0 ;; esac ;;
    *"list-databases"*)
      # Simulate a nonzero CLI exit (transient error / not-yet-listable branch)
      # for any project named in TEST_FAIL_LIST — exercises finding #1's path.
      case " ${TEST_FAIL_LIST:-} " in *" $proj "*) return 4 ;; esac
      local n=0 kv
      for kv in ${TEST_COUNTS//;/ }; do
        [[ "${kv%%=*}" == "$proj" ]] && n="${kv##*=}"
      done
      python3 -c "print('['+','.join('{}' for _ in range($n))+']')" ;;
    *) return 0 ;;
  esac
}

# Globals the sourced functions read under `set -u`.
BRANCH_ID="production"
PROFILE_FLAG=()
SHARED_PROJECT_MAX_DBS=50

# shellcheck disable=SC1090
source "$SCRIPT"
set +e +u +o pipefail  # relax for assertions (source re-enabled strict mode)

echo "lakebase_setup_db.sh — proactive shared-project selection"

check "script is sourceable (main-guard present)" "function" "$(type -t pick_shared_project)"

TEST_MISSING=""; TEST_COUNTS="dbdemos-asset-generator=10"
check "base under cap -> base" "dbdemos-asset-generator" "$(pick_shared_project)"

TEST_MISSING=""; TEST_COUNTS="dbdemos-asset-generator=60;dbdemos-asset-generator-2=5"
check "base full -> -2" "dbdemos-asset-generator-2" "$(pick_shared_project)"

TEST_MISSING="dbdemos-asset-generator-3"; TEST_COUNTS="dbdemos-asset-generator=60;dbdemos-asset-generator-2=99"
check "base+-2 full, -3 fresh -> -3" "dbdemos-asset-generator-3" "$(pick_shared_project)"

TEST_MISSING=""; TEST_COUNTS="dbdemos-asset-generator=99;dbdemos-asset-generator-2=99;dbdemos-asset-generator-3=99;dbdemos-asset-generator-4=99;dbdemos-asset-generator-5=99;dbdemos-asset-generator-6=99;dbdemos-asset-generator-7=99;dbdemos-asset-generator-8=99;dbdemos-asset-generator-9=99"
out="$(pick_shared_project)"; rc=$?
check "whole pool full -> empty output" "" "$out"
check "whole pool full -> nonzero return" "1" "$rc"

TEST_MISSING=""; TEST_COUNTS="dbdemos-asset-generator=10"; SHARED_PROJECT_MAX_DBS=5
check "cap override: base(10) over max(5) -> -2" "dbdemos-asset-generator-2" "$(pick_shared_project)"
SHARED_PROJECT_MAX_DBS=50

# Regression for finding #1: a transient list-databases failure must read as an
# EMPTY (0-db) project and be CHOSEN, not crash the `-lt` compare and get skipped.
TEST_MISSING=""; TEST_COUNTS=""; TEST_FAIL_LIST="dbdemos-asset-generator"
check "transient list-databases failure -> base reads 0 -> PICKED (#1)" "dbdemos-asset-generator" "$(pick_shared_project)"
TEST_FAIL_LIST=""

# Strict-mode guard for finding #1: under the REAL `set -euo pipefail`,
# count_databases must emit exactly ONE integer (0) when the CLI errors — the
# earlier `|| echo 0` + pipefail bug produced a two-line "0\n0" that then broke
# the arithmetic compare. (The other tests run under `set +e +u +o pipefail`,
# which is precisely why they couldn't see this — finding #3.)
strict_out="$(
  set -euo pipefail
  TEST_MISSING=""; TEST_COUNTS=""; TEST_FAIL_LIST="failproj"
  PROFILE_FLAG=(--profile dummy); BRANCH_ID=production
  count_databases failproj
)"
check "count_databases emits single '0' on CLI failure under pipefail (#1)" "0" "$strict_out"

echo "---- $pass passed, $fail failed ----"
[[ $fail -eq 0 ]]
