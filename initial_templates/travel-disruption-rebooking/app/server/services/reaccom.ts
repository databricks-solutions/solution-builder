/**
 * The re-accommodation plan — the IROPS desk's AI step for ONE cancelled flight.
 *
 *   1. Read the manifest: every passenger with SSR codes, tier, onward connection, the AI-Functions
 *      reading of their message, the ML detractor-risk scores and what AutoProtect held for them.
 *   2. Load the protected inventory: own-metal and Lumen Air partner seats, nearby airports, next day,
 *      hotel rooms left in the block, and the guardrails.
 *   3. Ask the Genie agent (policy documents) the one policy question this flight hinges on (EU261 care, UMNR, hotels).
 *   4. Allocate — DETERMINISTICALLY (seats, money and rules are never left to an LLM): parties kept
 *      together, priority order OPS-IROPS-01 §2, feasibility rules (UMNR, WCHC, nearby airports,
 *      onward connection timing), partner cost caps, hotel entitlement G5. Price the plan and AutoProtect
 *      on the same cost model, and check every guardrail (→ Duty Manager approval when needed).
 *   5. Have a Foundation Model write the Duty Manager summary + personalised notifications for the
 *      priority bookings, in each passenger's language. Everyone else gets the standard template.
 *
 * Every step is reported through `onStep` so the UI can stream progress.
 */
import type { Request } from 'express';
import type {
  Assignment, GuardrailCheck, Notification, PlanMetrics, Priority, ReaccomPlan,
} from '../db/schema.js';
import { askDocuments, chatJson } from '../lib/serving.js';

export type StepEvent = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };

export type Pax = {
  id: string; pnr: string; firstName: string; lastName: string; age: number | null; tier: string; cabin: string | null;
  fareBrand: string | null; originType: string | null; awayFromHome: boolean; homeCity: string | null;
  finalDestination: string | null; onwardFlight: string | null; onwardDep: string | null; onwardLongHaul: boolean;
  ssr: string; partySize: number; language: string | null; channel: string | null; euUk261: string | null;
  apOptionId: string | null; apLabel: string | null; apArrive: string | null; apSameDay: boolean; apNights: number; apMisconnect: boolean; apSplit: boolean;
  pSameDay: number | null; pNextDay: number | null; pAutoprotect: number | null;
  messageEnglish: string | null; messageIntent: string | null; messageUrgency: string | null; messageSummary: string | null;
  escalated: boolean;
};
export type Opt = {
  id: string; rank: number; optionType: string; carrier: string; label: string; depart: string; arrive: string;
  arrivalAirport: string; seatsRemaining: number; costPerSeat: number; isPartner: boolean; sameDay: boolean;
  nearbyAirport: boolean; acceptsUmnr: boolean; delayHours: number;
};
export type Hotel = { id: string; airport: string; name: string; roomsRemaining: number; accessibleRooms: number; rate: number };
export type Flight = {
  id: string; flightNumber: string; origin: string; destination: string; destinationCity: string | null;
  schedDep: string; schedArr: string; cancelReason: string | null; euUk261: string | null; seats: number | null;
};
export type Guardrails = Record<string, number>;

const PRM = /UMNR|WCHR|WCHS|WCHC|BLND|DEAF|MEDA|INFT/;
const TIER_RANK: Record<string, number> = { Member: 0, Silver: 1, Gold: 2, Platinum: 3, Diamond: 4 };
const MCT_MIN = 75;
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const minutes = (iso: string) => new Date(`${iso}:00Z`).getTime() / 60000;
/** "2026-02-13T14:20" → "Fri 13 Feb 14:20" (local airport time — no timezone math). */
export const dayTime = (iso: string) => `${new Date(`${iso}:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '')} ${iso.slice(11, 16)}`;

type Group = { pnr: string; members: Pax[]; priority: Priority; reason: string; harm: number };

export const PRIORITY_LABEL: Record<Priority, string> = {
  P1: 'Special assistance', P2: 'Onward long-haul', P3: 'Urgent life event', P4: 'Top tier / premium',
  P5: 'Away from home', P6: 'Local resident',
};

function classify(members: Pax[]): { priority: Priority; reason: string } {
  const ssr = members.flatMap((m) => m.ssr.split(',').filter(Boolean));
  if (ssr.some((c) => PRM.test(c))) {
    const what = [...new Set(ssr.filter((c) => PRM.test(c)))].join(', ');
    return { priority: 'P1', reason: `SSR ${what}` };
  }
  const onward = members.find((m) => m.onwardLongHaul);
  if (onward) return { priority: 'P2', reason: `Connects to ${onward.onwardFlight} at ${onward.onwardDep?.slice(11)}` };
  if (members.some((m) => m.messageUrgency === 'urgent_life_event')) return { priority: 'P3', reason: 'Urgent life event (AI-flagged message)' };
  const top = members.reduce((a, m) => Math.max(a, TIER_RANK[m.tier] ?? 0), 0);
  const premium = members.some((m) => m.cabin === 'First' || m.cabin === 'Business');
  if (top >= 2 || premium) {
    const tier = Object.entries(TIER_RANK).find(([, v]) => v === top)?.[0] ?? 'Member';
    return { priority: 'P4', reason: premium ? `${members[0].cabin} cabin${top >= 2 ? `, ${tier}` : ''}` : tier };
  }
  if (members.some((m) => m.awayFromHome)) return { priority: 'P5', reason: members[0].originType === 'CONNECTING' ? 'Connecting at ORD, away from home' : 'Visitor going home' };
  return { priority: 'P6', reason: 'Local resident — can go home' };
}

/** Hotel entitlement for an overnight (CARE-02 §3.2 / guardrail G5), weather = uncontrollable. */
function hotelEntitled(g: Group, eu: boolean): boolean {
  if (!g.members.some((m) => m.awayFromHome)) return false; // local residents go home
  if (eu) return true;
  if (g.priority === 'P1') return true;
  return g.members.some((m) => (TIER_RANK[m.tier] ?? 0) >= 2);
}

/** CARE-02 §2: $15 per 3 hours of delay, max 3 vouchers per day of delay. */
function mealCost(delayHours: number, nights: number, rate: number) {
  return rate * Math.min(3 * (nights + 1), Math.floor(Math.max(0, delayHours) / 3));
}
const topTier = (m: Pax) => (TIER_RANK[m.tier] ?? 0) >= 2;

type CostModel = { hotelRate: number; meal: number; misconnect: number; splitCredit: number; goodwill: number };

/** Price AutoProtect's hold on the SAME cost model (hotels it still owes, meals, misconnects, split-party credits). */
function priceAutoprotect(pax: Pax[], opts: Opt[], eu: boolean, cm: CostModel): PlanMetrics {
  const byLabel = new Map(opts.map((o) => [o.id, o]));
  const groups = groupByPnr(pax);
  let hotelRooms = 0, hotelCost = 0, meal = 0, misc = 0, good = 0, det = 0, detN = 0;
  for (const g of groups) {
    const overnightMembers = g.members.filter((m) => !m.apSameDay);
    if (overnightMembers.length && hotelEntitled(g, eu)) {
      const rooms = Math.ceil(overnightMembers.length / 3);
      const nights = Math.max(...overnightMembers.map((m) => m.apNights));
      hotelRooms += rooms;
      hotelCost += rooms * nights * cm.hotelRate;
    }
  }
  for (const m of pax) {
    const o = m.apOptionId ? byLabel.get(m.apOptionId) : undefined;
    meal += mealCost(o?.delayHours ?? (m.apSameDay ? 5 : 22), m.apNights, cm.meal);
    if (m.apMisconnect) misc += cm.misconnect;
    if (m.apSplit) good += cm.splitCredit;
    if (!m.apSameDay && topTier(m)) good += cm.goodwill;
    if (m.pAutoprotect != null) { det += m.pAutoprotect; detN++; }
  }
  const sameDay = pax.filter((m) => m.apSameDay).length;
  const prio = groups.filter((g) => g.priority === 'P1' || g.priority === 'P2' || g.priority === 'P3');
  const total = hotelCost + meal + misc + good;
  return {
    pax: pax.length, same_day: sameDay, overnight: pax.length - sameDay, day_plus_2: pax.filter((m) => m.apNights >= 2).length,
    priority_pax: prio.reduce((a, g) => a + g.members.length, 0),
    priority_same_day: prio.reduce((a, g) => a + g.members.filter((m) => m.apSameDay).length, 0),
    special_assistance_overnight: pax.filter((m) => !m.apSameDay && PRM.test(m.ssr)).length,
    umnr_overnight: pax.filter((m) => !m.apSameDay && m.ssr.includes('UMNR')).length,
    onward_pax: pax.filter((m) => m.onwardLongHaul).length, misconnects: pax.filter((m) => m.apMisconnect).length,
    split_parties: new Set(pax.filter((m) => m.apSplit).map((m) => m.pnr)).size, partner_seats: 0, partner_spend: 0,
    hotel_rooms: hotelRooms, hotel_cost: hotelCost, meal_cost: meal, misconnect_cost: misc, goodwill_cost: good,
    total_cost: total, cost_per_pax: pax.length ? total / pax.length : 0,
    predicted_detractor_rate: detN ? det / detN : null,
  };
}

function groupByPnr(pax: Pax[]): Group[] {
  const m = new Map<string, Pax[]>();
  for (const p of pax) m.set(p.pnr, [...(m.get(p.pnr) ?? []), p]);
  return [...m.entries()].map(([pnr, members]) => {
    const { priority, reason } = classify(members);
    const harm = members.reduce((a, x) => a + ((x.pNextDay ?? 0) - (x.pSameDay ?? 0)), 0) / members.length;
    return { pnr, members, priority, reason, harm };
  });
}

export type Allocation = {
  assignments: Assignment[];
  metrics: PlanMetrics;
  autoprotect: PlanMetrics;
  guardrails: GuardrailCheck[];
  requiresApproval: boolean;
  approvalReasons: string[];
  released: ReaccomPlan['released_seats'];
  seatUse: Record<string, number>;
  roomUse: Record<string, number>;
};

/** Pure, deterministic allocation — unit-testable, no I/O. */
export function allocate(flight: Flight, pax: Pax[], opts: Opt[], hotels: Hotel[], gr: Guardrails): Allocation {
  const eu = !!flight.euUk261;
  const longHaul = eu || ['FRA', 'LHR'].includes(flight.destination);
  const cap = longHaul ? (gr.G1L ?? 700) : (gr.G1 ?? 350);
  const local = hotels.filter((h) => h.airport === flight.origin);
  const avgRate = local.length ? local.reduce((a, h) => a + h.rate, 0) / local.length : (gr.G9 ?? 139);
  const cm: CostModel = { hotelRate: avgRate, meal: gr.G7 ?? 15, misconnect: gr.G10 ?? 570, splitCredit: 100, goodwill: 100 };
  const remaining = new Map(opts.map((o) => [o.id, o.seatsRemaining]));
  const rooms = new Map(hotels.map((h) => [h.id, h.roomsRemaining]));
  const order: Priority[] = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
  const groups = groupByPnr(pax).sort((a, b) =>
    order.indexOf(a.priority) - order.indexOf(b.priority) || b.harm - a.harm || a.members.length - b.members.length || a.pnr.localeCompare(b.pnr));
  const sorted = [...opts].sort((a, b) => minutes(a.arrive) - minutes(b.arrive));
  const assignments: Assignment[] = [];
  const notes: string[] = [];
  let capBreaches = 0;

  for (const g of groups) {
    const size = g.members.length;
    const umnr = g.members.filter((m) => m.ssr.includes('UMNR'));
    const wchc = g.members.some((m) => m.ssr.includes('WCHC'));
    const onward = g.members.find((m) => m.onwardLongHaul && m.onwardDep);
    const local = g.priority === 'P6';
    const feasible = sorted.filter((o) => {
      if ((remaining.get(o.id) ?? 0) < size) return false;
      if (o.nearbyAirport && (umnr.length || wchc || onward)) return false;           // G8 / SSR-04 §2.4
      if (umnr.length && o.isPartner && (!o.acceptsUmnr || umnr.some((u) => (u.age ?? 0) < 8))) return false; // G3
      if (umnr.length && !o.sameDay) return false;                                     // G3: never overnight
      if (o.isPartner && !eu && o.costPerSeat > cap) { capBreaches++; return false; }  // G1
      if (o.isPartner && local && !eu) return false;                                   // no partner spend on locals (§2.6)
      return true;
    });
    const makes = (o: Opt) => !onward || minutes(o.arrive) + MCT_MIN <= minutes(onward.onwardDep!);
    // Onward connections: the cheapest option that still makes the connection (own before partner), else earliest.
    let pick: Opt | undefined;
    if (onward) {
      const ok = feasible.filter((o) => o.sameDay && makes(o));
      pick = ok.find((o) => !o.isPartner) ?? ok[0];
    }
    if (!pick) {
      const sameDay = feasible.filter((o) => o.sameDay);
      // own metal first when it arrives within 90 min of the best partner option; else earliest
      const own = sameDay.find((o) => !o.isPartner);
      const first = sameDay[0];
      pick = own && first && minutes(own.arrive) - minutes(first.arrive) <= 90 ? own : first;
    }
    if (!pick) pick = feasible[0];
    if (!pick) {
      // UMNR with nothing feasible the same day → return to guardian (exception, logged)
      pick = sorted.find((o) => (remaining.get(o.id) ?? 0) >= size) ?? sorted[sorted.length - 1];
    }
    remaining.set(pick.id, (remaining.get(pick.id) ?? 0) - size);

    let hotelId: string | null = null, hotelName: string | null = null;
    const nights = pick.sameDay ? 0 : pick.optionType === 'OWN_D2' ? 2 : 1;
    let note: string | null = null;
    if (!pick.sameDay && umnr.length) note = 'UMNR cannot overnight — return to the dropping-off guardian and rebook tomorrow with escort (Duty Manager exception).';
    else if (!pick.sameDay && hotelEntitled(g, eu) && !umnr.length) {
      const needRooms = Math.ceil(size / 3);
      const accessible = g.members.some((m) => /WCH/.test(m.ssr));
      const h = hotels.filter((x) => x.airport === flight.origin && (rooms.get(x.id) ?? 0) >= needRooms)
        .sort((a, b) => (accessible ? b.accessibleRooms - a.accessibleRooms : 0) || a.rate - b.rate)[0];
      if (h) {
        rooms.set(h.id, (rooms.get(h.id) ?? 0) - needRooms);
        hotelId = h.id;
        hotelName = h.name;
      } else note = 'Hotel block exhausted — issue a distressed-rate voucher.';
    } else if (!pick.sameDay && g.members.some((m) => m.awayFromHome)) note = 'Distressed-passenger hotel rate offered (weather, not entitled).';
    else if (!pick.sameDay && local) note = 'Local resident — go home tonight; full refund offered if they no longer want to travel.';

    const overflow = !pick.sameDay && !hotelId && !umnr.length && hotelEntitled(g, eu); // block exhausted → paid voucher
    const hotelRate = hotelId ? (hotels.find((h) => h.id === hotelId)?.rate ?? cm.hotelRate) : overflow ? cm.hotelRate : 0;
    const roomsFor = hotelId || overflow ? Math.ceil(size / 3) : 0;
    g.members.forEach((m, i) => {
      const miss = !!(m.onwardLongHaul && m.onwardDep && (!pick!.sameDay || minutes(pick!.arrive) + MCT_MIN > minutes(m.onwardDep)));
      const partnerCost = pick!.isPartner ? pick!.costPerSeat : 0;
      const meal = mealCost(pick!.delayHours, nights, cm.meal);
      const hotelShare = i === 0 ? roomsFor * nights * hotelRate : 0;
      const good = !pick!.sameDay && topTier(m) ? cm.goodwill : 0;
      assignments.push({
        pax_id: m.id, pnr: m.pnr, name: `${m.firstName} ${m.lastName}`, priority: g.priority, priority_reason: g.reason,
        option_id: pick!.id, label: pick!.label, depart: pick!.depart, arrive: pick!.arrive, arrival_airport: pick!.arrivalAirport,
        same_day: pick!.sameDay, nights, delay_hours: pick!.delayHours, is_partner: pick!.isPartner, partner_cost: partnerCost,
        hotel_id: hotelId, hotel_name: hotelName, meal_usd: meal, misconnect: miss,
        cost_usd: partnerCost + meal + hotelShare + good + (miss ? cm.misconnect : 0),
        p_detractor: pick!.sameDay ? m.pSameDay : m.pNextDay, note: i === 0 ? note : null,
        ap: { label: m.apLabel, same_day: m.apSameDay, nights: m.apNights, misconnect: m.apMisconnect, split: m.apSplit },
      });
    });
  }

  // ── metrics ──────────────────────────────────────────────────────────
  const byPax = new Map(pax.map((p) => [p.id, p]));
  const sum = (f: (a: Assignment) => number) => assignments.reduce((a, x) => a + f(x), 0);
  const prioSet = new Set(groups.filter((g) => ['P1', 'P2', 'P3'].includes(g.priority)).flatMap((g) => g.members.map((m) => m.id)));
  const hotelRooms = new Set<string>();
  let hotelRoomCount = 0;
  for (const g of groups) {
    const a = assignments.find((x) => x.pnr === g.pnr && x.hotel_id);
    if (a && !hotelRooms.has(g.pnr)) { hotelRooms.add(g.pnr); hotelRoomCount += Math.ceil(g.members.length / 3); }
  }
  const dets = assignments.map((a) => a.p_detractor).filter((x): x is number => x != null);
  const partnerSpend = sum((a) => a.partner_cost);
  const meal = sum((a) => a.meal_usd);
  const misc = assignments.filter((a) => a.misconnect).length * cm.misconnect;
  const goodwill = assignments.filter((a) => !a.same_day && topTier(byPax.get(a.pax_id)!)).length * cm.goodwill;
  const hotelCost = sum((a) => a.cost_usd) - partnerSpend - meal - misc - goodwill;
  const total = partnerSpend + hotelCost + meal + misc + goodwill;
  const metrics: PlanMetrics = {
    pax: pax.length, same_day: assignments.filter((a) => a.same_day).length, overnight: assignments.filter((a) => !a.same_day).length,
    day_plus_2: assignments.filter((a) => a.nights >= 2).length, priority_pax: prioSet.size,
    priority_same_day: assignments.filter((a) => prioSet.has(a.pax_id) && a.same_day).length,
    special_assistance_overnight: assignments.filter((a) => !a.same_day && PRM.test(byPax.get(a.pax_id)!.ssr)).length,
    umnr_overnight: assignments.filter((a) => !a.same_day && byPax.get(a.pax_id)!.ssr.includes('UMNR')).length,
    onward_pax: pax.filter((p) => p.onwardLongHaul).length, misconnects: assignments.filter((a) => a.misconnect).length,
    split_parties: 0, partner_seats: assignments.filter((a) => a.is_partner).length, partner_spend: partnerSpend,
    hotel_rooms: hotelRoomCount, hotel_cost: hotelCost, meal_cost: meal, misconnect_cost: misc, goodwill_cost: goodwill,
    total_cost: total, cost_per_pax: pax.length ? total / pax.length : 0,
    predicted_detractor_rate: dets.length ? dets.reduce((a, x) => a + x, 0) / dets.length : null,
  };
  const autoprotect = priceAutoprotect(pax, opts, eu, cm);

  // ── guardrails ───────────────────────────────────────────────────────
  const approvalReasons: string[] = [];
  const checks: GuardrailCheck[] = [];
  const auto = gr.G2 ?? 6000;
  if (eu) checks.push({ rule_id: 'G6', name: `${flight.euUk261} rerouting at the earliest opportunity`, status: 'exempt', detail: `Partner spend ${money(partnerSpend)} exempt from G1/G2 (${flight.euUk261} Art. 8); care incl. hotels owed to every passenger (Art. 9).` });
  checks.push({ rule_id: 'G1', name: `Partner seat ≤ ${money(cap)}`, status: 'ok', detail: capBreaches ? `Options above the cap were skipped.` : `Every partner seat used is within the cap.` });
  if (!eu && partnerSpend > auto) {
    checks.push({ rule_id: 'G2', name: `Partner spend ≤ ${money(auto)} auto-approve`, status: 'approval', detail: `${money(partnerSpend)} on ${metrics.partner_seats} Lumen Air seats — needs the IROPS Duty Manager.` });
    approvalReasons.push(`Partner spend ${money(partnerSpend)} exceeds the ${money(auto)} auto-approve limit (G2).`);
  } else if (!eu) checks.push({ rule_id: 'G2', name: `Partner spend ≤ ${money(auto)} auto-approve`, status: 'ok', detail: `${money(partnerSpend)} partner spend.` });
  checks.push({ rule_id: 'G3', name: 'Unaccompanied minors never overnight', status: metrics.umnr_overnight ? 'exception' : 'ok', detail: metrics.umnr_overnight ? `${metrics.umnr_overnight} UMNR could not be protected today — return to guardian.` : `${pax.filter((p) => p.ssr.includes('UMNR')).length} UMNR, all re-accommodated today.` });
  if (metrics.umnr_overnight || metrics.special_assistance_overnight) {
    if (metrics.special_assistance_overnight) approvalReasons.push(`${metrics.special_assistance_overnight} special-assistance passenger(s) overnight (policy §4.2 exception).`);
  }
  checks.push({ rule_id: 'G4', name: 'Parties kept together', status: 'ok', detail: `${groups.length} bookings, none split (AutoProtect split ${autoprotect.split_parties}).` });
  checks.push({ rule_id: 'G5', name: 'Hotels only where entitled', status: 'ok', detail: `${hotelRoomCount} rooms from the block (${money(hotelCost)}).` });
  if (notes.length) checks.push({ rule_id: 'NOTE', name: 'Notes', status: 'ok', detail: notes.join(' ') });

  const released: ReaccomPlan['released_seats'] = [];
  for (const o of opts) {
    const left = remaining.get(o.id) ?? 0;
    if (o.sameDay && o.isPartner && left > 0) released.push({ option_id: o.id, label: o.label, seats: left, why: 'Not needed by any passenger who is entitled to partner spend — released back to Lumen Air.' });
  }
  const seatUse: Record<string, number> = {};
  for (const a of assignments) seatUse[a.option_id] = (seatUse[a.option_id] ?? 0) + 1;
  const roomUse: Record<string, number> = {};
  for (const [id, left] of rooms) {
    const h = hotels.find((x) => x.id === id)!;
    if (h.roomsRemaining - left > 0) roomUse[id] = h.roomsRemaining - left;
  }
  return { assignments, metrics, autoprotect, guardrails: checks, requiresApproval: approvalReasons.length > 0, approvalReasons, released, seatUse, roomUse };
}

// ─────────────────────────────────────────────────────────────────────────
// The full pipeline (policy documents via the Genie agent + LLM around the deterministic engine)
// ─────────────────────────────────────────────────────────────────────────

function policyQuestion(f: Flight, pax: Pax[]): string {
  if (f.euUk261) return `${f.flightNumber} ${f.origin}→${f.destination} was cancelled because Chicago O'Hare was closed by Winter Storm Harlan. Under ${f.euUk261}, do we owe these passengers compensation, and what care and rerouting must we provide (hotels, meals, other airlines)?`;
  if (['FRA', 'LHR'].includes(f.destination)) return `${f.flightNumber} ORD→${f.destination} was cancelled for weather. Does EU261 or UK261 apply to this flight, and what do we owe the passengers instead?`;
  const umnr = pax.some((p) => p.ssr.includes('UMNR'));
  return `${f.flightNumber} ORD→${f.destination} was cancelled by Winter Storm Harlan (weather).${umnr ? ' It has unaccompanied minors on board — what are the rules for re-accommodating them, including on Lumen Air?' : ''} Which passengers get a free hotel room if they have to overnight, and what refund must we offer passengers who decline the rebooking?`;
}

const LANG_LINE: Record<string, string> = { Spanish: 'Spanish', German: 'German', Japanese: 'Japanese' };

function templateNotification(f: Flight, a: Assignment, names: string, lang: string, channel: string, eu: boolean): Notification {
  const when = dayTime(a.depart);
  const arr = dayTime(a.arrive);
  const care = a.hotel_name ? ` A room is booked for you at ${a.hotel_name} (shuttle from Door 4).` : a.same_day ? '' : ' Meal vouchers are in the Aeralis app.';
  const text = `Aeralis: ${names}, ${f.flightNumber} to ${f.destinationCity ?? f.destination} is cancelled due to Winter Storm Harlan. You are rebooked on ${a.label}, departing ${when}, arriving ${arr}.${care}${a.meal_usd ? ` $${a.meal_usd} in meal vouchers added.` : ''} Don't want to travel? You're entitled to a full refund to your original payment${eu ? ' (EU261)' : ''}: aeralis.example/rebook`;
  return { pnr: a.pnr, names, channel, language: lang, text, personalized: false };
}

export async function planFlight(
  req: Request,
  ctx: { flight: Flight; pax: Pax[]; opts: Opt[]; hotels: Hotel[]; guardrails: Guardrails; draftedBy: string },
  cfg: { genieSpaceId: string; model: string; onStep: (e: StepEvent) => void },
): Promise<{ plan: ReaccomPlan; allocation: Allocation }> {
  const { flight: f, pax, opts } = ctx;
  const { onStep } = cfg;
  const esc = pax.filter((p) => p.escalated).length;
  const ssr = pax.filter((p) => PRM.test(p.ssr)).length;
  onStep({ id: 'manifest', label: `Reading the manifest of ${f.flightNumber}`, status: 'running' });
  onStep({ id: 'manifest', label: `Read ${pax.length} passengers on ${new Set(pax.map((p) => p.pnr)).size} bookings`, status: 'done',
    detail: `${ssr} need special assistance · ${pax.filter((p) => p.onwardLongHaul).length} onward long-haul · ${esc} escalated messages (AI Functions) · detractor risk from detractor_risk_model@champion` });

  onStep({ id: 'inventory', label: 'Loading protected seats and hotel rooms', status: 'running' });
  const sameDaySeats = opts.filter((o) => o.sameDay).reduce((a, o) => a + o.seatsRemaining, 0);
  const partner = opts.filter((o) => o.sameDay && o.isPartner).reduce((a, o) => a + o.seatsRemaining, 0);
  const rooms = ctx.hotels.filter((h) => h.airport === f.origin).reduce((a, h) => a + h.roomsRemaining, 0);
  onStep({ id: 'inventory', label: `${sameDaySeats} same-day seats (${partner} Lumen Air), ${rooms} hotel rooms left`, status: 'done',
    detail: opts.map((o) => `${o.label} ${o.depart.slice(11)} · ${o.seatsRemaining >= 999 ? 'open' : o.seatsRemaining}`).join(' · ') });

  const question = policyQuestion(f, pax);
  onStep({ id: 'policy', label: 'Consulting IROPS policy & passenger rights (Genie agent)', status: 'running', detail: question });
  let guidance: ReaccomPlan['policy_guidance'] = null;
  if (cfg.genieSpaceId) {
    try {
      const doc = await askDocuments(req, cfg.genieSpaceId, `Answer from the Aeralis IROPS policy, fare-rule and passenger-rights documents only, citing the document ID: ${question}`);
      // Genie answers carry inline citation tokens ([1], [file_<hex>]) that mean nothing in the UI.
      const answer = doc.answer.replace(/\s*\[(?:\d+|file_[0-9a-f]+)\]/g, '');
      guidance = { question, answer, sources: doc.sources };
      onStep({ id: 'policy', label: 'Policy guidance retrieved', status: 'done', detail: doc.sources.join(', ') || 'Aeralis policy documents' });
    } catch (e) {
      onStep({ id: 'policy', label: 'Policy documents unavailable', status: 'error', detail: (e as Error).message.slice(0, 160) });
    }
  } else onStep({ id: 'policy', label: 'Genie agent not configured', status: 'error' });

  onStep({ id: 'allocate', label: 'Re-accommodating in priority order within the guardrails', status: 'running' });
  const al = allocate(f, pax, opts, ctx.hotels, ctx.guardrails);
  const m = al.metrics, ap = al.autoprotect;
  onStep({ id: 'allocate', label: `${m.same_day} of ${m.pax} re-accommodated today (AutoProtect: ${ap.same_day})`, status: 'done',
    detail: `priority passengers today ${m.priority_same_day}/${m.priority_pax} · misconnects ${m.misconnects} (was ${ap.misconnects}) · partner ${money(m.partner_spend)} · cost ${money(m.total_cost)} vs ${money(ap.total_cost)}${al.requiresApproval ? ' · needs Duty Manager approval' : ''}` });

  // Personalised notifications for the priority bookings (P1-P3, escalations, non-English); template for the rest.
  const eu = !!f.euUk261;
  const byPnr = new Map<string, Assignment[]>();
  for (const a of al.assignments) byPnr.set(a.pnr, [...(byPnr.get(a.pnr) ?? []), a]);
  const paxById = new Map(pax.map((p) => [p.id, p]));
  const special = [...byPnr.entries()].filter(([, as]) => {
    const p = paxById.get(as[0].pax_id)!;
    return ['P1', 'P2', 'P3'].includes(as[0].priority) || as.some((x) => paxById.get(x.pax_id)!.escalated) || (p.language && p.language !== 'English');
  }).slice(0, 28);
  onStep({ id: 'notify', label: `Drafting ${special.length} personalised notifications`, status: 'running' });
  const system = `You write for the Aeralis Airways IROPS desk (Aeralis is a fictional US airline; Lumen Air its partner). Winter Storm Harlan closed Chicago O'Hare; weather is an uncontrollable cause.
Produce (1) "summary": 3 sentences for the IROPS Duty Manager comparing this plan with AutoProtect (same-day count, special-assistance and connections protected, cost, why approval is or is not needed) — use ONLY the numbers given, never derive new breakdowns — and (2) "notifications": one message per booking listed, written in the language given, warm and specific, max 75 words. For a booking with an unaccompanied minor (UMNR) write TO THE PARENT/GUARDIAN about the child by name, never to the child. Include: the new flight with the day and times exactly as given in depart_local / arrive_local (local airport times), why (storm), what care they get (hotel name / meal vouchers / wheelchair assistance / UMNR escort and that the desk is calling the guardians), for onward connections that the connection is protected, and that they may decline and get a full refund to the original payment${eu ? ` (and their ${f.euUk261} rights)` : ''}. Use only the facts given. Plain text, no markdown. Return ONLY JSON: {"summary": string, "notifications": [{"pnr": string, "text": string}]}.`;
  const user = JSON.stringify({
    flight: `${f.flightNumber} ${f.origin}→${f.destination} (${f.destinationCity}), cancelled: ${f.cancelReason}`,
    priority_breakdown: {
      unaccompanied_minors: pax.filter((p) => p.ssr.includes('UMNR')).length,
      wheelchair_or_assistance: pax.filter((p) => /WCH|BLND|DEAF|MEDA/.test(p.ssr)).length,
      lap_infant_bookings: new Set(pax.filter((p) => p.ssr.includes('INFT')).map((p) => p.pnr)).size,
      onward_long_haul_passengers: pax.filter((p) => p.onwardLongHaul).length,
      urgent_life_event_bookings: new Set(pax.filter((p) => p.messageUrgency === 'urgent_life_event').map((p) => p.pnr)).size,
    },
    plan: { same_day: m.same_day, pax: m.pax, priority_same_day: `${m.priority_same_day}/${m.priority_pax}`, misconnects: m.misconnects, special_assistance_overnight: m.special_assistance_overnight, partner_spend: Math.round(m.partner_spend), total_cost: Math.round(m.total_cost), predicted_detractor_rate: m.predicted_detractor_rate },
    autoprotect: { same_day: ap.same_day, misconnects: ap.misconnects, special_assistance_overnight: ap.special_assistance_overnight, umnr_overnight: ap.umnr_overnight, split_parties: ap.split_parties, total_cost: Math.round(ap.total_cost), predicted_detractor_rate: ap.predicted_detractor_rate },
    requires_approval: al.requiresApproval, approval_reasons: al.approvalReasons,
    policy_guidance: guidance?.answer?.slice(0, 1200) ?? null,
    bookings: special.map(([pnr, as]) => {
      const p = paxById.get(as[0].pax_id)!;
      return {
        pnr, passengers: as.map((a) => { const x = paxById.get(a.pax_id)!; return `${a.name}${x.age != null && x.age < 16 ? ` (age ${x.age})` : ''}${x.ssr ? ` [${x.ssr}]` : ''}`; }).join(', '),
        language: LANG_LINE[p.language ?? ''] ?? 'English', tier: p.tier, why_priority: as[0].priority_reason,
        new_flight: as[0].label, depart_local: `${dayTime(as[0].depart)} from ${f.origin}`, arrive_local: `${dayTime(as[0].arrive)} at ${as[0].arrival_airport}`, same_day: as[0].same_day,
        hotel: as[0].hotel_name, meal_vouchers_usd: as[0].meal_usd, onward: p.onwardFlight ? `${p.onwardFlight} departs ${p.onwardDep}` : null,
        their_message: p.messageEnglish?.slice(0, 300) ?? null, note: as[0].note,
      };
    }),
  });
  let summary = '';
  const notifications: Notification[] = [];
  try {
    const out = await chatJson<{ summary: string; notifications: Array<{ pnr: string; text: string }> }>(req, cfg.model, system, user, 9000);
    summary = out.summary;
    for (const n of out.notifications ?? []) {
      const as = byPnr.get(n.pnr);
      if (!as) continue;
      const p = paxById.get(as[0].pax_id)!;
      notifications.push({ pnr: n.pnr, names: as.map((a) => a.name).join(', '), channel: p.channel ?? 'SMS', language: LANG_LINE[p.language ?? ''] ?? 'English', text: n.text, personalized: true });
    }
    onStep({ id: 'notify', label: `${notifications.length} personalised notifications drafted`, status: 'done', detail: `${[...new Set(notifications.map((x) => x.language))].join(', ')} · ${cfg.model} · ${byPnr.size - notifications.length} standard messages` });
  } catch (e) {
    summary = `${m.same_day} of ${m.pax} passengers re-accommodated today vs ${ap.same_day} under AutoProtect; ${m.misconnects} misconnects vs ${ap.misconnects}.`;
    onStep({ id: 'notify', label: 'Notification drafting failed — standard messages used', status: 'error', detail: (e as Error).message.slice(0, 160) });
  }
  const done = new Set(notifications.map((n) => n.pnr));
  for (const [pnr, as] of byPnr) {
    if (done.has(pnr)) continue;
    const p = paxById.get(as[0].pax_id)!;
    notifications.push(templateNotification(f, as[0], as.map((a) => a.name.split(' ')[0]).join(' & '), 'English', p.channel ?? 'SMS', eu));
  }

  const plan: ReaccomPlan = {
    plan_id: `PLAN-${f.id}-${Date.now().toString(36).toUpperCase()}`, flight_id: f.id, flight_number: f.flightNumber,
    generated_at: new Date().toISOString(), drafted_by: ctx.draftedBy, assignments: al.assignments, metrics: al.metrics,
    autoprotect: al.autoprotect, guardrails: al.guardrails, requires_approval: al.requiresApproval,
    approval_reasons: al.approvalReasons, released_seats: al.released, policy_guidance: guidance, summary, notifications, model: cfg.model,
  };
  return { plan, allocation: al };
}
