# Second Editors' Meetup — DOAJ Readiness Briefing (1 August 2026)

LaTeX source for the **DOAJ readiness briefing** prepared for AIDER's second editors'
online meetup on 1 August 2026 (9:00–9:30 pm Beijing, UTC+8). The meeting covers what it
takes to get AIDER into the Directory of Open Access Journals now that the ISSN
(2979-8639, Online) is assigned, plus the other issues on the agenda.

**Published PDF:** https://ai-driven-energy-research.github.io/aider-doaj-briefing-2026-08-01.pdf
(also linked from the [News page](https://ai-driven-energy-research.github.io/news.html)).

## Contents
- `aider-doaj-briefing.tex` — the document source. Every DOAJ criterion is cited to
  DOAJ's own materials; the references are listed on the final page.

The briefing includes:
1. What DOAJ is and why it is our next credibility gate.
2. The full DOAJ requirements (eligibility gates, editorial/peer-review rules, required
   website disclosures, licensing & author rights, and the seven DOAJ Seal criteria),
   plus DOAJ's 2025 AI best-practice guidance.
3. An honest **readiness scorecard** auditing AIDER against every criterion.
4. The AI-review question — reconciling our five reviewer agents with DOAJ's AI guidance.
5. The other agenda issues — Crossref DOIs & digital preservation, publishing cadence &
   the fifth paper, and post-ISSN promotion.
6. Proposed next steps and owners.

## Build
```bash
latexmk -pdf aider-doaj-briefing.tex
```
Requires a TeX distribution (`pdflatex`) with the packages loaded at the top of the
`.tex` (charter, helvet, eurosym, tcolorbox, longtable, fancyhdr, titlesec, booktabs).

## Why this is here
In keeping with AIDER's open-process principle, the source of every published document —
including the sources behind every claim — is shared so it can be inspected, reused, and
corrected. The raw meeting audio and verbatim transcript are kept private; this curated
PDF is the public record.
