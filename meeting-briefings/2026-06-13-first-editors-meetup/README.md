# First Editors' Meetup — Record & Briefing (13 June 2026)

LaTeX source for the combined **meeting record + strategy briefing** presented at
AIDER's first editors' online meetup on 13 June 2026.

**Published PDF:** https://ai-driven-energy-research.github.io/aider-editors-briefing-2026-06-13.pdf
(also linked from the [News page](https://ai-driven-energy-research.github.io/news.html)).

## Contents
- `aider-briefing.tex` — the document source. Every quantitative claim is cited; the
  references are listed on the final text page.
- `make_gap_figure.py` — regenerates `capacity_gap.pdf`, the figure contrasting
  (exponential) manuscript volume with (near-linear) peer-review capacity.
- `capacity_gap.pdf` — the figure included in the document (committed so the source
  builds without running Python).
- `group_photo.jpg` — screenshot from the meetup, used as the closing plate.

## Build
```bash
python3 make_gap_figure.py        # optional — regenerates the figure (pdf is committed)
latexmk -pdf aider-briefing.tex
```
Requires a TeX distribution (`pdflatex`) with the packages loaded at the top of the
`.tex`, and Python + matplotlib for the figure.

## Why this is here
In keeping with AIDER's open-process principle, the source of every published document
— including the numbers behind it — is shared so it can be inspected, reused, and
corrected. The raw meeting audio and verbatim transcript are kept private; this curated
PDF is the public record.
