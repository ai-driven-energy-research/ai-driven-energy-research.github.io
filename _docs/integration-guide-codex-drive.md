# Integration guide: connecting the Codex + Google Drive workflow to the AIDER editorial system

**For:** Jingda Wu
**From:** Jianou Jiang (prepared with Claude Code), 22 November 2026
**Status:** website, dashboards and backend code are finished and tested locally. Going live needs one deployment on a Google account (steps A–D below).

---

## 1. What we decided, and the whole flow in one picture

At the 22 November meeting we agreed that the website should look and work like a traditional journal. AI agents stay, but **only for basic tasks**:

1. **Metadata extraction:** title, authors, affiliations, abstract and keywords.
2. **Initial technical screening:** the checks a journal office does by hand, for example whether references exist, length and abstract limits, whether required statements are present and whether files are complete.

The agent must **not** write a peer review, score the science, or recommend accept or reject.

The new website (already live) now has three parts that share one small backend:

| Part | Who uses it | Page |
|---|---|---|
| Submission system (7 steps; the last step is **Submit manuscript**) | Authors | `submit.html` |
| **Author dashboard**: status, history, review progress, decision letter and reports; upload revision; withdraw | Authors (private link emailed at submission) | `dashboard.html` |
| **Reviewer dashboard**: accept or decline, download files, submit report or answer a targeted question | Reviewers (private link in the invitation email) | `review.html` |
| **Editor console**: a Google Sheet with an "AIDER" menu | Editors | Google Sheets |

```
AUTHOR                 BACKEND (Google Apps Script + Sheet)          DRIVE                     YOUR CODEX WORKFLOW
──────                 ────────────────────────────────────          ─────                     ───────────────────
clicks "Submit"  ───►  submit: save files + row in Sheet      ───►  upload/<ref>/            watcher sees submission.json
                       status = Submitted                            main__*.pdf               │
                       emails author a dashboard link                submission.json (last)    ├─► agent_update "initial_checks"
                                                                                               │     status → Initial checks in progress
                                                                                               │   Codex: metadata.json + screening.md
                                                                     completed/<ref>/  ◄───────┤
                                                                                               └─► agent_update "checks_complete"
                                                                                                     status → Initial checks complete
                                                                                                     (editor emailed)
EDITOR (Sheet menu): Assign to me → With editor; add reviewer rows → "Send invitations"
REVIEWER (dashboard): Agree → status Under review; submit report → when all agreed reviewers (≥2) have reported → Reviews complete
EDITOR (Sheet menu): Record decision → author emailed; dashboard shows letter + anonymised reports
AUTHOR (dashboard): upload revision ───► upload/<ref>-R1/ … the same Codex job runs again (agent_update with "<ref>-R1")
```

**Your agent's actions are linked to the author's status** through two HTTP calls, `initial_checks` and `checks_complete`, described in section 5. They are the only change your workflow needs beyond swapping the prompt.

---

## 2. Files

All in the website repository `ai-driven-energy-research.github.io` (they are also attached to the email):

| File | What it is |
|---|---|
| `_docs/apps-script/Code.gs` | **The whole backend.** Paste it into Apps Script. |
| `_docs/apps-script/mock_server.js` | Local emulator of Google's services, used to test the full loop (`node _docs/apps-script/mock_server.js`). It is optional and not needed to deploy. |
| `assets/aider-api.js` | Website setting `window.AIDER_API = ''`. I put the web-app URL here when you send it. |
| `assets/submit.js`, `dashboard.js`, `review.js` | Website front-end. Nothing for you to change. |

---

## 3. Step A: deploy the backend (about 30 minutes)

1. Use the **AIDER Google account** if we have one; otherwise use yours for the pilot. It can be moved later.
2. In Drive, create `AIDER/upload` and `AIDER/completed`. Share them **only** with the editors. Copy the ID of `upload` (the string after `/folders/` in its URL).
3. Create a Google Sheet called **"AIDER editorial system"** and open **Extensions → Apps Script**. Delete the sample code, paste in `Code.gs`, and save.
4. **Project Settings → Script properties**: add
    - `UPLOAD_FOLDER_ID` = the folder ID from step 2
    - `EDITORIAL_EMAIL` = `jianou.jiang@eng.ox.ac.uk` (or the shared editorial address)
    - `AGENT_KEY` = a long random secret, for example the output of `openssl rand -hex 24`. **Only your Codex workflow knows this.**
    - `SITE_URL` = `https://ai-driven-energy-research.github.io`
    - `SHEET_ID` = the Sheet's ID (the string after `/d/` in its URL). The script finds the Sheet without it when bound, but setting it is safer for web-app calls.
5. Back in the Sheet, reload. An **AIDER** menu appears. Run **AIDER → Set up sheets** once and authorise the script. It creates three tabs: `submissions`, `reviews` and `reviewers`.
6. In Apps Script, click **Deploy → New deployment → Web app**, with *Execute as:* **Me** and *Who has access:* **Anyone**. Copy the URL (`https://script.google.com/macros/s/…/exec`).
7. Send me the URL. **Don't** send `AGENT_KEY` through the group chat.

When you change `Code.gs` later, use **Deploy → Manage deployments → Edit → New version**. That keeps the same URL.

---

## 4. Step B: watcher changes

1. **One job per subfolder** of `upload/`. New submissions are named `AIDER-YYYYMMDD-XXXXXX`, and revisions `AIDER-YYYYMMDD-XXXXXX-R1`, `-R2`, and so on.
2. **Start a job when `submission.json` exists in that folder.** The backend writes it last, so it means "upload complete". You can keep your 5-minute quiet period as a safety margin.
3. Write the outputs to `completed/<same folder name>/`.
4. `submission.json` contains what the author typed. For revisions it has `"type": "revision"`, `"revision": n` and the author's `response_letter`.

---

## 5. Step C: link the agent to the status (two calls) and swap the prompt

At the **start** and **end** of each job, call the backend. `$AIDER_API` is the web-app URL and `$AIDER_AGENT_KEY` is the secret from step A4; keep them in environment variables, not in code you commit.

```bash
# job started  ->  author dashboard shows "Initial checks in progress"
curl -sL -H 'Content-Type: text/plain' "$AIDER_API" \
  -d "{\"action\":\"agent_update\",\"agent_key\":\"$AIDER_AGENT_KEY\",\"reference\":\"$JOB\",\"status\":\"initial_checks\"}"

# job finished ->  "Initial checks complete"; the editor is emailed. editor_note is shown to EDITORS ONLY.
curl -sL -H 'Content-Type: text/plain' "$AIDER_API" \
  -d "{\"action\":\"agent_update\",\"agent_key\":\"$AIDER_AGENT_KEY\",\"reference\":\"$JOB\",\"status\":\"checks_complete\",\"editor_note\":\"5/5 statements present; 2 references not found\"}"

# job failed   ->  editor emailed; the author's status is unchanged
curl -sL -H 'Content-Type: text/plain' "$AIDER_API" \
  -d "{\"action\":\"agent_update\",\"agent_key\":\"$AIDER_AGENT_KEY\",\"reference\":\"$JOB\",\"status\":\"failed\",\"editor_note\":\"Main file is password-protected\"}"
```

`$JOB` is the folder name (`AIDER-…` or `AIDER-…-R1`); the backend strips the `-R1` suffix itself. Every reply is JSON: `{"ok":true,"status":"…"}` or `{"ok":false,"error":"…"}`.

**Prompt.** Replace the full-review prompt with the one below. It must produce exactly two files: `metadata.json` and `screening.md`.

````markdown
# AIDER editorial-office assistant — basic tasks only

You are assisting the editorial office of AI-Driven Energy Research (AIDER), a peer-reviewed journal.
Input folder: the manuscript (main__*), supplementary files (supp__*), and submission.json (what the
author typed into the submission form; for revisions it also contains the response letter).

## Strict limits
- Do NOT review the science. Do NOT judge novelty, significance or correctness of results.
- Do NOT recommend accept, revise or reject, and do not give scores.
- Do NOT contact anyone, and do not upload the manuscript anywhere.
- Report facts and checks only. If unsure, say "unclear" rather than guessing.

## Task 1: metadata extraction -> metadata.json
Read the manuscript itself (not submission.json) and write:
{
  "title": "...",
  "authors": [{"name": "...", "affiliations": ["..."], "email": "... or null", "orcid": "... or null", "corresponding": true/false}],
  "abstract": "...",
  "keywords": ["..."],
  "article_type_guess": "Research Article | Review Article | unclear",
  "counts": {"pages": n, "words_main_text_approx": n, "abstract_words": n, "figures": n, "tables": n, "references": n},
  "differences_from_form": ["e.g. 'Author 3 in manuscript (A. Smith) missing from form'", "..."]
}

## Task 2: initial technical screening -> screening.md
A short checklist for the handling editor, using one of PASS / FLAG / N/A for each item, with one line of evidence:
1. Scope: does the manuscript use AI/ML as a core method for an energy-related problem? (in scope / out of scope / unclear, one sentence why)
2. Abstract at most 300 words; 3-6 keywords.
3. Required statements present in the manuscript: data and code availability; use of AI tools; competing interests; funding; author contributions.
4. Repository / data links given in the manuscript or form: do they resolve (HTTP 200)? Is the repository public and non-empty?
5. References: total count; how many have DOIs; check every DOI resolves (https://doi.org/<doi> or the Crossref API). List any reference that
   cannot be found by DOI or by searching the exact title (possible fabricated or wrong reference). List up to 20.
6. Figures and tables: numbered consecutively and all referred to in the text? Any missing or unreadable?
7. Files: are supplementary files mentioned in the text actually present? Are any files corrupt or password-protected?
8. Formatting basics: title page complete (all authors with affiliations, corresponding email); sections and equations numbered; language
   understandable (flag only if serious).
9. Anything the editor should know before sending to reviewers (e.g. manuscript appears to be a duplicate or already published:
   search the exact title).
10. For revisions only: does the response letter address each reviewer comment? List any that appear unanswered (facts only).

End screening.md with: "Automated administrative checks only; not a peer review."
````

Use a one-line summary of `screening.md` as the `editor_note` of the `checks_complete` call.

**Your existing full-review mode** stays internal and switched off for authors. The editors may later decide to give reviewers an AI-prepared report as a starting point (Raul's suggestion at the meeting). That is not decided yet.

---

## 6. How editors run the process (for reference)

Everything happens in the **"AIDER editorial system"** Sheet:

| Step | Editor action | What the author/reviewer sees |
|---|---|---|
| Triage | Select the row in `submissions` → **AIDER → Assign selected submission to me** | Status "With editor" |
| Invite | In `reviews`, add a row: `reference`, `reviewer_name`, `reviewer_email`; optionally `scope` = `question`, a `question`, and `due_date`. Then **AIDER → Send invitations for new reviewer rows** | Reviewer receives an email with a dashboard link (a targeted question if `scope=question`) |
| Review | Nothing to do | Reviewer agrees → status "Under review". When all reviewers who agreed (at least 2) have reported → "Reviews complete" |
| Decide | Select the row → **AIDER → Record decision…** (`minor_revision`, `major_revision`, `accepted` or `rejected`, then the letter) | Author emailed; the dashboard shows the letter and anonymised reports |
| Revise | Nothing to do | Author uploads in the dashboard → `upload/<ref>-R1/` → your agent runs again |
| Publish | **AIDER → Mark selected submission as published** | Status "Published" |

---

## 7. Step D: going live and testing together

1. You send me the web-app URL. I set `window.AIDER_API` in `assets/aider-api.js` and publish the website.
2. We submit a test manuscript, for example a Volume 1 PDF, through `submit.html`, then check:
    - the folder in `upload/`, the row in the Sheet, and both emails;
    - that the author dashboard link works;
    - that your agent's two calls change the dashboard status, and that `metadata.json` and `screening.md` appear in `completed/`;
    - that inviting one of us as a reviewer works, and the reviewer dashboard can accept, download and submit.
3. We delete the test row and folders.

I tested the complete loop locally against `mock_server.js`, from submission and agent updates through invitations, two reviewers (one full review, one targeted question), the decision, and a revision that the agent picks up again. All 17 checks passed.

---

## 8. Confidentiality, privacy and limits

- Keep `upload/`, `completed/` and the Sheet shared with editors only. The Sheet holds the private dashboard keys.
- Codex sends manuscript content to OpenAI. The journal's privacy statement already discloses that third-party AI services may process submissions for administrative checks. Please use a plan or setting whose data is **not used for training**.
- The web-app URL is not secret; it appears in the website's JavaScript. `AGENT_KEY` is secret.
- Limits: 25 MB of files per submission; about 100 emails a day on a consumer Gmail account; at most 20 submissions per 10 minutes, as a simple abuse brake.

---

## 9. Later (not yet approved): AI-assisted targeted-question outreach

The backend already supports targeted questions (`scope = question`). When the board approves a pilot, your pipeline could add a third, editor-facing output: the manuscript's key sections or claims, candidate experts from the cited literature, and one draft question per expert. Editors would paste the approved ones into the `reviews` sheet. Please don't build this until the board agrees the pilot.

Questions: message me in the group chat.
