# Second Editors' Meetup — Decisions, DOAJ and Partnerships (1 August 2026)

LaTeX source for the pre-read and working paper prepared for AIDER's second editors'
online meetup on 1 August 2026 (9:00–9:30 pm Beijing, UTC+8).

**Published PDF:** https://ai-driven-energy-research.github.io/aider-second-editors-meetup-pre-read-2026-08-01.pdf
(also linked from the [News page](https://ai-driven-energy-research.github.io/news.html)).

## Contents

- `aider-doaj-briefing.tex` — source for the meeting document.

The briefing includes:

1. The meeting's voting rule: a motion passes unless more than half of participating
   eligible editors vote against it, plus the authority and limits created by a pass.
2. Seven executable motions reconstructed from proposals made at the first meetup,
   with proposer/owner, boundaries, evidence and a vote-record table.
3. A current DOAJ readiness audit and timeline. All five current papers are fully
   published; none is awaiting review. The audit also corrects two important earlier
   assumptions: two independent human reviewers are required for each article, and the
   five editor-authored papers create 100% endogeny rather than a compliant record.
4. A proposed collaboration with the Journal of the Global Power and Propulsion Society
   (JGPPS), where Prof. Budimir Rosic is an editorial-board member. This is framed as
   mentorship and shared community activity, not transferable indexing.
5. A standard format for new proposals introduced today and voted at the third meetup.

Requirements and journal facts were rechecked on 1 August 2026 against DOAJ, JGPPS and
Clarivate's official materials. The cited links appear in the PDF.

## Build

```bash
latexmk -pdf aider-doaj-briefing.tex
```

Requires a TeX distribution (`pdflatex`) with the packages loaded at the top of the
`.tex` file.

## Why this is here

In keeping with AIDER's open-process principle, the source of every published document —
including the sources behind factual claims — is shared so it can be inspected, reused
and corrected. Raw meeting audio and verbatim transcripts are kept private; this curated
document is the public pre-read and working record.
