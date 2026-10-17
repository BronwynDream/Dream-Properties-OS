#!/usr/bin/env python3
"""
Bring the clause library in line with Bronwyn's Word masters, word for word and
emphasis for emphasis (plan 019, 2026-10-17). Writes one migration.

    python3 scripts/mark-library-formatting.py <masters-dir> <library.json> <out.sql>

<masters-dir>  _contract_templates/2026-final/ (the .docx originals)
<library.json> the live library: [{key, label, source, body, templates}], from
               select json_agg(...) over clause_variant ⋈ clause (see the 0082 header)

What it does, per master_template wording:

1. TEXT FIXES — words or numbers the first seeding missed: titles and
   paragraph numbers that Word generates automatically (never in the
   extracted text), and two hand-laid lines that differ from the master.
   Listed explicitly below; each must apply exactly once.

2. EMPHASIS — the masters bold (and occasionally italicise) words inside
   sentences: "Erf ___ KNYSNA, WESTERN CAPE PROVINCE", "ZAR ___ RAND)",
   "a deposit of R___ … payable within 7 (Seven) working days of acceptance
   hereof". The library held plain text, so the PDF lost them. Each library
   paragraph is aligned character by character with its master paragraph
   and the master's bold/italic runs are written in as **bold** and *italic*
   (lib/documents/rich.ts renders them). A {{token}} takes the emphasis of
   the blank it replaced.

   Never marked: the clause number and tab at the start of a paragraph,
   paragraphs the PDF lays out itself (agreement cover, contract
   information, signature blocks, PPRA), and ALL-CAPS sub-headings the PDF
   already sets bold.

Every update is guarded: stripping the markup must give back the wording
exactly (after the text fixes), or the script stops.
"""
import difflib
import json
import re
import sys
from pathlib import Path

import docx  # python-docx

MASTERS = {
    "agreement_sale_house": "Dream Properties Agreement of Sale Freehold House Template 2026.docx",
    "agreement_sale_sectional": "Dream Properties Sectional Title House Agreement Template 2026.docx",
    "agreement_sale_land": "Dream Properties Agreement of Sale for LAND Template 2026.docx",
    "mandate_exclusive": "Dream Properties Exclusive Mandate Template 2026.docx",
    "mandate_joint": "Dream Properties Joint Mandate Template 2026.docx",
    "mandate_open": "Dream Properties Open Mandate Template 2026.docx",
    "movables_agreement": "Dream Properties Movables Agreement Template 2026.docx",
    "addendum_sale": "Dream Properties Addendum Template 2026.docx",
    "addendum_movables": "Dream Properties Addendum to Movables Agreement Template 2026.docx",
    "condition_report_appendix": "Dream Properties Appendix to Property Condition Report where Seller is unable to Complete it 2026.docx",
}

# (clause key, variant label, old, new) — each old must occur exactly once.
TEXT_FIXES = [
    # Word numbers these paragraphs automatically, so the extraction lost them.
    ("movables.preamble", "Master", "The seller is the owner", "2.1\tThe seller is the owner"),
    ("movables.preamble", "Master", "The seller has sold", "2.2\tThe seller has sold"),
    ("movables.preamble", "Master", "This agreement constitutes", "2.3\tThis agreement constitutes"),
    ("movables.sale_and_risk", "Master", "\n\nThis agreement is inextricably", "\n\n3.2\tThis agreement is inextricably"),
    ("condition_report.seller_unable", "Master", "\n\nIt is hereby recorded", "\n\n1.\tIt is hereby recorded"),
    ("condition_report.seller_unable", "Master", "\n\nNotwithstanding anything", "\n\n2.\tNotwithstanding anything"),
    ("condition_report.seller_unable", "Master", "\n\nThe Purchaser hereby waives", "\n\n3.\tThe Purchaser hereby waives"),
    ("condition_report.seller_unable", "Master", "\n\nThe parties hereby record", "\n\n4.\tThe parties hereby record"),
    ("sale_st.the_property", "Master", "\n\nExclusive use of parking area marked {{parking_bay}} or as determined by the Body Corporate.\n\nHELD BY",
     "\n\n1.2\tExclusive use of parking area marked {{parking_bay}} or as determined by the Body Corporate.\nHELD BY"),
    # The master's 1.4 is "Erf ______;" — nothing more.
    ("movables.definitions", "Master", "Erf {{erf_number}} Knysna, known as {{property_known_as}};", "Erf {{erf_number}};"),
    # The house master's signing lines end "202" and "202." (the seeding had "202__").
    ("sale.signatures", "Master", "_____________________ 202__\n\nAS WITNESSES:\n\n1 ______________________________\n\n2 ______________________________\n\nSELLER",
     "_____________________ 202\n\nAS WITNESSES:\n\n1 ______________________________\n\n2 ______________________________\n\nSELLER"),
    ("sale.signatures", "Master", "_____________________ 202__\n\nAS WITNESSES:\n\n1 ______________________________\n\n2 ______________________________\n\nPURCHASER",
     "_____________________ 202.\n\nAS WITNESSES:\n\n1 ______________________________\n\n2 ______________________________\n\nPURCHASER"),
]

# Laid out by the PDF itself; never marked.
SKIP_KEY = re.compile(r"(^sale\w*\.parties$|contract_info|signature|commission_acceptance|^ppra\.|\.title$)")
TOKEN = re.compile(r"\{\{\s*[a-zA-Z0-9_]+\s*\}\}")
NUM = re.compile(r"^(\d+(?:\.\d+)*\.?)(\t+| {2,}| (?=\S))")

SENT = "\u0001"  # a token, as one aligned unit


def norm_char(c: str) -> str:
    return {"\t": " ", " ": " ", "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-"}.get(c, c)


def master_paragraphs(path: Path):
    """[(text, [(bold, italic)] per char)] for every non-empty paragraph."""
    d = docx.Document(str(path))
    out = []
    for p in d.paragraphs:
        chars, fmt = [], []
        style_b = bool(p.style.font.bold)
        style_i = bool(p.style.font.italic)
        for r in p.runs:
            b = r.bold if r.bold is not None else (r.style.font.bold if r.style is not None and r.style.font.bold is not None else style_b)
            i = r.italic if r.italic is not None else (r.style.font.italic if r.style is not None and r.style.font.italic is not None else style_i)
            for c in r.text:
                chars.append(c)
                fmt.append((bool(b), bool(i)))
        text = "".join(chars)
        if text.strip():
            out.append((text, fmt))
    return out


def simple(s: str) -> str:
    s = TOKEN.sub(" ", s)
    s = "".join(norm_char(c) for c in s)
    s = re.sub(r"_+|…+|\.{3,}", " ", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def best_master(par: str, masters):
    key = simple(par)
    if len(key) < 3:
        return None
    best, score = None, 0.0
    for text, fmt in masters:
        r = difflib.SequenceMatcher(None, key, simple(text), autojunk=False).ratio()
        if r > score:
            best, score = (text, fmt), r
    return best if score >= 0.82 else None


def units(par: str):
    """The paragraph as aligned units: single characters, and SENT per token."""
    out, raw, pos = [], [], 0
    for m in TOKEN.finditer(par):
        for c in par[pos:m.start()]:
            out.append(norm_char(c)); raw.append(c)
        out.append(SENT); raw.append(m.group(0))
        pos = m.end()
    for c in par[pos:]:
        out.append(norm_char(c)); raw.append(c)
    return out, raw


def mark(par: str, master) -> str:
    """Write the master's bold/italic into one library paragraph."""
    mtext, mfmt = master
    mchars = [norm_char(c) for c in mtext]
    # A blank in the master is a run of underscores (or dots); compare it as one SENT.
    mu, mf = [], []
    i = 0
    while i < len(mchars):
        if mchars[i] in "_…":
            j = i
            while j < len(mchars) and mchars[j] in "_…":
                j += 1
            seg = mfmt[i:j]
            mu.append(SENT)
            mf.append((sum(b for b, _ in seg) * 2 >= len(seg), sum(t for _, t in seg) * 2 >= len(seg)))
            i = j
        else:
            mu.append(mchars[i]); mf.append(mfmt[i]); i += 1

    pu, praw = units(par)
    fmt = [None] * len(pu)
    sm = difflib.SequenceMatcher(None, pu, mu, autojunk=False)
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal" or (op == "replace" and i2 - i1 == j2 - j1):
            for k in range(i2 - i1):
                fmt[i1 + k] = mf[j1 + k]
        elif op == "replace" and j2 > j1:
            seg = mf[j1:j2]
            f = (sum(b for b, _ in seg) * 2 >= len(seg), sum(t for _, t in seg) * 2 >= len(seg))
            for k in range(i1, i2):
                fmt[k] = f
    # Unaligned characters take their neighbour's emphasis.
    last = (False, False)
    for k in range(len(fmt)):
        if fmt[k] is None:
            fmt[k] = last
        last = fmt[k]

    # Never mark the clause number and its tab.
    lead = NUM.match(par)
    lead_units = len(units(lead.group(0))[0]) if lead else 0
    for k in range(lead_units):
        fmt[k] = (False, False)

    body_units = range(lead_units, len(pu))
    text_only = [k for k in body_units if praw[k].strip()]
    if not text_only or not any(fmt[k][0] or fmt[k][1] for k in text_only):
        return par
    # An ALL-CAPS sub-heading the PDF already sets bold: leave it plain.
    rest = "".join(praw[k] for k in body_units)
    letters = re.sub(r"[^A-Za-z]", "", TOKEN.sub("", rest))
    if all(fmt[k][0] for k in text_only) and len(rest) < 80 and letters and letters == letters.upper():
        return par

    out, cur_b, cur_i = [], False, False
    pending_ws = []

    def close(b, i):
        nonlocal cur_b, cur_i
        if cur_i and not i:
            out.append("*"); cur_i = False
        if cur_b and not b:
            out.append("**"); cur_b = False

    def open_(b, i):
        nonlocal cur_b, cur_i
        if b and not cur_b:
            out.append("**"); cur_b = True
        if i and not cur_i:
            out.append("*"); cur_i = True

    for k in range(len(pu)):
        u = praw[k]
        if not u.strip():  # whitespace never opens or closes emphasis
            pending_ws.append(u)
            continue
        b, i = fmt[k]
        if (b, i) != (cur_b, cur_i):
            close(b, i)
            out.extend(pending_ws); pending_ws = []
            open_(b, i)
        else:
            out.extend(pending_ws); pending_ws = []
        out.append(u)
    close(False, False)
    out.extend(pending_ws)
    return "".join(out)


def strip_marks(s: str) -> str:
    return s.replace("**", "").replace("*", "")


def main():
    mdir, libpath, outpath = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    lib = json.loads(libpath.read_text())
    masters = {code: master_paragraphs(mdir / f) for code, f in MASTERS.items()}

    by = {(v["key"], v["label"]): v for v in lib}
    new = {k: v["body"] for k, v in by.items()}
    for key, label, old, rep in TEXT_FIXES:
        body = new[(key, label)]
        n = body.count(old)
        if n != 1:
            sys.exit(f"text fix {key}/{label}: {old!r} occurs {n} times")
        new[(key, label)] = body.replace(old, rep)

    marked_count = 0
    for (key, label), v in by.items():
        if v["source"] != "master_template" or SKIP_KEY.search(key):
            continue
        codes = [c for c in (v["templates"] or []) if c in MASTERS]
        if not codes:
            continue
        pool = [p for c in codes for p in masters[c]]
        paras = new[(key, label)].split("\n\n")
        out = []
        for par in paras:
            m = best_master(par, pool)
            res = mark(par, m) if m else par
            if strip_marks(res) != par:
                sys.exit(f"markup changed the words of {key}/{label}: {par[:60]!r}")
            if res != par:
                marked_count += 1
            out.append(res)
        new[(key, label)] = "\n\n".join(out)

    changed = [(k, l) for (k, l) in by if new[(k, l)] != by[(k, l)]["body"]]
    sql = [HEADER.format(n=len(changed), m=marked_count)]
    sql.append(MOVABLES_TITLE)
    for key, label in sorted(changed):
        body = new[(key, label)]
        assert "$body$" not in body
        sql.append(
            f"update clause_variant v set body = $body${body}$body$\n"
            f"  from clause c\n where v.clause_id = c.id and c.key = '{key}' and v.label = '{label}';\n"
        )
    outpath.write_text("\n".join(sql))
    print(f"{len(changed)} wordings changed, {marked_count} paragraphs carry emphasis → {outpath}")


HEADER = """-- ============================================================================
-- Dream Knysna OS — 0082 library matches Bronwyn's masters: words, numbers, emphasis
-- ----------------------------------------------------------------------------
-- Generated by scripts/mark-library-formatting.py from the .docx masters in
-- _contract_templates/2026-final/ — do not edit by hand. {n} wordings change.
--
-- 1. Text the first seeding missed: the movables agreement's title and the
--    paragraph numbers Word generates automatically (movables 2.1–2.3, 3.2;
--    appendix 1–4; sectional title 1.2), the movables 1.4 line ("Erf ___;"),
--    and the house signing lines ("202" / "202.").
-- 2. Emphasis: the masters bold words inside sentences ("Erf ___ KNYSNA,
--    WESTERN CAPE PROVINCE", "ZAR ___ RAND)"…). {m} paragraphs now carry
--    them as **bold** / *italic*, which the PDF prints.
--
-- Copy with:  {{ echo 'begin;'; cat supabase/migrations/0082_library_matches_masters.sql; echo 'commit;'; }} | pbcopy
-- then run scripts/check-library.sql and compare with project.state.md.
-- ============================================================================
"""

MOVABLES_TITLE = """-- The movables agreement's title, printed above clause 1 as in the master.
insert into clause (key, label, category, description)
values ('movables.title', 'Movables agreement — title', 'general', 'Title line of Bronwyn''s 2026 movables agreement.')
on conflict (key) do nothing;

insert into clause_variant (clause_id, label, body, is_default, source, approved)
select c.id, 'Master', 'AGREEMENT OF SALE IN RESPECT OF MOVABLES', true, 'master_template', true
  from clause c where c.key = 'movables.title'
on conflict (clause_id, label) do nothing;

insert into doc_template_slot (template_id, clause_id, ordinal, heading, numbering, is_optional, default_on)
select t.id, c.id, 5, null, null, false, true
  from doc_template t, clause c
 where t.code = 'movables_agreement' and c.key = 'movables.title'
   and not exists (select 1 from doc_template_slot s where s.template_id = t.id and s.clause_id = c.id);
"""

if __name__ == "__main__":
    main()
