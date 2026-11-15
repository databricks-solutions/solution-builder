# Aeralis Airways — IROPS Re-accommodation Policy (Operations Control & IROPS Desk)

Document OPS-IROPS-01 · Version 7 · Effective 1 December 2025 · Owner: IROPS Duty Manager, Operations Control Center (ORD)

Aeralis Airways is a fictional US network carrier. Lumen Air is its interline and codeshare partner.

## 1. Scope
This policy applies whenever Aeralis cancels a flight or a delay causes a passenger to miss a connection ("irregular
operations", IROPS). It applies to all causes. The cause matters for customer-care entitlements (see CARE-02) but not
for the order in which passengers are re-accommodated.

## 2. The re-accommodation priority order
Seats are scarce during IROPS. The IROPS desk re-accommodates passengers in this order (section 2.1 is highest):

2.1 **Passengers who must never be left overnight or who need assistance**: unaccompanied minors (UMNR), passengers
    needing special assistance (SSR codes WCHR, WCHS, WCHC, BLND, DEAF, MEDA) and passengers travelling with a lap infant (INFT).
2.2 **Onward long-haul connections at risk**: a passenger whose rebooked arrival would miss an onward long-haul connection
    (minimum connecting time 75 minutes for an onward international flight). A missed long-haul connection costs on
    average USD 570 per passenger to reprotect (reissue plus a hotel at the connecting city) and usually costs the trip a full day.
2.3 **Urgent life events** flagged by the desk (bereavement travel, medical treatment, birth, wedding) — typically identified
    from the passenger's message, which the desk's AI classifies for urgency.
2.4 **Loyalty tier and cabin**: Diamond, then Platinum, then Gold; First and Business before Economy.
2.5 **Passengers away from home** (visitors returning home, passengers connecting at the hub).
2.6 **Local residents** of the departure city. They can go home: offer the next-day option and remind them of the full refund
    right if they no longer want to travel.

Within one level, the desk re-accommodates first the passengers whose experience is hurt most by an overnight (the
detractor-risk model's predicted increase in detractor probability between a same-day and a next-day option).

## 3. Rules that apply to every plan
3.1 **Keep parties together.** All passengers on one booking (PNR) travel on the same option. Never split a family.
3.2 **Option order.** Own-metal same-day flights first, then Lumen Air partner seats the same day, then a nearby-airport
    alternate, then the next-day own-metal flights, then day+2.
3.3 **Partner seats (Lumen Air).** Partner seats protected by Operations Control may be used at the agreed interline rate,
    up to USD 350 per seat for a domestic flight and USD 700 per seat for a long-haul flight (guardrail G1 / G1L).
3.4 **Nearby airports** (for example OAK or SJC for SFO, EWR for LGA, IAD for DCA, BUR for LAX, FLL for MIA, DAL for DFW)
    only for passengers whose trip ends in that metro area — never for onward connections, unaccompanied minors or WCHC
    passengers. Ground transport to the original destination airport is not provided.
3.5 **Unaccompanied minors.** Re-accommodate the same day on own metal, or on Lumen Air only if the child is 8 or older and
    the Lumen Air flight is a nonstop. Otherwise the child is returned to the guardian who dropped them off. A UMNR is
    never left overnight in a hotel or terminal (see SSR-04).
3.6 **Hotel rooms** come from the contracted distressed-passenger blocks and are finite. When the block is exhausted, further
    entitled passengers receive a hotel voucher at the distressed-passenger rate.

## 4. Approvals
4.1 A plan whose partner spend exceeds **USD 6,000 for one cancelled flight** (guardrail G2) must be approved by the IROPS
    Duty Manager before seats are ticketed.
4.2 An exception to section 3.5 (a UMNR not re-accommodated the same day) or a special-assistance passenger left overnight
    must be approved by the Duty Manager and logged.
4.3 EU261 / UK261 flights (flights departing an EU or UK airport): the passenger is entitled to re-routing at the earliest
    opportunity, including on other carriers. Partner spend on these flights is exempt from the G1/G2 caps (it is still
    logged and shown to the Duty Manager).
4.4 The Duty Manager can approve, or send the plan back to the desk with a note.

## 5. Passenger notifications
5.1 Every re-accommodated passenger is notified within 30 minutes of the plan being committed, in their preferred language
    and channel (SMS, app push or email).
5.2 The notification states: the new flight and arrival time, why the flight was cancelled, the meal voucher and hotel
    entitlement (if any), that the passenger may decline the new flight and receive a full refund to the original form of
    payment, and the self-service link aeralis.example/rebook.
5.3 Unaccompanied minors: the desk calls the guardian who dropped off the child AND the receiving guardian before the
    change is final; the written notification goes to both.

## 6. What AutoProtect does (and does not do)
AutoProtect is the legacy automatic re-accommodation engine. It runs a few minutes after a cancellation and holds seats on
own-metal flights only, in order of booking date (first booked, first protected). It does not read SSR codes, onward
connections, loyalty tier or messages, it does not use partner seats or nearby airports, and it may split a booking across
flights. AutoProtect holds are not ticketed — the IROPS desk may release and re-plan them.
