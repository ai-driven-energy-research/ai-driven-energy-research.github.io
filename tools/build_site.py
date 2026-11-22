#!/usr/bin/env python3
"""Build the AIDER website from page fragments.

Page bodies live in _src/pages/<slug>.html. The first lines of each fragment are
front-matter comments:

    <!-- title: Instructions for authors -->
    <!-- layout: info | home | plain -->
    <!-- tab: authors -->            (which top tab is highlighted)
    <!-- crumb: Instructions for authors -->
    <!-- description: ... -->

Special tokens inside fragments:
    {{LATEST_ARTICLES}}   article list for the home page
    {{VOLUME_1}}          full contents of Volume 1
    {{LEGACY:<name>}}     inserts _src/legacy/<name>.html (old page content)

Run from the repository root:  python3 tools/build_site.py
Generated pages are written to the repository root. _src/ is not served
(GitHub Pages' Jekyll build ignores folders that start with an underscore).
"""
import html
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "_src"

JOURNAL = "AI-Driven Energy Research"
ISSN = "2979-8639"
CONTACT = "jianou.jiang@eng.ox.ac.uk"
GITHUB = "https://github.com/ai-driven-energy-research"

# ---------------------------------------------------------------- articles
ARTICLES = [
    dict(n=5, kind="Research Article",
         title="AI-Driven Data Centre Demand Concentration and Renewable Energy Misalignment in the United States",
         authors="Feng Wei", aff="China Academy of Information and Communications Technology (CAICT)",
         pdf="papers/vol1-art5-datacenter-grid-stress.pdf", pages=29,
         repo=f"{GITHUB}/us-datacenter-grid-stress", review=f"{GITHUB}/submissions/issues/6", doi=None),
    dict(n=4, kind="Research Article",
         title="A Pareto frontier between equilibrium fidelity and reversed-flow sign accuracy in neural wall function formulations",
         authors="Jianou Jiang", aff="Department of Engineering Science, University of Oxford",
         pdf="papers/vol1-art4-neural-wall-function.pdf", pages=44,
         repo=f"{GITHUB}/neural-wall-function-pareto", review=f"{GITHUB}/submissions/issues/5", doi=None),
    dict(n=3, kind="Research Article",
         title="A Data-Driven Design Strategy for Next-Generation Lithium Batteries: Feature-Guided Development of Diluent for High-Performance Electrolytes",
         authors="Jingda Wu", aff="Kyoto University",
         pdf="papers/vol1-art3-lithium-diluent.pdf", pages=15,
         repo=f"{GITHUB}/HCE-feature-importance-analysis", review=f"{GITHUB}/submissions/issues/4", doi=None),
    dict(n=2, kind="Research Article",
         title="Advancing Clean Energy Conversion through Electrocatalysis: High-Efficiency Oxygen Reduction in Sustainable Fuel Cells",
         authors="Jingda Wu", aff="Kyoto University",
         pdf="papers/vol1-art2-electrocatalysis-orr.pdf", pages=14,
         repo=f"{GITHUB}/Catalyst-DMFC-Experiments-Paper", review=f"{GITHUB}/submissions/issues/3", doi=None),
    dict(n=1, kind="Review Article",
         title="Foundation Models for Clean Energy Systems: A Scoping Review and Deployment Framework",
         authors="Jianou Jiang", aff="University of Oxford",
         pdf="papers/vol1-art1-foundation-models.pdf", pages=49,
         repo=f"{GITHUB}/foundation-models-clean-energy", review=f"{GITHUB}/submissions/issues/1",
         doi="10.5281/zenodo.18902064"),
]


def article_html(a):
    e = html.escape
    links = [f'<a href="{a["pdf"]}">PDF ({a["pages"]} pp.)</a>',
             f'<a href="{a["repo"]}">Code and data</a>',
             f'<a href="{a["review"]}">Peer review record</a>']
    if a["doi"]:
        links.append(f'<a href="https://doi.org/{a["doi"]}">https://doi.org/{a["doi"]}</a>')
    sep = ' <span class="sep">|</span> '
    return f'''<li class="article">
  <div class="type">{e(a["kind"])}<span class="oa">Open access</span></div>
  <div class="atitle"><a href="{a["pdf"]}">{e(a["title"])}</a></div>
  <div class="authors">{e(a["authors"])} <span class="small">({e(a["aff"])})</span></div>
  <div class="source"><i>{JOURNAL}</i>, Volume 1 (2026), Article {a["n"]}</div>
  <div class="alinks">{sep.join(links)}</div>
</li>'''


def article_list(items):
    return '<ul class="articles">\n' + "\n".join(article_html(a) for a in items) + "\n</ul>"


# ---------------------------------------------------------------- chrome
COVER_SVG = f'''<svg class="cover" viewBox="0 0 74 98" role="img" aria-label="AIDER journal cover">
<rect width="74" height="98" fill="#1b365d"/><rect y="70" width="74" height="28" fill="#8a1c1c"/>
<text x="37" y="30" fill="#fff" font-family="Georgia,serif" font-size="15" text-anchor="middle">AIDER</text>
<text x="37" y="44" fill="#d9e1ec" font-family="Arial,sans-serif" font-size="5.2" text-anchor="middle">AI-DRIVEN</text>
<text x="37" y="51" fill="#d9e1ec" font-family="Arial,sans-serif" font-size="5.2" text-anchor="middle">ENERGY RESEARCH</text>
<text x="37" y="82" fill="#fff" font-family="Arial,sans-serif" font-size="5.6" text-anchor="middle">Volume 1</text>
<text x="37" y="90" fill="#fff" font-family="Arial,sans-serif" font-size="5.6" text-anchor="middle">2026</text>
</svg>'''

TABS = [
    ("home", "index.html", "Journal home"),
    ("issues", "issues.html", "Latest volume"),
    ("all", "issues.html#all-volumes", "All volumes"),
    ("about", "about.html", "Journal information"),
    ("board", "editorial-board.html", "Editorial board"),
    ("authors", "author-guidelines.html", "Instructions for authors"),
    ("review", "reviewer-guidelines.html", "Peer review"),
    ("policies", "ethics.html", "Journal policies"),
    ("news", "news.html", "News"),
]

SUBNAV = [
    ("About this journal", [
        ("about.html", "About the journal"),
        ("about.html#aims-and-scope", "Aims and scope"),
        ("editorial-board.html", "Editorial board"),
        ("research-roadmap.html", "Research priorities"),
        ("news.html", "News and announcements"),
        ("founders-remarks.html", "Founding editor's remarks"),
        ("about.html#contact", "Contact details"),
    ]),
    ("Author instructions", [
        ("author-guidelines.html", "Instructions for authors"),
        ("author-guidelines.html#preparing", "Preparing your manuscript"),
        ("submit.html", "Submit a manuscript"),
        ("dashboard.html", "Author dashboard"),
        ("collaborative-research.html", "Code repositories and team submissions"),
        ("author-guidelines.html#fees", "Fees and licensing"),
    ]),
    ("Peer review information", [
        ("reviewer-guidelines.html", "Review process"),
        ("reviewer-guidelines.html#instructions", "Instructions for reviewers"),
        ("review.html", "Reviewer dashboard"),
        ("join.html", "Join the editorial board or reviewer pool"),
    ]),
    ("Journal policies", [
        ("ethics.html", "Publishing ethics"),
        ("ethics.html#ai", "Use of AI tools"),
        ("ethics.html#open-access", "Open access and copyright"),
        ("ethics.html#corrections", "Corrections and retractions"),
        ("ethics.html#appeals", "Complaints and appeals"),
    ]),
]


def subnav(slug):
    out = ['<nav class="subnav" aria-label="Journal information">']
    for head, links in SUBNAV:
        out.append(f'<div class="group"><h3>{head}</h3><ul>')
        for href, label in links:
            active = ' class="active"' if href == f"{slug}.html" else ""
            out.append(f'<li><a href="{href}"{active}>{label}</a></li>')
        out.append("</ul></div>")
    out.append("</nav>")
    return "\n".join(out)


SIDEBAR = f'''<aside class="sidebar">
<div class="box"><h2>Submit your article</h2><div class="inner">
<p>{JOURNAL} welcomes original research and review articles at the intersection of artificial intelligence and energy systems.</p>
<p><a class="btn-submit" href="submit.html">Submit manuscript</a></p>
<p><a href="author-guidelines.html">Instructions for authors</a><br><a href="dashboard.html">Author dashboard</a> &middot; <a href="review.html">Reviewer dashboard</a></p>
</div></div>
<div class="box"><h2>Journal information</h2><div class="inner"><dl>
<dt>ISSN</dt><dd>{ISSN} (Online)</dd>
<dt>Publisher</dt><dd>AI-Driven Energy Research (AIDER), Oxford, United Kingdom</dd>
<dt>Founding Editor</dt><dd>Jianou Jiang, University of Oxford</dd>
<dt>Frequency</dt><dd>Continuous publication; one volume per year</dd>
<dt>Access</dt><dd>Diamond open access: free to read, free to publish</dd>
<dt>Licence</dt><dd>CC BY 4.0</dd>
<dt>Archiving</dt><dd>Zenodo (CERN), with DOIs</dd>
</dl></div></div>
<div class="box"><h2>Information</h2><div class="inner"><ul>
<li><a href="about.html#aims-and-scope">Aims and scope</a></li>
<li><a href="editorial-board.html">Editorial board</a></li>
<li><a href="reviewer-guidelines.html">Peer review process</a></li>
<li><a href="ethics.html">Publishing ethics</a></li>
<li><a href="join.html">Become a reviewer</a></li>
</ul></div></div>
</aside>'''


def header(tab):
    tabs = []
    for key, href, label in TABS:
        active = ' class="active"' if key == tab else ""
        tabs.append(f'<li><a href="{href}"{active}>{label}</a></li>')
    return f'''<div class="utility"><div class="wrap">
<span>{JOURNAL} &middot; ISSN {ISSN} (Online)</span>
<span class="links"><a href="dashboard.html">Author dashboard</a><a href="review.html">Reviewer dashboard</a><a href="about.html#contact">Contact</a><a href="join.html">Join the board</a></span>
</div></div>
<header class="masthead"><div class="wrap">
<a href="index.html" aria-label="Journal home">{COVER_SVG}</a>
<div class="title-block">
<p class="journal-title"><a href="index.html">{JOURNAL}</a></p>
<p class="meta">ISSN {ISSN} (Online) &middot; Diamond open access &middot; <strong>Founding Editor:</strong> Jianou Jiang</p>
<p class="meta">Published by AI-Driven Energy Research (AIDER), Oxford, United Kingdom</p>
</div>
<div class="actions"><a class="btn-submit" href="submit.html">Submit manuscript</a><br><a href="author-guidelines.html">Instructions for authors</a></div>
</div></header>
<nav class="tabs" aria-label="Main"><ul>
{chr(10).join(tabs)}
</ul></nav>'''


FOOTER = f'''<footer class="site-footer"><div class="wrap">
<div class="cols">
<div><h4>Journal</h4><ul>
<li><a href="about.html">About the journal</a></li><li><a href="about.html#aims-and-scope">Aims and scope</a></li>
<li><a href="editorial-board.html">Editorial board</a></li><li><a href="news.html">News</a></li></ul></div>
<div><h4>Authors</h4><ul>
<li><a href="author-guidelines.html">Instructions for authors</a></li><li><a href="submit.html">Submit a manuscript</a></li>
<li><a href="author-guidelines.html#fees">Fees and licensing</a></li><li><a href="collaborative-research.html">Code repositories</a></li></ul></div>
<div><h4>Reviewers and policies</h4><ul>
<li><a href="reviewer-guidelines.html">Peer review</a></li><li><a href="ethics.html">Publishing ethics</a></li>
<li><a href="ethics.html#ai">Use of AI tools</a></li><li><a href="ethics.html#corrections">Corrections and retractions</a></li></ul></div>
<div><h4>Contact</h4><ul>
<li><a href="mailto:{CONTACT}">{CONTACT}</a></li><li><a href="{GITHUB}">GitHub organisation</a></li>
<li><a href="join.html">Join the editorial board</a></li></ul></div>
</div>
<div class="legal">&copy; 2026 AI-Driven Energy Research (AIDER), Oxford, United Kingdom. ISSN {ISSN} (Online). Articles are published under the Creative Commons Attribution 4.0 International licence (CC BY 4.0) unless otherwise stated.</div>
</div></footer>'''


def page(slug, meta, body):
    title = meta.get("title", JOURNAL)
    full_title = JOURNAL if slug == "index" else f"{title} | {JOURNAL}"
    desc = meta.get("description", f"{JOURNAL} (ISSN {ISSN}) is a diamond open-access, peer-reviewed journal for research at the intersection of artificial intelligence and energy systems.")
    layout = meta.get("layout", "info")
    crumb = meta.get("crumb", title)
    crumbs = "" if slug == "index" else (
        f'<div class="crumbs"><a href="index.html">Home</a><span class="sep">&rsaquo;</span>{html.escape(crumb)}</div>')
    head_extra = meta.get("head", "")
    if layout == "home":
        grid = f'<div class="page home"><main class="content">{body}</main>{SIDEBAR}</div>'
    elif layout == "plain":
        grid = f'<div class="page plain"><main class="content">{body}</main></div>'
    else:
        grid = f'<div class="page info">{subnav(slug)}<main class="content">{body}</main></div>'
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{html.escape(full_title)}</title>
<meta name="description" content="{html.escape(desc)}">
<link rel="stylesheet" href="style.css">
{head_extra}
</head>
<body>
{header(meta.get("tab", ""))}
<div class="wrap">
{crumbs}
{grid}
</div>
{FOOTER}
</body>
</html>
'''


def parse(fragment):
    meta = {}
    for m in re.finditer(r"^<!--\s*(\w+):\s*(.*?)\s*-->\s*$", fragment, flags=re.M):
        meta[m.group(1)] = m.group(2)
    body = re.sub(r"^<!--\s*\w+:.*?-->\s*\n", "", fragment, flags=re.M)
    return meta, body


def expand(body):
    body = body.replace("{{LATEST_ARTICLES}}", article_list(ARTICLES))
    body = body.replace("{{VOLUME_1}}", article_list(sorted(ARTICLES, key=lambda a: a["n"])))

    def legacy(m):
        text = (SRC / "legacy" / f"{m.group(1)}.html").read_text()
        # drop the old section/container wrappers; keep the inner content
        text = re.sub(r'^\s*<div class="section">\s*<div class="container">', "", text)
        text = re.sub(r"</div>\s*</div>\s*$", "", text)
        return text
    return re.sub(r"\{\{LEGACY:([\w-]+)\}\}", legacy, body)


def main():
    pages = sorted((SRC / "pages").glob("*.html"))
    for p in pages:
        meta, body = parse(p.read_text())
        out = ROOT / p.name
        out.write_text(page(p.stem, meta, expand(body)))
        print("built", out.name)


if __name__ == "__main__":
    main()
