# Bronwyn's master templates — extracted text

Source: email from Bronwyn Eyre <Bron@dreamknysna.co.za>, 2026-08-04,
subject "Drema Properties Templates". The original .docx/.pdf files are the
legal originals and are NOT in the repo (they are binaries and contain the
letterhead artwork); they live in Simon's `_contract_templates/` folder and
should be uploaded to the `documents` bucket as `document` rows with
status='template'.

What IS in the repo is the extracted text below, because that is what the
clause library (migration 0065) is seeded from and what a diff can review.
**When seeding a clause, copy the wording verbatim from these files.** Any
difference from Bronwyn's wording is a defect, not a preference — she signs
these.

| File | Paragraphs | Tables | Words |
|------|-----------:|-------:|------:|
| [Business Mandate - Dream Knysna.docx](business-mandate--dream-knysna.md) | 30 | 0 | 436 |
| [Dream Properties Addendum & Movables Template.docx](dream-properties-addendum-and-movables-template.md) | 46 | 0 | 334 |
| [Dream Properties Addendum Template.docx](dream-properties-addendum-template.md) | 33 | 0 | 200 |
| [Dream Properties Dual Mandate Template.docx](dream-properties-dual-mandate-template.md) | 48 | 1 | 1347 |
| [Dream Properties Exclusive Mandate Template.docx](dream-properties-exclusive-mandate-template.md) | 21 | 0 | 610 |
| [Dream Properties Movables Agreement.docx](dream-properties-movables-agreement.md) | 52 | 0 | 786 |
| [Dream Properties Open Mandate Template with Delcaration.docx](dream-properties-open-mandate-template-with-delcaration.md) | 47 | 1 | 1105 |
| [Master Copy Dream Agreement House Sale .docx](master-copy-dream-agreement-house-sale.md) | 171 | 0 | 4885 |
| [Master Copy Dream Properties PLOT Agreement .docx](master-copy-dream-properties-plot-agreement.md) | 140 | 0 | 3688 |

## Not extracted

- `Dream Properties BLANK letterhead with initial here footer.docx` — no text,
  layout only. The letterhead is already reproduced in `app/documents/DocumentPage.tsx`.
- `MASTER Dream Letterhead & Continuation Page 2026.doc` — legacy .doc, layout only.
- `Mandatory PPRA Disclosure Form.pdf` / `Mandatory PPRA form for Plot.pdf` — the
  question set is already modelled in `lib/ppraDisclosure.ts`.
