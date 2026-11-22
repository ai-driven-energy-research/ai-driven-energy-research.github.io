# Integration guide: connecting the Codex + Google Drive workflow to the new AIDER website

**For:** Jingda Wu
**From:** Jianou Jiang (prepared with Claude Code), 22 November 2026
**Status:** ready to implement; nothing goes live until the endpoint URL below is set

---

## 1. What we decided, and what this guide asks you to build

At the 22 November meeting we agreed that the website should look and work like a traditional journal. AI agents stay, but **only for basic tasks**:

1. **Metadata extraction:** read the title, authors, affiliations, abstract and keywords from the uploaded manuscript, so authors don't type them twice.
2. **Initial technical screening:** checks a journal office would normally do by hand, for example whether references exist, length and abstract limits, whether required statements are present and whether files are complete.

The agent must **not** write an end-to-end peer review, score the science, or recommend accept or reject. Those stay with human editors and reviewers.

Your Drive workflow (drop files in a folder, wait 5 minutes, Codex runs, output appears in "completed" about 30 minutes later) is the right engine for this. This guide connects it to the new website in four steps:

| # | What | Who | Effort |
|---|------|-----|--------|
| A | Deploy a small Google Apps Script that receives submissions from the website and saves them into your Drive upload folder | Jingda | about 30 min |
| B | Adapt your watcher so that each submission arrives as a **subfolder** and the job starts when `submission.json` appears | Jingda | small change |
| C | Replace the full-review prompt with the **basic-tasks prompt** in section 6, which writes `metadata.json` and `screening.md` | Jingda | small change |
| D | Send me the web-app URL; I set it on the website and we run a test submission together | Jingda → Jianou | 10 min |

---

## 2. How it fits together

```
Author's browser                         Google (AIDER account)                  Codex (your workflow)
────────────────                         ──────────────────────                  ─────────────────────
submit.html (7-step form)
  │ the browser pre-fills title/abstract/
  │ authors/keywords (pdf.js, mammoth)
  │ the author checks and edits them
  ▼
POST JSON (metadata + files as base64) ──► Apps Script web app (doPost)
                                           │ validates, rate-limits
                                           │ creates  upload/AIDER-20261122-ABC123/
                                           │   main__manuscript.pdf
                                           │   supp__data.zip
                                           │   submission.json   ← written LAST (job marker)
                                           │ emails the editorial office + an
                                           │ acknowledgement to the corresponding author
                                           ▼
                                         upload/<reference>/  ───────────────►  watcher sees submission.json,
                                                                                 waits 5 min, runs Codex with
                                                                                 the basic-tasks prompt
                                                                                        │
                                         completed/<reference>/  ◄──────────────────────┘
                                           metadata.json   (machine-readable)
                                           screening.md    (checklist for the handling editor)
```

The website is static (GitHub Pages). It has no server, so the Apps Script is the smallest free piece of cloud infrastructure that can accept uploads. It runs in Google's cloud, not on anyone's laptop. Until the endpoint is set, the form falls back to: "download the submission form and email it with your manuscript to the editorial office".

---

## 3. Data contract: what the website sends (`aider-submission/1`)

`assets/submit.js` POSTs one JSON object as `Content-Type: text/plain`. The `text/plain` type avoids a CORS pre-flight that Apps Script cannot answer.

```json
{
  "schema": "aider-submission/1",
  "reference": "AIDER-20261122-ABC123",
  "submitted_at": "2026-11-22T15:04:05.000Z",
  "article_type": "Research Article",
  "title": "…",
  "abstract": "…",
  "keywords": ["…", "…", "…"],
  "subject_area": "Renewable energy forecasting",
  "authors": [
    {"name": "…", "email": "…", "affiliation": "…", "country": "…", "orcid": "", "corresponding": true}
  ],
  "suggested_reviewers": "free text, one per line",
  "opposed_reviewers": "free text",
  "cover_letter": "…",
  "data_availability": "…",
  "repository_url": "https://…",
  "ai_statement": "…",
  "funding": "…",
  "competing_interests": "…",
  "previous_submission": "No",
  "confirmations": {"original": true, "authors_approved": true, "licence_cc_by": true, "privacy": true},
  "extraction": {"source_file": "manuscript.pdf", "method": "browser-heuristic-v1", "found": ["title", "abstract", "keywords", "authors"]},
  "files": [
    {"name": "manuscript.pdf", "role": "main", "mime": "application/pdf", "size": 912345, "base64": "JVBERi0…"},
    {"name": "data.zip", "role": "supplementary", "mime": "application/zip", "size": 120000, "base64": "UEsDB…"}
  ]
}
```

Notes:
- `title`, `abstract`, `keywords` and `authors` are what the **author confirmed**. The browser pre-fill is a heuristic. Your Codex extraction is the independent second reading, and differences between the two are worth flagging (section 6).
- Total upload is capped at 25 MB in the browser. Base64 adds about 33%, so the request body stays under about 35 MB, within Apps Script's limit.
- The website expects the JSON reply `{"ok": true, "reference": "…"}` or `{"ok": false, "error": "…"}`.

---

## 4. Step A: deploy the Apps Script receiver

1. Use the **AIDER Google account** if we have one. Otherwise use your own account for the pilot; we can move it later by redeploying under another account and changing one URL on the website.
2. In Drive, create (or reuse) the folders `AIDER/upload` and `AIDER/completed`. Share them **only** with the editors. Copy the ID of `upload`: it is the long string in the folder's URL after `/folders/`.
3. Go to <https://script.google.com>, create a **New project** named "AIDER submission receiver", and paste in the code below. Set `UPLOAD_FOLDER_ID` and `EDITORIAL_EMAIL`.
4. Click **Deploy → New deployment → type "Web app"**:
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**. The website's visitors are anonymous; the script itself validates every request.
   - Authorise the requested scopes: Drive, to create files, and Gmail/MailApp, to send emails.
5. Copy the **Web app URL** (`https://script.google.com/macros/s/…/exec`) and send it to me.

```javascript
/**
 * AIDER submission receiver — Google Apps Script web app.
 * Receives aider-submission/1 JSON from https://ai-driven-energy-research.github.io/submit.html,
 * stores files + submission.json in UPLOAD_FOLDER/<reference>/, and sends two emails.
 */
const UPLOAD_FOLDER_ID = 'PASTE_UPLOAD_FOLDER_ID_HERE';
const EDITORIAL_EMAIL  = 'jianou.jiang@eng.ox.ac.uk';
const MAX_BYTES        = 30 * 1024 * 1024;   // decoded size of all files
const MAX_PER_10_MIN   = 20;                 // crude abuse limit

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    validate_(p);
    throttle_();

    const files = p.files || [];
    const total = files.reduce((s, f) => s + (Number(f.size) || 0), 0);
    if (total > MAX_BYTES) throw new Error('Files exceed the size limit');

    const root = DriveApp.getFolderById(UPLOAD_FOLDER_ID);
    if (root.getFoldersByName(p.reference).hasNext()) throw new Error('Duplicate reference');
    const folder = root.createFolder(p.reference);

    files.forEach(f => {
      const safe = String(f.name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150);
      const prefix = f.role === 'main' ? 'main__' : 'supp__';
      const blob = Utilities.newBlob(Utilities.base64Decode(f.base64), f.mime || 'application/octet-stream', prefix + safe);
      folder.createFile(blob);
    });

    // submission.json is written LAST: the Codex watcher uses it as the "upload complete" marker.
    const record = Object.assign({}, p, {
      files: files.map(f => ({ name: f.name, role: f.role, mime: f.mime, size: f.size })),
      received_at: new Date().toISOString()
    });
    folder.createFile('submission.json', JSON.stringify(record, null, 2), MimeType.PLAIN_TEXT);

    notify_(p, folder);
    return json_({ ok: true, reference: p.reference });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doGet() { return json_({ ok: true, service: 'AIDER submission receiver' }); }

function validate_(p) {
  if (!p || p.schema !== 'aider-submission/1') throw new Error('Unknown schema');
  if (!/^AIDER-\d{8}-[A-Z0-9]{6}$/.test(p.reference || '')) throw new Error('Bad reference');
  if (!p.title || !p.abstract) throw new Error('Missing title or abstract');
  if (!Array.isArray(p.authors) || !p.authors.length) throw new Error('Missing authors');
  if (!Array.isArray(p.files) || !p.files.some(f => f.role === 'main')) throw new Error('Missing main document');
  const c = p.confirmations || {};
  if (!(c.original && c.authors_approved && c.licence_cc_by && c.privacy)) throw new Error('Confirmations missing');
}

function throttle_() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('count') || 0) + 1;
  if (n > MAX_PER_10_MIN) throw new Error('Too many submissions; please try again later');
  cache.put('count', String(n), 600);
}

function notify_(p, folder) {
  const corr = p.authors.find(a => a.corresponding) || p.authors[0];
  const names = p.authors.map(a => a.name).join(', ');
  MailApp.sendEmail({
    to: EDITORIAL_EMAIL,
    subject: `[AIDER] New submission ${p.reference}: ${p.title.slice(0, 80)}`,
    body: `Reference: ${p.reference}\nType: ${p.article_type}\nTitle: ${p.title}\nAuthors: ${names}\n` +
          `Corresponding: ${corr.name} <${corr.email}>\nSubject area: ${p.subject_area}\n\nFolder: ${folder.getUrl()}\n\n` +
          `Automated metadata extraction and initial screening will appear in completed/${p.reference}/ when the Codex job finishes.`
  });
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(corr.email || '')) {
    MailApp.sendEmail({
      to: corr.email,
      replyTo: EDITORIAL_EMAIL,
      name: 'AI-Driven Energy Research',
      subject: `Submission received: ${p.reference}`,
      body: `Dear ${corr.name},\n\nThank you for submitting your manuscript "${p.title}" to AI-Driven Energy Research.\n\n` +
            `Your reference is ${p.reference}. Please quote it in any correspondence. The editorial office will carry out ` +
            `initial checks and contact you about the next steps.\n\nEditorial Office\nAI-Driven Energy Research (ISSN 2979-8639)\n` +
            `https://ai-driven-energy-research.github.io`
    });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
```

**Quotas to know about:** a consumer Gmail account can send about 100 emails a day through MailApp, which is plenty. Each script run may take up to 6 minutes; a 25 MB upload takes a few seconds.

**Test the deployment** before sending me the URL. This posts a tiny fake submission with a one-line text file as the "manuscript":

```bash
URL='https://script.google.com/macros/s/XXXX/exec'
B64=$(printf 'test manuscript' | base64)
curl -sL -H 'Content-Type: text/plain' --data-binary @- "$URL" <<EOF
{"schema":"aider-submission/1","reference":"AIDER-20261122-TEST01","title":"Test","abstract":"Test abstract",
 "authors":[{"name":"Test Author","email":"YOUR_EMAIL","affiliation":"X","country":"Y","corresponding":true}],
 "confirmations":{"original":true,"authors_approved":true,"licence_cc_by":true,"privacy":true},
 "files":[{"name":"test.txt","role":"main","mime":"text/plain","size":15,"base64":"$B64"}]}
EOF
```

You should get `{"ok":true,"reference":"AIDER-20261122-TEST01"}`, a new folder in `upload/`, and two emails. Delete the test folder afterwards.

---

## 5. Step B: watcher changes

Your current trigger is "no new files in `upload/` for 5 minutes". Two small changes:

1. **One job per subfolder.** Each submission is a folder named `AIDER-YYYYMMDD-XXXXXX`. Treat every new subfolder as one job, and write the outputs to `completed/<same name>/`.
2. **Start when `submission.json` exists.** The receiver writes it last, so it means "upload complete". You can keep the 5-minute quiet period as a safety margin.

Files dropped directly into `upload/` by hand, the way you do now, can keep working as before. Treat a loose file as its own job named after the file.

---

## 6. Step C: the basic-tasks prompt (replaces the full-review prompt)

Give Codex the job folder (manuscript, supplementary files and `submission.json`) and the prompt below. It must produce exactly two files in the output folder.

````markdown
# AIDER editorial-office assistant — basic tasks only

You are assisting the editorial office of AI-Driven Energy Research (AIDER), a peer-reviewed journal.
Input folder: the manuscript (main__*), supplementary files (supp__*), and submission.json (what the
author typed into the submission form).

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

End screening.md with: "Automated administrative checks only; not a peer review."
````

**What happens to the full-review mode you already built?** Keep it, but internal only. It is switched off for authors. The editors can decide later whether to give reviewers an AI-prepared report as a starting point; Raul raised that "head start" idea at the meeting, and it isn't decided yet.

---

## 7. Step D: going live

1. You send me the web-app URL.
2. I set `SUBMIT_ENDPOINT` at the top of `assets/submit.js` in the website repository and publish.
3. We make one test submission through <https://ai-driven-energy-research.github.io/submit.html> using one of the Volume 1 PDFs, then check that the `upload/` folder is created, both emails arrive, and `metadata.json` and `screening.md` appear in `completed/`.
4. We delete the test folder.

---

## 8. Confidentiality and privacy

- Unpublished manuscripts are confidential. Keep `upload/` and `completed/` shared with editors only, never "anyone with the link".
- Codex sends manuscript content to OpenAI for processing. The journal's privacy statement has been updated to say that submissions "may be processed by automated tools, including third-party AI services operated on the journal's behalf, solely for administrative checks". Please use an account or plan whose data is **not used for training**, and tell me if that isn't possible.
- Don't commit manuscripts, outputs or the web-app URL's deployment credentials to any public repository. The URL itself is not secret: it will appear in the website's JavaScript.

---

## 9. Later (not yet approved): targeted-question review

The meeting supported trialling invitations in which each expert answers one specific question about one section. When the editors approve a pilot, the same pipeline can add a third, editor-facing output: a list of the manuscript's key sections or claims, candidate experts found from the cited literature, and one draft question per expert. Every invitation would still be approved and sent by an editor. Please don't build this until the board agrees the pilot.

---

**Website files involved** (repository `ai-driven-energy-research.github.io`):
- `_src/pages/submit.html`: the form
- `assets/submit.js`: browser extraction, form logic and `CONFIG.SUBMIT_ENDPOINT`
- `tools/build_site.py`: regenerates the HTML pages from `_src/` (run `python3 tools/build_site.py`)

Questions: message me in the group chat.
