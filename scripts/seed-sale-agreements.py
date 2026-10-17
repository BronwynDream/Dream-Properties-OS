#!/usr/bin/env python3
"""
Generate supabase/migrations/0080_seed_sale_sectional_land.sql from
Bronwyn's 2026 masters for the SECTIONAL TITLE and FREEHOLD LAND agreements
of sale (docs/templates/2026-final/).

Unlike scripts/seed-sale-house.py (hand-laid), this reads each master
directly: it finds the numbered clauses, replaces each fill-in blank with
its field IN ORDER (the per-clause token lists below), and splits the
master's "OR / DELETE / IF APPLICABLE" alternatives into variants. Any
blank left unaccounted for, or a token list that doesn't match the number
of blanks, stops the script — so the output is verbatim or it doesn't exist.

Each template gets its own clause keys (sale_st.* / sale_land.*): the
masters differ in small wording and in clause numbers, and the numbers live
inside the bodies.

Run:  python3 scripts/seed-sale-agreements.py > supabase/migrations/0080_seed_sale_sectional_land.sql
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MASTERS = ROOT / "docs/templates/2026-final"

BLANK = re.compile(r"_{2,}")


def fail(msg):
    sys.stderr.write("seed-sale-agreements: " + msg + "\n")
    sys.exit(1)


# --------------------------------------------------------------------------
# Reading a master
# --------------------------------------------------------------------------
def paragraphs(path):
    text = path.read_text().split("\n", 6)[6]  # drop the provenance header
    out = []
    for raw in re.split(r"\n\s*\n", text):
        p = raw.strip()
        if not p:
            continue
        # "20.1If any…" / "12.3 \tAny…" / "15.1 ELECTRICAL" → "n.n<TAB>text"
        p = re.sub(r"^(\d+(?:\.\d+)+)\s*(?=\S)", lambda m: m.group(1) + "\t", p)
        # label rows: "Full Names: \t\t\t___" → "Full Names:\t___"
        # (a tab or a wide gap after the colon — "PROPERTIES WITHIN AN ESTATE:
        # It is recorded…" is prose, not a row)
        p = re.sub(r"^([A-Za-z][^\t\n]{0,38}:)(?:[ \t]*\t[ \t]*| {2,})", lambda m: m.group(1) + "\t", p)
        p = re.sub(r"[ \t]+$", "", p, flags=re.M)
        out.append(p)
    return out


# "15.<tab>CERTIFICATES OF COMPLIANCE (DELETE or state whichever is NOT
# APPLICABLE)" — capitals, optionally followed by a bracketed instruction in
# any case.
HEADING = re.compile(r"^(\d+)\.?\s+([A-Z][A-Z0-9 &’'/\-,]*[A-Z](?:\s*\([^)]*\))?)\s*$")


def split_master(paras):
    """→ (preamble paras, [(num, heading, body paras)], tail paras)"""
    pre, clauses, tail = [], [], []
    cur = None
    for p in paras:
        if p.startswith("THUS DONE AND SIGNED"):
            cur = "TAIL"
        if cur == "TAIL":
            tail.append(p)
            continue
        m = HEADING.match(p) if "\t" not in p.split("\n")[0][:4] else None
        m = m or HEADING.match(p.replace("\t", " "))
        if m and not re.match(r"^\d+\.\d", p):
            cur = [m.group(1), m.group(2).strip(), []]
            clauses.append(cur)
            continue
        (pre if cur is None else cur[2]).append(p)
    return pre, [(n, h, b) for n, h, b in clauses], tail


# --------------------------------------------------------------------------
# Filling blanks
# --------------------------------------------------------------------------
def fill(text, tokens, where):
    """Replace successive blanks with {{token}} (None keeps the blank)."""
    it = iter(tokens)
    used = [0]

    def rep(m):
        try:
            t = next(it)
        except StopIteration:
            fail(f"{where}: more blanks than tokens in: {text[:120]!r}")
        used[0] += 1
        if t is None:
            return m.group(0)
        # "known as________" in the master → "known as {{x}}"
        before = text[m.start() - 1] if m.start() > 0 else " "
        return (" " if before.isalpha() else "") + "{{" + t + "}}"

    out = BLANK.sub(rep, text)
    rest = list(it)
    if rest:
        fail(f"{where}: {len(rest)} token(s) unused {rest} in: {text[:120]!r}")
    return out


def no_blanks(text, where):
    if BLANK.search(text):
        fail(f"{where}: unexpected blank in: {text[:160]!r}")
    return text


# --------------------------------------------------------------------------
# Library model
# --------------------------------------------------------------------------
class Lib:
    def __init__(self, template, prefix):
        self.t = template
        self.prefix = prefix
        self.clauses, self.slots, self.variants = [], [], {}
        self.ord = 0

    def add(self, key, label, cat, desc, vs, heading=None, numbering=None):
        key = f"{self.prefix}.{key}"
        self.ord += 10
        self.clauses.append((key, label, cat, desc))
        self.slots.append((self.ord, key, heading, numbering))
        self.variants[key] = vs
        return key


def V(label, body, applies_when=None, default=False, ours=False):
    return dict(label=label, body=body.strip("\n"), applies_when=applies_when, default=default, ours=ours)


SIDE_TOKENS = {
    "Full Names:": "names", "Duly Represented by:": "represented_by",
    "ID/Passport/Registration No:": "ids", "Postal Address:": "postal",
    "Domicilia Citandi:": "domicilium", "Marital Status:": "marital",
    "Date & Place of Marriage:": "marriage", "E-mail:": "email",
    "Contact Numbers:": "phone",
}

CATEGORY = {
    "PURCHASE PRICE": "financial", "COSTS": "financial", "RATES AND CHARGES": "financial", "BOND": "suspensive",
    "COMMISSION": "financial", "CERTIFICATES OF COMPLIANCE": "compliance", "INSPECTION": "warranty",
    "CAPACITY OF PARTIES": "juristic", "BUILDING PLANS": "warranty", "RECORDAL": "recordal",
    "CONTINUED MARKETING": "suspensive", "SUSPENSIVE CONDITIONS": "suspensive", "NON-RESIDENT SELLERS": "financial",
    "CONTROLLING BODY & LEVIES": "general",
}


def slug(h):
    h = re.sub(r"\(.*?\)", "", h)
    return re.sub(r"[^a-z0-9]+", "_", h.lower()).strip("_")


def build(path, template, prefix, title_kind, spec):
    lib = Lib(template, prefix)
    pre, clauses, tail = split_master(paragraphs(path))

    # ---- Preamble: parties / contract info / bond line / close ----------
    i_ci = next(i for i, p in enumerate(pre) if p.startswith("CONTRACT INFORMATION"))
    i_bond = next(i for i, p in enumerate(pre) if p.startswith("BOND:"))
    # The two name blanks: seller first, purchaser second.
    k = 0
    filled = []
    for p in pre[:i_ci]:
        if BLANK.fullmatch(p.strip()):
            filled.append("{{" + ("seller_names" if k == 0 else "purchaser_names") + "}}")
            k += 1
        else:
            filled.append(no_blanks(p, "parties"))
    lib.add("parties", f"Agreement of sale ({title_kind}) — parties", "general",
            "Title and the two parties.", [V("Master", "\n\n".join(filled), default=True)])

    side = None
    ci = []
    for p in pre[i_ci:i_bond]:
        if p.startswith("SELLER DETAILS"):
            side = "seller"
        elif p.startswith("PURCHASER DETAILS"):
            side = "purchaser"
        lab = p.split("\t")[0] if "\t" in p else None
        if lab in SIDE_TOKENS and side:
            p = fill(p, [f"{side}_{SIDE_TOKENS[lab]}"], "contract info")
        elif lab == "PROPERTY DETAILS:":
            p = fill(p, spec["property_details"], "property details")
        elif lab == "PURCHASE PRICE:":
            p = fill(p, ["purchase_price", "purchase_price_words"], "price row")
        elif lab == "DEPOSIT:":
            p = fill(p, ["deposit", "deposit_words"], "deposit row")
        ci.append(no_blanks(p, "contract info"))
    lib.add("contract_info", "Contract information — parties, property, price, deposit", "general",
            "The CONTRACT INFORMATION block.", [V("Master", "\n\n".join(ci), default=True)])

    lib.add("contract_info_bond", "Contract information — bond line", "financial",
            "BOND line. A bond amount prints it; none means a cash sale.", [
        V("Bond", fill(pre[i_bond], ["bond_amount", "bond_amount_words"], "bond row"), applies_when={"bond_amount_set": True}),
        V("Cash sale", "BOND:\tNot applicable", default=True, ours=True),
    ])

    close = []
    for p in pre[i_bond + 1:]:
        lab = p.split("\t")[0] if "\t" in p else None
        if lab == "CONVEYANCER:":
            p = fill(p, ["conveyancer_name"], "conveyancer")
        elif lab == "TEL & EMAIL:":
            p = fill(p, ["conveyancer_contact"], "tel")
        elif lab == "SELLING AGENTS:":
            p = fill(p, ["agent_name"], "agents")
        close.append(no_blanks(p, "contract close"))
    lib.add("contract_info_close", "Contract information — conveyancer, selling agents, sale", "signature",
            "Conveyancer, selling agents with the FFC warrant, operative sentence.", [V("Master", "\n\n".join(close), default=True)])

    # ---- Numbered clauses ------------------------------------------------
    for num, heading, body in clauses:
        base = re.sub(r"\s*\(.*?\)\s*$", "", heading).strip()
        key = slug(base)[:40].rstrip("_")
        cat = CATEGORY.get(base, "general")
        where = f"{template} {num} {base}"
        handler = spec.get("special", {}).get(base)
        if handler:
            handler(lib, key, num, heading, body, where)
            continue
        toks = spec.get("tokens", {}).get(base, [])
        text = "\n\n".join(body)
        text = fill(text, toks, where) if toks else no_blanks(text, where)
        lib.add(key, f"{num} {base[0] + base[1:].lower()}", cat, f"Clause {num} of the master.", [V("Master", text, default=True)],
                heading=heading, numbering=num)

    # ---- Tail: signatures + commission acceptance --------------------------
    i_acc = next(i for i, p in enumerate(tail) if p.startswith("COMMISSION CLAUSE ACCEPTANCE"))
    sig = []
    for p in tail[:i_acc]:
        p = re.sub(r"^([12])\s*$", r"\1 ______________________________", p)
        sig.append(p)
    lib.add("signatures", "Signatures — seller and purchaser, witnessed", "signature",
            "Completed at signing.", [V("Master", "\n\n".join(sig), default=True)])
    acc = []
    for p in tail[i_acc:]:
        if p.startswith("DREAM KNYSNA") and BLANK.search(p):
            p = fill(p, ["principal_name"], "acceptance")
        acc.append(p)
    lib.add("commission_acceptance", "Commission clause acceptance", "signature",
            "Dream accepts the benefit of the commission clause.", [V("Master", "\n\n".join(acc), default=True)])
    return lib


# --------------------------------------------------------------------------
# Special clauses (the alternatives)
# --------------------------------------------------------------------------
def occupation_with_lease(lib, key, num, heading, body, where):
    """5.1–5.4 [+5.6] verbatim; 5.5 (existing lease) becomes a choice."""
    i_lease = next(i for i, p in enumerate(body) if "subject to the existing lease" in p)
    main = fill("\n\n".join(body[:i_lease]), ["occupation_date", "occupational_rent", "occupational_rent_words"], where)
    lib.add(key, f"{num}.1–{num}.4 Possession and occupation", "general", "Occupation date, occupational rent, no alterations, vacate on cancellation.",
            [V("Master", main, default=True)], heading=heading, numbering=num)
    lease_num = body[i_lease].split("\t")[0]
    lib.add(key + "_lease", f"{lease_num} Existing lease", "general", "Only when the property is let.", [
        V("Not let", f"{lease_num}\tNot applicable.", default=True, ours=True),
        V("Property is let", no_blanks(body[i_lease], where)),
    ])
    rest = body[i_lease + 1:]
    if rest:
        lib.add(key + "_vacate", f"{rest[0].split(chr(9))[0]} Vacate on cancellation", "general", "No tenancy created by early occupation.",
                [V("Master", no_blanks("\n\n".join(rest), where), default=True)])


def bond(lib, key, num, heading, body, where):
    lib.add(key, f"{num} Bond", "suspensive", "Bond approval within 30 days. Cash sale: not applicable.", [
        V("Bond", fill("\n\n".join(body), ["bond_amount", "bond_amount_words"], where), applies_when={"bond_amount_set": True}),
        V("Cash sale", "Not applicable.", default=True, ours=True),
    ], heading=heading, numbering=num)


def expiry(lib, key, num, heading, body, where):
    text = "\n\n".join(body)
    text, n = re.subn(r"_{2,}\s*day of\s*_{2,}", "{{offer_expires}}", text)
    if n != 1:
        fail(f"{where}: expected one '___ day of ___' blank, found {n}")
    lib.add(key, f"{num} Expiry of the offer", "general", "First signature is an irrevocable offer until the time and date set.",
            [V("Master", no_blanks(text, where), default=True)], heading=heading, numbering=num)


def certificates(lib, key, num, heading, body, where):
    lib.add(key, f"{num} Certificates of compliance — heading", "compliance", "Heading; each certificate below is a choice.",
            [V("Master", "", default=True)], heading=re.sub(r"\s*\(.*\)$", "", heading), numbering=num)
    i = 0
    while i < len(body):
        m = re.match(r"^(\d+\.\d+)\t(.+)$", body[i])
        if not m:
            fail(f"{where}: expected 'n.n TITLE', got {body[i][:60]!r}")
        cnum, ctitle = m.group(1), m.group(2).strip()
        text = no_blanks(body[i + 1], where)
        lib.add(f"coc_{slug(ctitle)[:24]}", f"{cnum} {ctitle.title()}", "compliance", f"{ctitle}; mark not applicable when it doesn't apply.", [
            V("Applies", f"{cnum}\t{ctitle}\n\n{text}", default=True),
            V("Not applicable", f"{cnum}\t{ctitle} – Not applicable.", ours=True),
        ])
        i += 2


def building_plans(lib, key, num, heading, body, where):
    i_or = body.index("OR")
    lib.add(key, f"{num} Building plans", "warranty", "Plans available, or not available with R100 000 retained.", [
        V("Plans available", no_blanks("\n\n".join(body[:i_or]), where), default=True),
        V("Plans not available — R100 000 retained", no_blanks("\n\n".join(body[i_or + 1:]), where)),
    ], heading=heading, numbering=num)


def recordal_estate_only(lib, key, num, heading, body, where):
    text = fill("\n\n".join(body), ["estate_name"], where)
    lib.add(key, f"{num} Recordal — properties within an estate", "recordal", "Pre-picked when the property is in an estate.", [
        V("Estate", text, applies_when={"estate_name_set": True}),
        V("Not applicable", "Not applicable.", default=True, ours=True),
    ], heading=heading, numbering=num)


def suspensive(lib, key, num, heading, body, where):
    intro = no_blanks(body[0], where)
    alts, cur = [], []
    for p in body[1:]:
        if p == "OR":
            alts.append(cur); cur = []
        else:
            cur.append(p)
    alts.append(cur)
    if len(alts) != 3:
        fail(f"{where}: expected 3 alternatives, found {len(alts)}")
    labels = ["Sale of the purchaser's property", "Subject to viewing", "Master's consent (deceased estate)"]
    toks = [["purchaser_property", "purchaser_property_by"], ["viewing_by"], []]
    vs = [V("None", "Not applicable.", default=True, ours=True)]
    for lab, alt, tk in zip(labels, alts, toks):
        text = "\n\n".join(alt)
        text = fill(text, tk, where) if tk else no_blanks(text, where)
        vs.append(V(lab, intro + "\n\n" + text))
    lib.add(key, f"{num} Suspensive conditions", "suspensive", "None, or one of: sale of purchaser's property, viewing, Master's consent.",
            vs, heading=heading, numbering=num)


def controlling_body(lib, key, num, heading, body, where):
    """19.1–19.4 verbatim; '(Delete as applicable)' 19.5 becomes a choice."""
    i_del = body.index("(Delete as applicable)")
    lib.add(key, f"{num} Controlling body and levies", "general", "Sectional Titles Act, body-corporate rules, levies from transfer.",
            [V("Master", no_blanks("\n\n".join(body[:i_del]), where), default=True)], heading=heading, numbering=num)
    ext = body[i_del + 1]
    enum = ext.split("\t")[0]
    lib.add(key + "_extension", f"{enum} Real right to extend the scheme", "general", "Delete as applicable in the master.", [
        V("As in the master", no_blanks(ext, where), default=True),
        V("Not applicable", f"{enum}\tNot applicable.", ours=True),
    ])


# --------------------------------------------------------------------------
# The two templates
# --------------------------------------------------------------------------
COMMON_TOKENS = {
    "TRANSFER & RISK": ["transfer_date"],
    "COMMISSION": ["commission_pct"],
}

SECTIONAL = dict(
    property_details=["section_no", "scheme_name", "property_known_as"],
    tokens={
        **COMMON_TOKENS,
        "THE PROPERTY": ["section_no", "scheme_name", "door_no", "building_name", "section_plan_no", "scheme_name",
                         "erf_number", "extent_sqm", "parking_bay", "title_deed_no"],
        "PURCHASE PRICE": ["purchase_price", "purchase_price_words", "deposit", "deposit_words", "deposit_by", "guarantee_date"],
    },
    special={
        "POSSESSION & OCCUPATION": occupation_with_lease,
        "BOND": bond,
        "EXPIRY": expiry,
        "CERTIFICATES OF COMPLIANCE": certificates,
        "BUILDING PLANS": building_plans,
        "SUSPENSIVE CONDITIONS": suspensive,
        "CONTROLLING BODY & LEVIES": controlling_body,
    },
)

LAND = dict(
    property_details=["erf_number", "property_known_as"],
    tokens={
        **COMMON_TOKENS,
        "THE PROPERTY": ["erf_number", "property_known_as", "extent_sqm", "title_deed_no"],
        "PURCHASE PRICE": ["purchase_price", "purchase_price_words", "deposit", "deposit_words", "guarantee_date"],
    },
    special={
        "BOND": bond,
        "EXPIRY": expiry,
        "RECORDAL": recordal_estate_only,
        "SUSPENSIVE CONDITIONS": suspensive,
    },
)

libs = [
    build(MASTERS / "dream-properties-sectional-title-house-agreement-template-2026.md",
          "agreement_sale_sectional", "sale_st", "sectional title", SECTIONAL),
    build(MASTERS / "dream-properties-agreement-of-sale-for-land-template-2026.md",
          "agreement_sale_land", "sale_land", "freehold land", LAND),
]

DESCRIPTIONS = {
    "agreement_sale_sectional": "Bronwyn's 2026 master for a sectional-title unit. Section, scheme, sectional plan, parking and the controlling-body clause; otherwise as the house agreement. Offer open until 16h00 on the expiry date.",
    "agreement_sale_land": "Bronwyn's 2026 master for vacant / freehold land. No occupation, fixtures or certificates; estate recordal pre-picked. Offer open until 16h00 on the expiry date.",
}


# --------------------------------------------------------------------------
# Emit SQL
# --------------------------------------------------------------------------
def q(s):
    return "null" if s is None else "'" + s.replace("'", "''") + "'"


def dollar(s):
    assert "$body$" not in s
    return "$body$" + s + "$body$"


out = ["""-- ============================================================================
-- Dream Knysna OS — 0080 Agreements of Sale — Sectional Title and Freehold Land
-- ----------------------------------------------------------------------------
-- GENERATED by scripts/seed-sale-agreements.py — edit the script, not this file.
--
-- Bronwyn's 2026 masters, read directly from docs/templates/2026-final/.
-- Blanks are filled IN ORDER with named fields; a blank the script doesn't
-- account for stops generation, so this is verbatim or nothing. Same choices
-- as the house agreement (0078): bond vs cash from the deal, existing lease,
-- certificates (sectional), building plans (sectional), estate recordal
-- (land, pre-picked), suspensive condition, and for sectional the master's
-- "(Delete as applicable)" real-right-to-extend paragraph.
--
-- Wording that is ours, not Bronwyn's — the "Not applicable" lines only:
"""]
for lib in libs:
    for k, vs in lib.variants.items():
        for x in vs:
            if x["ours"]:
                out.append(f"--   {k} [{x['label']}]: {x['body'].splitlines()[0]}\n")
out.append("-- ============================================================================\n\n")

for lib in libs:
    out.append(f"-- ---------------------------------------------------------------- {lib.t}\n")
    out.append("insert into clause (key, label, category, description) values\n")
    out.append(",\n".join(f"  ({q(k)}, {q(l)}, {q(c)}, {q(d)})" for k, l, c, d in lib.clauses))
    out.append("\non conflict (key) do nothing;\n\n")
    for key, vs in lib.variants.items():
        for x in vs:
            aw = "null" if x["applies_when"] is None else q(json.dumps(x["applies_when"])) + "::jsonb"
            out.append(
                "insert into clause_variant (clause_id, label, body, applies_when, is_default, source, approved)\n"
                f"select (select id from clause where key = {q(key)}), {q(x['label'])}, {dollar(x['body'])}, {aw}, "
                f"{str(x['default']).lower()}, {q('manual' if x['ours'] else 'master_template')}, true\n"
                "on conflict (clause_id, label) do nothing;\n\n")
    out.append(f"""update doc_template set active = true,
       doc_type_id = coalesce(doc_type_id, (select id from document_type where code = {q('land_freehold_agreement' if lib.t.endswith('land') else 'agreement_of_sale')})),
       description = {q(DESCRIPTIONS[lib.t])}
 where code = {q(lib.t)};

insert into doc_template_slot (template_id, clause_id, ordinal, heading, numbering, condition, is_optional, default_on) values
""")
    out.append(",\n".join(
        f"  ((select id from doc_template where code = {q(lib.t)}), (select id from clause where key = {q(k)}), {o}, {q(h)}, {q(n)}, null, false, true)"
        for o, k, h, n in lib.slots))
    out.append("\non conflict (template_id, ordinal) do nothing;\n\n")

print("".join(out), end="")
for lib in libs:
    sys.stderr.write(f"{lib.t}: {len(lib.clauses)} clauses, {sum(len(v) for v in lib.variants.values())} wordings\n")
