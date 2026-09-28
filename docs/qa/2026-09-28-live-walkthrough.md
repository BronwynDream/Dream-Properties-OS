# Live walkthrough: dreamproperties.app, 2026-09-28

Read-only pass by Claude in the in-app browser (Simon's admin login, ~800px wide pane).
Nothing was created, edited, merged, or sent. All 16 nav sections plus two property
records visited. **No console errors and no failed pages anywhere.** The app is stable;
the problems are data integrity and screens that disagree with each other.

## P1: wrong or contradictory information

1. **Duplicate finder misses an exact title-deed match.** `6 Bowden Park Road, Knysna,
   Western Cape` and `6 Bowden Park, Leisure Isle, Knysna` (0af3d8a4) both carry deed
   T51294/2008. /dupes (property, threshold 0.5) reports "No candidate duplicates", yet the
   page says exact deed matches score 1.00. The deed-match leg of the scan is not running.
2. **6 Bowden Park says three different things.**
   - Dashboard "Live listings": R24.5m, **exclusive**.
   - Property record: status **REGISTERED** (08 Jul 2026), and "No listing on this property yet".
   - Documents: "Signed **Joint** Mandate 6 Bowden Park".
   Either the dashboard reads a stale listing row, or the property page's listing lookup is
   broken. Same pattern on 7 The Grove: /dupes shows Listings = 1, property page says no listing.
3. **Dashboard vs Pipeline disagree.** Dashboard: 3 deals in flight, 6 live listings with prices.
   Pipeline: 15 deals in flight, 1 active listing, R0 in Active column (prices not flowing to pipeline).
4. **Non-properties imported as properties (and given deals).** From folder migration:
   "Dream Properties - Master Templates", "26 Lower Duthie - Rates account",
   "26 Lower Duthie Pics", "26 Lower Duthie Seller Details",
   "Pezula Private Estate information and Architectural Design Manual and Knysna General",
   "PLOT19 Eagles Way - proposed plans", "Plot: 21 Emu Crescent, The Heads continued",
   probably "Hudson Heights". Several sit in Pipeline › Preparing as deals. Folder names were
   taken as addresses; see plan 011 (intake commit-path integrity).
5. **Duplicate parties on one deal.** 7 The Grove purchasers: "Phil Davis", "Kate Davis" AND
   "PHILLIP ALFRED TRAYHORN DAVIS and KATHERINE DAVIS" (one party holding two people).
   Sellers: "Mark Tracy Sofianos" appears both as partner and as a separate individual.
   Same combined-name pattern on 159 Sharples Close (Maingard). /dupes Parties finds nothing.
   Inflates FICA gap counts on /compliance (7 The Grove shows 5 gaps for really 2 buyers + 1 seller entity).
6. **Misfiled documents.** On 6 Bowden Park the full municipal roll "KNYSNA-FULL-GV 2023-2028.pdf"
   is filed under **FICA** and flagged PII; "Quotation - Mr Smith.pdf" and guest-house
   accounts sit under OTHER. The document classifier needs a look.

## P2: noise and stale state

7. **Transfers past date still "in conveyancing".** 3 Oupad 181 d, 7 The Grove 45 d, 159 Sharples 10 d.
   Likely registered in reality; the dashboard is right to shout, but 181 days suggests no one updates it.
   Consider a "confirm registration" nudge or a Deeds Office check.
8. **CoC checklist always asks for Gas and Electric Fence.** Every property shows 4 CoCs outstanding,
   including on REGISTERED 6 Bowden Park, plus "PPRA disclosure not started… sale is voidable" on
   a completed transfer. Gas/fence should be "N/A" able; compliance banners should stop after registration.
9. **Muni valuation not linked** even when the SG code is known (both property records viewed).
   Auto-match on SG code after each muni refresh.
10. **Estates vault: every estate shows 0 properties**, although many properties are in Leisure Isle,
    The Heads, Pezula. Estate ↔ property link is not populated. Also near-duplicate estates
    (Pezula ×2, Simola ×2, Thesen Islands + TIHOA): intended (estate vs HOA)? If so, label them clearly.
11. **Team page: "No team members yet"** while Simon is signed in as admin; Bronwyn is not listed.
    /compliance then reports "every active agent has a valid FFC", which is true only because there are zero agents.
12. **"Sole" still visible**: Mandates type filter and map legend ("Sole / Open / None"). Plan 009 fixes.
13. **Erf Lookup renders the entire muni roll into a dropdown** on load (thousands of options). Slow on phones; use type-ahead.
14. Title deed "43788/2018" on 4 Waterfront Drive is missing its "T" prefix; validate the deed-number format.
15. Map: "21 / 25 pinned · 4 missing coords". Fine, just a reminder.

## Worked well
Login, dashboard "Attention today", pipeline stage cards, compliance page (clear and actionable),
property record layout, viewings week view, settings. Zero JS errors across the session.

## Suggested routing
- #1, #5 → dupes scan fix (new small plan).
- #2, #3 → one "single source of truth for listing status" plan: dashboard, pipeline and property page must read the same query.
- #4, #6 → extend plan 011 (intake integrity) + a one-off cleanup of the listed junk records (Simon to approve each).
- #8, #10, #11 → small UX fixes.
- #12 → plan 009.
