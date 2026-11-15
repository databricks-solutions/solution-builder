#!/usr/bin/env python
"""
Emberline Studios — Hollowspire Live-Ops Console: self-contained synthetic data + gold build.

STORY — "Season 7 didn't lose players for one reason. It lost them for three."
Hollowspire is a (fictional) free-to-play co-op action RPG with a ranked PvP ladder, on PC,
PlayStation and Xbox. Season 7 "The Drowned Crown" launched on 2026-08-18. New-player D7
retention fell from ~21% to ~13% and 14-day churn of active players jumped. Live ops'
reflex is the blanket 50% gem sale. The data plants three independent causes:

  1. DIFFICULTY — Season 7 chapter stage 7-4 ("The Drowned Warden" boss) clears on ~14% of
     attempts (other stages ~60%+). Veterans who fail it 4+ times and never clear it are
     "stuck" and churn at ~3.5x.
  2. MATCHMAKING — Season 7 split the ranked queue in two (Ranked + the new Crown Trials).
     In the low-population APAC and OCE regions the median ranked queue wait went from
     ~75-95 s to ~5-8 minutes. Competitive players there — the highest spenders — leave.
  3. TOXICITY — the new cross-play Raid Finder matches brand-new players with veterans.
     New players who receive harassment in chat in their first two weeks churn at ~3x.
     The keyword filter flags harassment AND harmless trash talk alike; AI Functions
     (src/ai/chat_toxicity.sql) tell them apart — only real harassment predicts churn.

And the head-of-live-ops "aha": in liveops_history (Seasons 3-6, measured against holdout
control groups) driver-matched interventions (difficulty hotfix, queue merge, safe lobbies)
retained 3-6x more at-risk players than the blanket gem sale, at a fraction of the cost.

Tables written to <catalog>.<schema>:
  players                  player dim (+ status / last_active_date as of 2026-09-27)
  player_daily             one row per player x day played: sessions, minutes, PvE runs,
                           ranked queues + average queue wait, queue abandons, spend
  stage_attempts           Season 6 / Season 7 chapter stage attempts + clears per player x day
  purchases                in-game purchases (season pass, gem packs, bundles)
  chat_messages            moderation queue: chat lines flagged by the keyword filter or a
                           player report, Aug 1 - Sep 27 (read by AI Functions -> chat_insights)
  intervention_catalog     live-ops interventions + cost model (fixed + per-player) + lead time
  liveops_history          past interventions (Seasons 3-6) with holdout-measured retention lift
  liveops_budget           remaining live-ops budget for the planning month
  liveops_schedule         (empty) write-back target for the app's scheduled interventions
  gold_daily_kpis          DAU, installs, revenue, payers, ARPDAU by day x region
  gold_retention_cohorts   install cohorts (day x region x channel) with D1 / D7 / D30 retained
  gold_stage_funnel        Season 6 + 7 stage funnel: attempt clear rate, stuck players
  gold_matchmaking_daily   ranked queue volume, average wait and abandon rate by day x region
  gold_churn_weekly        weekly active players and how many churned (14 days inactive) by cohort

Downstream (separate tasks): src/ai/chat_toxicity.sql (AI Functions on a warehouse) and
src/ml/train_models.py (XGBoost churn + LTV models, SHAP drivers, UC-registered, scored).

Runs two ways (same plain .py — NOT a notebook):
  • DAB spark_python_task — ambient SparkSession; `--catalog <c> --schema <s>`.
  • Locally — Databricks Connect serverless (Python 3.12 venv):
      DATABRICKS_CONFIG_PROFILE=<your-profile> python generate_data.py --catalog gaming --schema player_retention_copilot
"""
import argparse
import datetime as dt
import os

import numpy as np
import pandas as pd

_p = argparse.ArgumentParser(add_help=False)
_p.add_argument("--catalog")
_p.add_argument("--schema")
_cli, _ = _p.parse_known_args()

CATALOG = _cli.catalog or os.environ.get("CATALOG", "gaming")
SCHEMA = _cli.schema or os.environ.get("SCHEMA", "player_retention_copilot")
FQ = f"`{CATALOG}`.`{SCHEMA}`"
DRY = bool(os.environ.get("DRY_RUN"))

if not DRY:
    from pyspark.sql import SparkSession  # noqa: E402

    spark = SparkSession.getActiveSession()
    if spark is None:
        from databricks.connect import DatabricksSession
        _profile = os.environ.get("DATABRICKS_CONFIG_PROFILE", "DEFAULT")
        spark = DatabricksSession.builder.profile(_profile).serverless(True).getOrCreate()
    print(f"== target: {CATALOG}.{SCHEMA} ==")
    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {FQ}")

rng = np.random.default_rng(20260927)

# ---------------------------------------------------------------------------
# Calendar: 150 days, 2026-05-01 .. 2026-09-27 (as-of Sunday 2026-09-27)
# ---------------------------------------------------------------------------
START = dt.date(2026, 5, 1)
AS_OF = dt.date(2026, 9, 27)
ND = (AS_OF - START).days + 1
DAYS = [START + dt.timedelta(days=i) for i in range(ND)]
S6 = (dt.date(2026, 6, 9) - START).days     # Season 6 "Emberfall" launch
S7 = (dt.date(2026, 8, 18) - START).days    # Season 7 "The Drowned Crown" launch
CHAT_FROM = (dt.date(2026, 8, 1) - START).days

REGIONS = ["NA", "EU", "LATAM", "APAC", "OCE"]
REGION_P = [0.37, 0.30, 0.12, 0.14, 0.07]
COUNTRIES = {
    "NA": ["US", "US", "US", "CA", "MX"], "EU": ["DE", "FR", "GB", "PL", "ES", "SE"],
    "LATAM": ["BR", "BR", "AR", "CL", "CO"], "APAC": ["JP", "KR", "SG", "PH", "TW", "TH"],
    "OCE": ["AU", "AU", "AU", "NZ"],
}
PLATFORMS, PLATFORM_P = ["PC", "PlayStation", "Xbox"], [0.50, 0.31, 0.19]
TYPES, TYPE_P = ["Casual", "Progression", "Competitive"], [0.40, 0.35, 0.25]
CHANNELS, CHANNEL_P = ["Organic", "Paid social", "Creator / streamer", "Steam featured", "Console store"], [0.34, 0.22, 0.18, 0.14, 0.12]
TIERS = ["Non-payer", "Minnow", "Dolphin", "Whale"]

# ---------------------------------------------------------------------------
# Players: an existing base + daily installs (bumps at both season launches)
# ---------------------------------------------------------------------------
N_BASE = 21000
inst_per_day = np.full(ND, 88.0)
for launch, bump, half in [(S6, 260, 5.0), (S7, 560, 6.0)]:
    for d in range(launch, ND):
        inst_per_day[d] += bump * 0.5 ** ((d - launch) / half)
inst_per_day *= rng.normal(1.0, 0.07, ND).clip(0.8, 1.2)
new_counts = rng.poisson(inst_per_day)
N_NEW = int(new_counts.sum())
N = N_BASE + N_NEW

# install day index (negative = before the window)
inst = np.concatenate([
    -rng.integers(25, 520, N_BASE),
    np.repeat(np.arange(ND), new_counts),
])
region = rng.choice(REGIONS, N, p=REGION_P)
platform = rng.choice(PLATFORMS, N, p=PLATFORM_P)
ptype = rng.choice(TYPES, N, p=TYPE_P)
channel = rng.choice(CHANNELS, N, p=CHANNEL_P)
country = np.array([rng.choice(COUNTRIES[r]) for r in region])

# spender tier — competitive players and APAC skew to high spend
w_p = np.where(ptype == "Competitive", 0.05, np.where(ptype == "Progression", 0.022, 0.008))
w_p = w_p * np.where(region == "APAC", 1.7, np.where(region == "OCE", 1.4, 1.0))
d_p = np.where(ptype == "Competitive", 0.13, np.where(ptype == "Progression", 0.09, 0.04))
m_p = np.where(ptype == "Casual", 0.14, 0.2)
u = rng.random(N)
tier = np.where(u < w_p, 3, np.where(u < w_p + d_p, 2, np.where(u < w_p + d_p + m_p, 1, 0)))
# brand-new players start as non-payers most of the time; they convert in-game
tier = np.where((inst >= 0) & (rng.random(N) < 0.75), 0, tier)
tier0 = tier.copy()

base_play = np.where(ptype == "Casual", 0.36, np.where(ptype == "Progression", 0.58, 0.66))
base_play = base_play * rng.uniform(0.8, 1.2, N)
base_haz = np.where(ptype == "Casual", 0.0066, np.where(ptype == "Progression", 0.0033, 0.0029))
base_haz = base_haz * rng.uniform(0.7, 1.3, N)
pve_share = np.where(ptype == "Competitive", 0.3, np.where(ptype == "Progression", 0.95, 0.6))
ranked = (ptype == "Competitive") | ((ptype == "Progression") & (rng.random(N) < 0.12))

# veterans alive at the window start: base players churned before START are dropped
alive = np.ones(N, dtype=bool)
installed = inst < 0
churn_day = np.full(N, -1)
last_active = np.full(N, -999)

# queue medians by region (seconds) pre / post the Season 7 queue split
Q_PRE = {"NA": 38, "EU": 44, "LATAM": 68, "APAC": 74, "OCE": 92}
Q_POST = {"NA": 52, "EU": 58, "LATAM": 118, "APAC": 318, "OCE": 452}
q_pre = np.array([Q_PRE[r] for r in region], dtype=float)
q_post = np.array([Q_POST[r] for r in region], dtype=float)

# progression state per player for the current season chapter (stage index 0..6; 6 = done)
stage_idx = np.zeros(N, dtype=int)
fails_on_stage = np.zeros(N, dtype=int)
stuck = np.zeros(N, dtype=bool)
season_eligible = np.zeros(N, dtype=bool)
CLEAR_S6 = [0.72, 0.66, 0.46, 0.64, 0.61, 0.58]           # 6-3 a little hard
CLEAR_S7 = [0.70, 0.64, 0.61, 0.14, 0.62, 0.57]           # 7-4 The Drowned Warden
STAGE_NAMES = {
    "6-1": "Cinder Gate", "6-2": "Ashen Market", "6-3": "The Forge Tyrant", "6-4": "Ember Vaults",
    "6-5": "Kiln Spire", "6-6": "Emberfall Heart",
    "7-1": "Tidebreak Shore", "7-2": "Sunken Choir", "7-3": "Brinewood", "7-4": "The Drowned Warden",
    "7-5": "Pearl Catacombs", "7-6": "Throne of the Drowned Crown",
}

tox_until = np.full(N, -1)          # harassment effect lasts 7 days
wait7 = np.zeros(N)                 # rolling (EMA) ranked wait

rec_daily = []      # (pid, day, sessions, minutes, pve_runs, ranked_queues, avg_wait, abandons, spend)
rec_stage = []      # (pid, day, stage_code, attempts, clears)
rec_purch = []      # (pid, day, sku, amount)
rec_chat = []       # (recipient, day, kind)  kind: harm / banter / friendly
SKU = {
    0: [("Starter Pack", 4.99)],
    1: [("Gem Pouch (500)", 4.99), ("Battle Pass Tier Skip", 9.99), ("Cosmetic Bundle", 9.99)],
    2: [("Gem Chest (1,200)", 9.99), ("Cosmetic Bundle", 14.99), ("Legendary Skin", 19.99)],
    3: [("Gem Vault (6,500)", 49.99), ("Legendary Skin", 19.99), ("Mythic Weapon Crate", 99.99), ("Gem Chest (1,200)", 9.99)],
}
PURCH_P = np.array([0.0016, 0.034, 0.085, 0.21])

for d in range(ND):
    # installs today join the population
    today_new = inst == d
    installed |= today_new
    live = installed & alive
    tenure = d - inst

    # season chapter eligibility: S6 / S7 reset progression for veterans (tenure >= 21)
    if d in (S6, S7):
        season_eligible = installed & alive & (tenure >= 21)
        stage_idx[:] = 0
        fails_on_stage[:] = 0
        stuck[:] = False
    # new players graduate into the chapter after 3 weeks
    season_eligible |= live & (tenure == 21) & (d >= S6)

    post = d >= S7
    # ---- hazard ----------------------------------------------------------
    h = base_haz.copy()
    newbie = tenure < 30
    h = np.where(newbie, 0.019 + 0.27 * np.exp(-np.clip(tenure, 0, None) / 2.6), h)
    h = np.where(stuck, h * 4.5, h)
    wait_mult = 1 + 2.0 * np.clip((wait7 - 150) / 300, 0, 1.6)
    h = np.where(ranked, h * wait_mult, h)
    tox_active = tox_until >= d
    h = np.where(tox_active, h * np.where(tenure < 30, 3.4, 1.6), h)
    # season launches briefly reactivate interest (lower hazard for a week)
    for launch in (S6, S7):
        if launch <= d < launch + 7:
            h = h * 0.75
    churn_now = live & (rng.random(N) < h) & ~today_new
    alive &= ~churn_now
    churn_day = np.where(churn_now, d, churn_day)
    live = installed & alive

    # ---- play today? -----------------------------------------------------
    pp = base_play * np.where(newbie, 1.0 + 0.3 * np.exp(-np.clip(tenure, 0, None) / 4), 1.0)
    pp = np.where(stuck, pp * 0.65, pp)
    pp = np.where(tox_active & newbie, pp * 0.7, pp)
    if d % 7 in (1, 2):   # weekends (May 1 2026 is a Friday -> day 1 Sat, day 2 Sun)
        pp = pp * 1.18
    for launch in (S6, S7):
        if launch <= d < launch + 5:
            pp = pp * 1.35
    play = live & (rng.random(N) < np.clip(pp, 0, 0.97))
    play |= today_new           # install day counts as played
    idx = np.nonzero(play)[0]
    if len(idx) == 0:
        continue
    last_active[idx] = d
    n = len(idx)
    sessions = 1 + rng.poisson(np.where(ptype[idx] == "Casual", 0.4, 1.0))
    minutes = np.round(sessions * rng.gamma(3.0, np.where(ptype[idx] == "Casual", 9.0, 15.0))).astype(int) + 4
    minutes = np.where(stuck[idx], (minutes * 0.7).astype(int) + 3, minutes)

    # ---- PvE chapter content ---------------------------------------------
    do_pve = rng.random(n) < pve_share[idx]
    runs = np.where(do_pve, 1 + rng.poisson(1.6, n), 0)
    in_chapter = do_pve & season_eligible[idx] & (d >= S6) & (stage_idx[idx] < 6)
    clear_tab = CLEAR_S7 if post else CLEAR_S6
    season_tag = "7" if post else "6"
    for j in np.nonzero(in_chapter)[0]:
        p_ = idx[j]
        att = int(runs[j])
        st = stage_idx[p_]
        stage_att = {}
        while att > 0 and st < 6:
            code = f"{season_tag}-{st + 1}"
            a, c = stage_att.get(code, (0, 0))
            if rng.random() < clear_tab[st]:
                stage_att[code] = (a + 1, c + 1)
                st += 1
                fails_on_stage[p_] = 0
            else:
                stage_att[code] = (a + 1, c)
                fails_on_stage[p_] += 1
            att -= 1
        stage_idx[p_] = st
        stuck[p_] = post and st == 3 and fails_on_stage[p_] >= 4
        for code, (a, c) in stage_att.items():
            rec_stage.append((p_, d, code, a, c))

    # ---- ranked matchmaking ----------------------------------------------
    rq = np.where(ranked[idx], rng.poisson(np.where(ptype[idx] == "Competitive", 4.2, 1.5)), 0)
    med = np.where(post, q_post[idx], q_pre[idx])
    avg_wait = np.round(med * rng.lognormal(0, 0.28, n)).astype(int)
    abandon_p = np.clip((avg_wait - 180) / 600, 0.02, 0.6)
    abandons = rng.binomial(rq, abandon_p)
    queued = rq > 0
    qi = idx[queued]
    wait7[qi] = np.where(wait7[qi] == 0, avg_wait[queued], 0.7 * wait7[qi] + 0.3 * avg_wait[queued])

    # ---- spend ------------------------------------------------------------
    pt = tier[idx]
    buy = rng.random(n) < PURCH_P[pt] * np.where(stuck[idx], 0.6, 1.0)
    spend = np.zeros(n)
    for j in np.nonzero(buy)[0]:
        sku, price = SKU[int(pt[j])][rng.integers(len(SKU[int(pt[j])]))]
        rec_purch.append((idx[j], d, sku, price))
        spend[j] += price
        if pt[j] == 0:
            tier[idx[j]] = 1          # first purchase converts a non-payer
    # season pass in the first 4 days of a season for payers
    for launch in (S6, S7):
        if launch <= d < launch + 4:
            sp = (pt >= 1) & (rng.random(n) < 0.22)
            for j in np.nonzero(sp)[0]:
                rec_purch.append((idx[j], d, "Season Pass", 9.99))
                spend[j] += 9.99

    # ---- chat moderation queue (Aug 1+) -------------------------------------
    if d >= CHAT_FROM:
        raid = do_pve & (rng.random(n) < (0.65 if post else 0.35))   # Raid Finder cross-play from S7
        t_idx = tenure[idx]
        p_harm = np.where(t_idx < 14, 0.22 if post else 0.025, 0.007 if post else 0.004)
        harm = raid & (rng.random(n) < p_harm)
        for j in np.nonzero(harm)[0]:
            rec_chat.append((idx[j], d, "harm"))
            if t_idx[j] < 30 or rng.random() < 0.5:
                tox_until[idx[j]] = d + 7
        banter = queued & (rng.random(n) < 0.018)
        for j in np.nonzero(banter)[0]:
            rec_chat.append((idx[j], d, "banter"))
        friendly = do_pve & (rng.random(n) < 0.004)
        for j in np.nonzero(friendly)[0]:
            rec_chat.append((idx[j], d, "friendly"))

    for j in range(n):
        rec_daily.append((idx[j], d, int(sessions[j]), int(minutes[j]), int(runs[j]), int(rq[j]),
                          int(avg_wait[j]) if rq[j] > 0 else None, int(abandons[j]), round(float(spend[j]), 2)))

# ---------------------------------------------------------------------------
# Assemble tables
# ---------------------------------------------------------------------------
pid = np.array([f"HS-{100001 + i}" for i in range(N)])
seen = installed & ((last_active >= 0) | (inst >= 0))
keep = seen & (last_active >= 0)       # players who played at least once in the window
ADJ = ["Iron", "Silent", "Crimson", "Lucky", "Frost", "Neon", "Hollow", "Rogue", "Ember", "Void", "Tidal", "Wild",
       "Arcane", "Grim", "Swift", "Solar", "Drowned", "Feral", "Obsidian", "Pixel"]
NOUN = ["Fox", "Warden", "Raven", "Golem", "Lynx", "Specter", "Hydra", "Monk", "Ronin", "Wolf", "Kraken", "Sage",
        "Viper", "Titan", "Owl", "Harbinger", "Bard", "Nomad", "Wisp", "Djinn"]
tags = [f"{ADJ[rng.integers(20)]}{NOUN[rng.integers(20)]}{rng.integers(1, 999)}" for _ in range(N)]
day_of = lambda i: DAYS[i] if i >= 0 else START + dt.timedelta(days=int(i))  # noqa: E731

lifetime_prior = np.where(inst < 0, np.array([0, 38, 190, 1450])[tier0] * rng.uniform(0.4, 1.6, N) * np.clip(-inst / 200, 0.2, 2.5), 0)
daily = pd.DataFrame(rec_daily, columns=["p", "d", "sessions", "minutes_played", "pve_runs", "ranked_queues",
                                         "avg_queue_wait_sec", "queue_abandons", "spend_usd"])
spend_window = daily.groupby("p").spend_usd.sum()
lt_spend = lifetime_prior.copy()
lt_spend[spend_window.index.values] += spend_window.values

days_inactive = (ND - 1) - last_active
status = np.where(days_inactive >= 14, "Churned", np.where(days_inactive >= 7, "Lapsing", "Active"))
players = pd.DataFrame({
    "player_id": pid, "gamertag": tags, "region": region, "country": country, "platform": platform,
    "player_type": ptype, "spender_tier": np.array(TIERS)[tier], "acquisition_channel": channel,
    "install_date": [day_of(int(i)) for i in inst],
    "plays_ranked": ranked,
    "lifetime_spend_usd": np.round(lt_spend, 2),
    "last_active_date": [DAYS[int(i)] if i >= 0 else None for i in last_active],
    "days_since_active": np.where(last_active >= 0, days_inactive, None),
    "status": status,
    "season7_stage_reached": np.where(season_eligible, [f"7-{min(s + 1, 6)}" if s < 6 else "Completed" for s in stage_idx], None),
    "stuck_on_warden": stuck,
})[keep].reset_index(drop=True)

daily["player_id"] = pid[daily.p.values]
daily["activity_date"] = [DAYS[i] for i in daily.d.values]
daily = daily.drop(columns=["p", "d"])[["player_id", "activity_date", "sessions", "minutes_played", "pve_runs",
                                        "ranked_queues", "avg_queue_wait_sec", "queue_abandons", "spend_usd"]]

stage = pd.DataFrame(rec_stage, columns=["p", "d", "stage_id", "attempts", "clears"])
stage["player_id"] = pid[stage.p.values]
stage["attempt_date"] = [DAYS[i] for i in stage.d.values]
stage["season"] = np.where(stage.stage_id.str.startswith("7"), "S7 The Drowned Crown", "S6 Emberfall")
stage["stage_name"] = stage.stage_id.map(STAGE_NAMES)
stage = stage[["player_id", "attempt_date", "season", "stage_id", "stage_name", "attempts", "clears"]]

purch = pd.DataFrame(rec_purch, columns=["p", "d", "sku", "amount_usd"])
purch["purchase_id"] = [f"TX-{7000001 + i}" for i in range(len(purch))]
purch["player_id"] = pid[purch.p.values]
purch["purchase_date"] = [DAYS[i] for i in purch.d.values]
purch = purch[["purchase_id", "player_id", "purchase_date", "sku", "amount_usd"]]

# ---- chat moderation queue ---------------------------------------------------
HARM = [
    "uninstall the game, nobody wants a noob like you in raids",
    "you are actually the worst player i have ever seen, quit and never come back",
    "reported you for being useless. go play something for babies",
    "lol imagine being this bad. everyone in this raid hates you",
    "get out of my raid before i make every run miserable for you",
    "i know your tag now. i'll queue into you every night until you quit",
    "you're a waste of a slot, kick yourself and uninstall",
    "stop talking. no one asked for your garbage opinion, newbie",
    "keep dying and i will spam your inbox until you leave the game",
    "you people ruin every game. go back to whatever hole you crawled out of",
    "i'm going to report you on every alt until you get banned, trash",
    "we lost because of you. dont ever join raid finder again",
    "you're so bad it's embarrassing, delete your account",
    "shut up and die already, nobody cares",
    "i will find your stream and flood it. enjoy",
]
SCAM = [
    "free 10000 gems at hollowsp1re-rewards.co just log in with your account",
    "selling mythic crates cheap, dm me your login and i send them",
    "gm here: verify your account at emberline-support.net or get banned",
]
BANTER = [
    "gg ez, get rekt in the next one noob", "lol that was trash, run it back", "you got destroyed, gg wp",
    "trash team comp but we still won lmao", "noob mistake on B, gg though", "rekt. rematch?",
    "that play was dirty, respect", "ez clap, see you in trials", "bro you got absolutely cooked, gg",
    "trash talk aside that was a close one", "get good scrub haha gg",
]
FRIENDLY = [
    "this boss is killing me lol anyone want to team up", "that warden fight is brutal, good luck everyone",
    "thanks for the carry, you are insane", "dying so much on 7-4 lol send help",
    "nice run everyone, gg", "the drowned warden destroyed us again haha",
]
chat = pd.DataFrame(rec_chat, columns=["p", "d", "kind"])
chat["message_id"] = [f"CH-{900001 + i}" for i in range(len(chat))]
chat["recipient_player_id"] = pid[chat.p.values]
chat["sender_player_id"] = pid[rng.integers(0, N, len(chat))]
hr = rng.random(len(chat))
chat["message_text"] = [
    (rng.choice(SCAM) if r < 0.12 else rng.choice(HARM)) if k == "harm"
    else rng.choice(BANTER) if k == "banter" else rng.choice(FRIENDLY)
    for k, r in zip(chat.kind, hr)
]
chat["channel"] = np.where(chat.kind == "banter", "Ranked match chat",
                           np.where(chat.d >= S7, rng.choice(["Raid Finder text", "Raid Finder voice (transcribed)"], len(chat), p=[0.7, 0.3]), "Party chat"))
chat["sent_at"] = [dt.datetime.combine(DAYS[d], dt.time(int(h), int(m)))
                   for d, h, m in zip(chat.d, rng.integers(0, 24, len(chat)), rng.integers(0, 60, len(chat)))]
chat["flag_source"] = np.where(chat.kind == "harm", rng.choice(["Keyword filter", "Player report"], len(chat), p=[0.55, 0.45]), "Keyword filter")
chat = chat[chat.recipient_player_id.isin(set(players.player_id))]
chat = chat[["message_id", "sent_at", "channel", "flag_source", "sender_player_id", "recipient_player_id", "message_text"]].reset_index(drop=True)

# ---- intervention catalog + history + budget ---------------------------------
catalog = pd.DataFrame([
    ("DIFF-PATCH", "Drowned Warden difficulty hotfix", "difficulty", "game_change", "global",
     "Tune stage 7-4 server-side: Warden HP -18%, a mid-fight checkpoint, a clearer tidal-slam telegraph. Ships as a config hotfix to every region.", 3000, 0.0, 3),
    ("REVIVE-GIFT", "Warden's Bane revive pack (gift)", "difficulty", "offer", "targeted",
     "Gift 3 revive tokens + a Warden strategy guide to the segment's players stuck on 7-4.", 300, 0.25, 1),
    ("QUEUE-MERGE", "Ranked queue merge + cross-region backfill", "matchmaking", "game_change", "global",
     "Merge Ranked and Crown Trials queues in the low-population regions (APAC, OCE, LATAM) and backfill from the nearest region after 90 s. Server config change.", 2000, 0.0, 2),
    ("RANKED-XP", "Double ranked points weekend", "matchmaking", "event", "targeted",
     "Double ranked points for one weekend. Brings players back to the queue but does not shorten it.", 400, 0.10, 2),
    ("SAFE-LOBBY", "Safe Squads for new players + AI auto-mute", "toxicity", "safety", "global",
     "New players (< 14 days) are matched into Safe Squads with honor-rated veterans; chat that AI Functions flags as harassment, threat or scam is auto-muted. Player-safety spend: exempt from the ROI floor.", 1200, 0.0, 4),
    ("HONOR-PACK", "Apology + honor pack for harassed players", "toxicity", "offer", "targeted",
     "An in-game apology from the studio, a cosmetic honor pack and the outcome of their report, sent to the segment's harassed players.", 100, 0.50, 1),
    ("COMEBACK", "Comeback event: 2x XP + login-streak rewards", "engagement", "event", "targeted",
     "A 10-day comeback event with double XP and escalating login rewards for the segment's lapsing players.", 600, 0.60, 4),
    ("TGT-OFFER", "Personalized 40% bundle for lapsing payers", "engagement", "offer", "targeted",
     "A one-time 40%-off bundle picked from the player's own purchase history. Payers only.", 100, 1.20, 2),
    ("GEM-SALE-50", "Blanket 50% gem sale (all players)", "any", "offer", "global",
     "The default reflex: 50% off every gem pack for a week, for everyone. Cost = cannibalized full-price gem revenue (~a third of a week's revenue).", 9500, 0.0, 1),
], columns=["intervention_code", "intervention_name", "target_driver", "kind", "scope", "description",
            "fixed_cost_usd", "cost_per_player_usd", "lead_time_days"])

HIST = [
    # season, start, code, driver, players, treated retained d14, control retained d14, cost
    ("S3 Frostbound", "2025-10-20", "DIFF-PATCH", "difficulty", 2810, 0.71, 0.43, 2800),
    ("S4 Starfall", "2026-01-26", "DIFF-PATCH", "difficulty", 3390, 0.74, 0.45, 3100),
    ("S4 Starfall", "2026-01-29", "REVIVE-GIFT", "difficulty", 2150, 0.58, 0.44, 820),
    ("S5 Verdant Siege", "2026-04-08", "QUEUE-MERGE", "matchmaking", 1240, 0.76, 0.51, 1900),
    ("S5 Verdant Siege", "2026-04-11", "RANKED-XP", "matchmaking", 1610, 0.60, 0.52, 560),
    ("S6 Emberfall", "2026-06-24", "SAFE-LOBBY", "toxicity", 1980, 0.49, 0.30, 1150),
    ("S5 Verdant Siege", "2026-04-15", "HONOR-PACK", "toxicity", 1130, 0.39, 0.31, 660),
    ("S3 Frostbound", "2025-11-14", "COMEBACK", "engagement", 5900, 0.36, 0.27, 4100),
    ("S6 Emberfall", "2026-07-10", "COMEBACK", "engagement", 6300, 0.38, 0.28, 4400),
    ("S5 Verdant Siege", "2026-05-02", "TGT-OFFER", "engagement", 1720, 0.55, 0.42, 2150),
    ("S3 Frostbound", "2025-12-05", "GEM-SALE-50", "any", 24100, 0.52, 0.49, 8900),
    ("S5 Verdant Siege", "2026-04-24", "GEM-SALE-50", "any", 26800, 0.54, 0.50, 9400),
    ("S6 Emberfall", "2026-07-17", "GEM-SALE-50", "any", 27500, 0.51, 0.48, 9700),
]
hist = pd.DataFrame(HIST, columns=["season", "start_date", "intervention_code", "target_driver", "players_targeted",
                                   "treated_retained_d14", "control_retained_d14", "cost_usd"])
hist["start_date"] = pd.to_datetime(hist.start_date).dt.date
hist.insert(0, "run_id", [f"LO-{301 + i}" for i in range(len(hist))])
hist["lift_pp"] = np.round((hist.treated_retained_d14 - hist.control_retained_d14) * 100, 1)
hist["players_retained_incremental"] = np.round(hist.players_targeted * (hist.treated_retained_d14 - hist.control_retained_d14)).astype(int)
hist["cost_per_retained_player"] = np.round(hist.cost_usd / hist.players_retained_incremental, 2)
hist["strategy"] = np.where(hist.intervention_code == "GEM-SALE-50", "Blanket sale", "Driver-matched")

budget = pd.DataFrame([("2026-10", "October 2026 live-ops budget", 12000.0, "Head of Live Ops")],
                      columns=["budget_month", "description", "budget_usd", "owner"])

if DRY:
    pl = players
    print("players", len(pl), "daily", len(daily), "stage", len(stage), "purch", len(purch), "chat", len(chat))
    print(chat.message_text.isin(HARM + SCAM).sum(), "harm msgs")
    d = daily.merge(pl[["player_id", "install_date", "region"]], on="player_id")
    d["age"] = (pd.to_datetime(d.activity_date) - pd.to_datetime(d.install_date)).dt.days
    coh = pl[pd.to_datetime(pl.install_date) >= pd.Timestamp(START)].copy()
    coh["post"] = pd.to_datetime(coh.install_date) >= pd.Timestamp(DAYS[S7])
    for n_ in (1, 7, 30):
        act = set(d[d.age == n_].player_id)
        mature = pd.to_datetime(coh.install_date) <= pd.Timestamp(AS_OF - dt.timedelta(days=n_))
        c = coh[mature]
        print(f"D{n_}", c.groupby("post").player_id.apply(lambda s: round(100 * s.isin(act).mean(), 1)).to_dict())
    rev = daily.groupby("activity_date").agg(dau=("player_id", "size"), rev=("spend_usd", "sum"))
    rev["arpdau"] = rev.rev / rev.dau
    print(rev.iloc[[10, 40, 80, 100, 108, 115, 125, 140, 149]].round(3))
    s7 = stage[stage.season.str.startswith("S7")].groupby("stage_id")[["attempts", "clears"]].sum()
    print((s7.clears / s7.attempts).round(3).to_dict(), "stuck", int(pl.stuck_on_warden.sum()))
    print(pl.groupby(["region", "status"]).size().unstack())
    print(pl.spender_tier.value_counts())
    # 14-day churn of players active in two windows, by segment
    dd = daily.copy(); dd["activity_date"] = pd.to_datetime(dd.activity_date)
    for a, b in [("2026-07-20", "2026-08-02"), ("2026-08-31", "2026-09-13")]:
        w = dd[(dd.activity_date >= a) & (dd.activity_date <= b)].groupby("player_id").activity_date.max()
        after = dd[dd.activity_date > b].groupby("player_id").activity_date.min()
        j = pl.set_index("player_id").loc[w.index].copy(); j["last"] = w
        j["nxt"] = after.reindex(w.index)
        j["churn"] = (j.nxt.isna()) | ((j.nxt - j["last"]).dt.days > 14)
        print(a, "overall", round(j.churn.mean(), 3))
        print(j.groupby(["region", "player_type"]).churn.mean().unstack().round(3))
        print("stuck", j.groupby("stuck_on_warden").churn.mean().round(3).to_dict())
    raise SystemExit(0)


# ---------------------------------------------------------------------------
# Write raw tables
# ---------------------------------------------------------------------------
ONLY = {t for t in os.environ.get("ONLY_TABLES", "").split(",") if t}


def write(df, name, comment, chunk=400_000):
    if ONLY and name not in ONLY:
        return
    for i in range(0, max(len(df), 1), chunk):
        sdf = spark.createDataFrame(df.iloc[i:i + chunk])
        (sdf.write.mode("overwrite" if i == 0 else "append").option("overwriteSchema", "true")
         .saveAsTable(f"{FQ}.`{name}`"))
    spark.sql(f"COMMENT ON TABLE {FQ}.`{name}` IS :c", args={"c": comment})
    print(f"  wrote {name}: {len(df):,}")


write(players, "players", "Hollowspire players who played between 2026-05-01 and 2026-09-27 (one row per player). status: Active (<7 days since last session), Lapsing (7-13), Churned (14+ days inactive). stuck_on_warden = failed Season 7 stage 7-4 four or more times without clearing it.")
write(daily, "player_daily", "One row per player x day played: sessions, minutes, PvE runs, ranked queues entered, average ranked queue wait (seconds), queues abandoned, spend (USD). Days with no row = the player did not log in.")
write(stage, "stage_attempts", "Season chapter stage attempts and clears per player x day (Season 6 Emberfall from 2026-06-09, Season 7 The Drowned Crown from 2026-08-18). Stage 7-4 is The Drowned Warden boss.")
write(purch, "purchases", "In-game purchases (USD): season pass, gem packs, bundles, cosmetics.")
write(chat, "chat_messages", "Moderation queue: chat lines flagged by the keyword filter or by a player report, 2026-08-01 to 2026-09-27. recipient_player_id = the player who received the message. Classified by AI Functions into chat_insights.")
write(catalog, "intervention_catalog", "Live-ops interventions: target churn driver, scope (global / region / targeted), cost model (fixed_cost_usd + cost_per_player_usd x players targeted) and lead time.")
write(hist, "liveops_history", "Past live-ops interventions (Seasons 3-6) measured against a holdout control group: retained at day 14 treated vs control, lift in percentage points, cost.")
write(budget, "liveops_budget", "Live-ops budget for the planning month.")

if ONLY:
    print("ONLY_TABLES set — skipping schedule / gold / constraints.")
    raise SystemExit(0)

spark.sql(f"""
CREATE TABLE IF NOT EXISTS {FQ}.liveops_schedule (
  schedule_id STRING, scheduled_at TIMESTAMP, segment_id STRING, churn_driver STRING, region STRING,
  intervention_code STRING, intervention_name STRING, start_date DATE, players_targeted INT, cost_usd DOUBLE,
  expected_players_retained INT, expected_ltv_retained_usd DOUBLE, player_message STRING, rationale STRING,
  scheduled_by STRING)
COMMENT 'Write-back from the Live-Ops Console app: every intervention the live-ops lead approves and schedules.'""")

# ---------------------------------------------------------------------------
# Gold tables
# ---------------------------------------------------------------------------
spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.gold_daily_kpis
COMMENT 'Daily live-ops KPIs by region: DAU, new installs, revenue, paying players, ARPDAU (revenue / DAU) and ARPPU. Season 7 launched 2026-08-18.'
AS
WITH dau AS (
  SELECT d.activity_date, p.region, count(*) AS dau, sum(d.spend_usd) AS revenue_usd,
         count_if(d.spend_usd > 0) AS payers, sum(d.minutes_played) AS minutes
  FROM {FQ}.player_daily d JOIN {FQ}.players p USING (player_id) GROUP BY ALL),
inst AS (SELECT install_date AS activity_date, region, count(*) AS new_installs FROM {FQ}.players GROUP BY ALL)
SELECT dau.activity_date, dau.region,
       CASE WHEN dau.activity_date >= DATE'2026-08-18' THEN 'Season 7' WHEN dau.activity_date >= DATE'2026-06-09' THEN 'Season 6' ELSE 'Season 5' END AS season,
       dau.dau, coalesce(inst.new_installs, 0) AS new_installs, round(dau.revenue_usd, 2) AS revenue_usd, dau.payers,
       round(dau.revenue_usd / dau.dau, 4) AS arpdau_usd,
       round(CASE WHEN dau.payers > 0 THEN dau.revenue_usd / dau.payers END, 2) AS arppu_usd,
       round(dau.minutes / dau.dau, 1) AS avg_minutes_per_dau
FROM dau LEFT JOIN inst USING (activity_date, region)""")

spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.gold_retention_cohorts
COMMENT 'Install cohorts (install date x region x acquisition channel) with D1 / D7 / D30 retained players (logged in exactly N days after install). A D-N value is NULL until the cohort is N days old (as of 2026-09-27). Rates = retained / installs.'
AS
WITH c AS (SELECT player_id, install_date, region, acquisition_channel FROM {FQ}.players WHERE install_date >= DATE'2026-05-01'),
a AS (SELECT c.*, datediff(d.activity_date, c.install_date) AS age FROM c JOIN {FQ}.player_daily d USING (player_id))
SELECT install_date, region, acquisition_channel,
       CASE WHEN install_date >= DATE'2026-08-18' THEN 'Season 7' WHEN install_date >= DATE'2026-06-09' THEN 'Season 6' ELSE 'Season 5' END AS install_season,
       count(DISTINCT player_id) AS installs,
       CASE WHEN install_date <= DATE'2026-09-26' THEN count(DISTINCT CASE WHEN age = 1 THEN player_id END) END AS d1_retained,
       CASE WHEN install_date <= DATE'2026-09-20' THEN count(DISTINCT CASE WHEN age = 7 THEN player_id END) END AS d7_retained,
       CASE WHEN install_date <= DATE'2026-08-28' THEN count(DISTINCT CASE WHEN age = 30 THEN player_id END) END AS d30_retained
FROM a GROUP BY ALL""")

spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.gold_stage_funnel
COMMENT 'Season chapter funnel: per stage, players who attempted, attempts, clears, attempt clear rate and players stuck (4+ fails, never cleared). Stage 7-4 The Drowned Warden is the Season 7 difficulty spike.'
AS
WITH per_player AS (
  SELECT season, stage_id, stage_name, player_id, sum(attempts) AS attempts, sum(clears) AS clears
  FROM {FQ}.stage_attempts GROUP BY ALL)
SELECT season, stage_id, stage_name, count(*) AS players_attempted, sum(attempts) AS attempts, sum(clears) AS clears,
       round(sum(clears) / sum(attempts), 3) AS attempt_clear_rate,
       count_if(clears = 0 AND attempts >= 4) AS players_stuck,
       round(count_if(clears = 0 AND attempts >= 4) / count(*), 3) AS stuck_share
FROM per_player GROUP BY ALL""")

spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.gold_matchmaking_daily
COMMENT 'Ranked matchmaking by day x region: queues entered, players queueing, average queue wait (seconds, queue-weighted) and abandon rate. Season 7 split the ranked queue on 2026-08-18.'
AS
SELECT d.activity_date, p.region, sum(d.ranked_queues) AS queues, count(*) AS players_queueing,
       round(sum(d.avg_queue_wait_sec * d.ranked_queues) / sum(d.ranked_queues), 0) AS avg_queue_wait_sec,
       round(sum(d.queue_abandons) / sum(d.ranked_queues), 3) AS abandon_rate
FROM {FQ}.player_daily d JOIN {FQ}.players p USING (player_id)
WHERE d.ranked_queues > 0 GROUP BY ALL""")

spark.sql(f"""
CREATE OR REPLACE TABLE {FQ}.gold_churn_weekly
COMMENT 'Weekly churn by cohort: players active in the week (Monday start) and how many of them never played again for 14+ days after their last session that week (churned_14d). churn_rate = churned_14d / active_players. Weeks after 2026-09-13 are not yet observable.'
AS
WITH w AS (
  SELECT date_trunc('WEEK', d.activity_date) AS week_start, d.player_id, max(d.activity_date) AS last_in_week
  FROM {FQ}.player_daily d GROUP BY ALL),
nxt AS (
  SELECT w.*, (SELECT min(x.activity_date) FROM {FQ}.player_daily x WHERE x.player_id = w.player_id AND x.activity_date > w.last_in_week) AS next_play
  FROM w)
SELECT week_start, p.region, p.player_type, p.spender_tier,
       CASE WHEN datediff(week_start, p.install_date) < 14 THEN 'New (< 14 days)' ELSE 'Veteran' END AS tenure_band,
       count(*) AS active_players,
       count_if(coalesce(next_play, DATE'2026-12-31') > date_add(last_in_week, 14)) AS churned_14d,
       round(count_if(coalesce(next_play, DATE'2026-12-31') > date_add(last_in_week, 14)) / count(*), 4) AS churn_rate
FROM nxt JOIN {FQ}.players p USING (player_id)
WHERE week_start <= DATE'2026-09-07'
GROUP BY ALL""")

# PK / FK (RELY) for Genie + Catalog Explorer
for t, col in [("players", "player_id"), ("purchases", "purchase_id"), ("chat_messages", "message_id"),
               ("intervention_catalog", "intervention_code"), ("liveops_history", "run_id")]:
    try:
        spark.sql(f"ALTER TABLE {FQ}.{t} ALTER COLUMN {col} SET NOT NULL")
        spark.sql(f"ALTER TABLE {FQ}.{t} ADD CONSTRAINT {t}_pk PRIMARY KEY ({col}) RELY")
    except Exception as e:  # re-runs: constraint exists
        print(f"  (pk {t}: {str(e).splitlines()[0][:80]})")
for t, col in [("player_daily", "player_id"), ("stage_attempts", "player_id"), ("purchases", "player_id"),
               ("chat_messages", "recipient_player_id")]:
    try:
        spark.sql(f"ALTER TABLE {FQ}.{t} ADD CONSTRAINT {t}_player_fk FOREIGN KEY ({col}) REFERENCES {FQ}.players(player_id) RELY")
    except Exception as e:
        print(f"  (fk {t}: {str(e).splitlines()[0][:80]})")

print(spark.sql(f"""SELECT install_season, round(100*sum(d1_retained)/sum(CASE WHEN d1_retained IS NOT NULL THEN installs END),1) d1,
  round(100*sum(d7_retained)/sum(CASE WHEN d7_retained IS NOT NULL THEN installs END),1) d7,
  round(100*sum(d30_retained)/sum(CASE WHEN d30_retained IS NOT NULL THEN installs END),1) d30
  FROM {FQ}.gold_retention_cohorts GROUP BY 1 ORDER BY 1""").toPandas().to_string())
print("done.")
