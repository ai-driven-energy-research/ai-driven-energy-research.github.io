#!/usr/bin/env python3
"""Generate the 'publishing capacity gap' figure for the AIDER briefing.

Illustrates the core claim: the volume of manuscripts requiring review compounds
(roughly exponentially) while the peer-review / journal capacity that absorbs it
grows only slowly (roughly linearly). Growth rates are anchored to cited sources:

  - Manuscript volume: +47% over 2016-2022 (Hanson et al. 2024, QSS) ~= 6.6%/yr in
    that window; long-run science growth ~4.1%/yr, doubling ~17 yr (Bornmann 2021).
    We use a conservative ~5%/yr compounding curve.
  - Journal count growth ~2.5-3.5%/yr (Mabe 2003; WordsRated 2020); the pool of
    practising scientists / reviewers shows "limited-to-no growth" (Hanson 2024).
    We use ~2.8%/yr for review+editorial capacity.

Output: capacity_gap.pdf (vector, for LaTeX inclusion).
"""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

ACCENT = "#2563eb"      # website accent blue  -> manuscripts
CAP    = "#6b7280"      # gray                 -> capacity
GAPCOL = "#ef4444"      # red                  -> the stress gap
DARK   = "#111827"

years = np.arange(2016, 2031)
t = years - 2016

papers   = 100 * (1.05 ** t)    # ~5%/yr compounding (exponential)
capacity = 100 * (1.028 ** t)   # ~2.8%/yr (near-linear over this range)

fig, ax = plt.subplots(figsize=(7.2, 4.2))

# shaded widening gap
ax.fill_between(years, capacity, papers, where=(papers >= capacity),
                color=GAPCOL, alpha=0.12, linewidth=0, zorder=1)

ax.plot(years, papers, color=ACCENT, lw=2.6, zorder=3,
        label="Manuscripts requiring review  (compounding ≈ 5%/yr)")
ax.plot(years, capacity, color=CAP, lw=2.6, ls=(0, (5, 2)), zorder=3,
        label="Peer-review & journal capacity  (≈ 2.8%/yr)")

# end-point labels
ax.annotate("Papers", xy=(2030, papers[-1]), xytext=(6, 0),
            textcoords="offset points", color=ACCENT, fontsize=10,
            fontweight="bold", va="center")
ax.annotate("Capacity", xy=(2030, capacity[-1]), xytext=(6, 0),
            textcoords="offset points", color=CAP, fontsize=10,
            fontweight="bold", va="center")

# annotate the gap
gx = 2029
ax.annotate("", xy=(gx, papers[years == gx][0]), xytext=(gx, capacity[years == gx][0]),
            arrowprops=dict(arrowstyle="<->", color=GAPCOL, lw=1.4))
ax.text(gx - 0.25, (papers[years == gx][0] + capacity[years == gx][0]) / 2,
        "widening\nreview gap", color=GAPCOL, fontsize=9, ha="right", va="center",
        fontweight="bold")

# real-world anchor callout
ax.annotate("Global articles indexed:\n1.92M (2016) → 2.82M (2022), +47%\n"
            "while the researcher pool barely grew\n(Hanson et al. 2024)",
            xy=(2022, papers[years == 2022][0]),
            xytext=(2016.3, 165), fontsize=8.0, color=DARK,
            bbox=dict(boxstyle="round,pad=0.4", fc="#eff6ff", ec=ACCENT, lw=0.8),
            arrowprops=dict(arrowstyle="-", color=ACCENT, lw=0.8))

ax.set_xlim(2016, 2030.8)
ax.set_ylim(90, 220)
ax.set_xlabel("Year", fontsize=10, color=DARK)
ax.set_ylabel("Index (2016 = 100)", fontsize=10, color=DARK)
ax.set_title("The publishing capacity gap", fontsize=13, fontweight="bold",
             color=DARK, pad=10)
ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:.0f}"))
ax.grid(True, axis="y", color="#e5e7eb", lw=0.8)
for s in ("top", "right"):
    ax.spines[s].set_visible(False)
for s in ("left", "bottom"):
    ax.spines[s].set_color("#9ca3af")
ax.tick_params(colors="#4b5563", labelsize=9)
ax.legend(loc="upper left", fontsize=8.6, frameon=False)

fig.tight_layout()
fig.savefig("capacity_gap.pdf", bbox_inches="tight")
print("wrote capacity_gap.pdf")
