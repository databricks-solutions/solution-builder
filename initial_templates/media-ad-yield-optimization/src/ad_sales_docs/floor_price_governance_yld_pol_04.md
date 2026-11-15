# Floor Price & Programmatic Deal Governance — YLD-POL-04

Owner: Yield & Pricing (Maya Chen, Director of Yield & Pricing). Approver of exceptions: SVP Ad Revenue.

## §1 Purpose
Protect the value of premium inventory in programmatic channels: every ad unit is priced through its floor group, and PMP deals only buy the groups they were negotiated for.

## §2 Who may change floors
2.1 The Director of Yield & Pricing may, without further approval: (a) restore an ad unit to the floor group the rate card assigns it (RC-2026-27 §2); (b) move a group floor by up to ±25%.
2.2 Any other change (floor moves above ±25%, moving premium inventory into a lower group, new PMP deals below the group floor) requires written approval by the SVP Ad Revenue.
2.3 Every change is executed by Ad Operations under an ADOPS ticket and logged in the floor-price rules history (rule id FR-nnn) with who changed it and why.

## §3 PMP deals and priority
3.1 PMP deals have priority over the open auction for the groups they can buy.
3.2 PMP-RON-STREAM is a fixed-price ($10.50) run-of-network remnant deal open to all DSPs. It buys ONLY the RON-DEFAULT group. It was designed for remnant long-tail inventory, not for premium content.
3.3 A premium ad unit that lands in RON-DEFAULT is therefore sold first to PMP-RON-STREAM at $10.50, ahead of open-auction bids — even when those bids are three times higher.

## §4 Setting a floor
4.1 The floor is set from the open-auction bid landscape of the last 28 days: never above the median (p50) bid, never below the tier minimum of RC-2026-27 §3.1.
4.2 Expected fill at a floor near the median bid is estimated as 1 - 0.5^(bids per request), capped at 90%.

## §5 Monitoring
5.1 Yield & Pricing reviews weekly: programmatic eCPM vs rate card per product, PMP share, and any product whose floor group differs from its rate-card group.
5.2 Revenue left on the table by a mis-grouped product = PMP impressions x (open-auction clearing x expected fill - PMP price).

## §6 Ad-server migrations
6.1 During an ad-server migration, ad units whose path cannot be mapped automatically default to RON-DEFAULT.
6.2 Ad Operations must publish the list of defaulted ad units, and Yield & Pricing must review it and restore the correct groups within 5 business days of go-live (post-migration review). The July 2026 migration was executed under ADOPS-5540.
