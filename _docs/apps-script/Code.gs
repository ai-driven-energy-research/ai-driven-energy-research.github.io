/**
 * AIDER editorial system — Google Apps Script web app.
 *
 * Bind this script to a Google Sheet called "AIDER editorial system". The Sheet is the
 * database AND the editors' console (custom "AIDER" menu). The website talks to the
 * deployed web app with JSON POSTs (Content-Type: text/plain, which avoids CORS pre-flight).
 *
 * Script properties (Project Settings -> Script properties):
 *   UPLOAD_FOLDER_ID  Drive folder watched by the Codex workflow (required)
 *   EDITORIAL_EMAIL   editorial office address (required)
 *   AGENT_KEY         long random secret shared ONLY with the Codex workflow (required)
 *   SITE_URL          https://ai-driven-energy-research.github.io (optional)
 *   SHEET_ID          only if the script is NOT bound to the Sheet (optional)
 *
 * Actions (field "action" in the JSON body):
 *   submit             public  - new manuscript (schema aider-submission/1)
 *   author_status      author  - reference + key -> status, history, decision
 *   author_revise      author  - upload revised files after a revision decision
 *   author_withdraw    author  - withdraw before a final decision
 *   agent_update       agent   - AI agent reports start/finish of initial checks
 *   reviewer_view      reviewer key -> invitations, active and completed reviews
 *   reviewer_respond   reviewer - accept / decline an invitation
 *   reviewer_file      reviewer - download a manuscript file (base64)
 *   reviewer_submit    reviewer - submit a report
 */

var SITE_URL_DEFAULT = 'https://ai-driven-energy-research.github.io';
var MAX_BYTES = 30 * 1024 * 1024;
var MAX_SUBMITS_PER_10_MIN = 20;
var REVIEW_DAYS = 21;

var STATUS = {
  submitted: 'Submitted',
  initial_checks: 'Initial checks in progress',
  checks_complete: 'Initial checks complete',
  with_editor: 'With editor',
  under_review: 'Under review',
  reviews_complete: 'Reviews complete, awaiting decision',
  minor_revision: 'Decision: minor revision',
  major_revision: 'Decision: major revision',
  revision_submitted: 'Revised version submitted',
  accepted: 'Accepted',
  rejected: 'Rejected',
  published: 'Published',
  withdrawn: 'Withdrawn'
};
var DECISIONS = ['minor_revision', 'major_revision', 'accepted', 'rejected'];
var FINAL = ['accepted', 'rejected', 'published', 'withdrawn'];
var RECOMMENDATIONS = ['accept', 'minor_revision', 'major_revision', 'reject', 'answer_only'];

var SHEETS = {
  submissions: ['reference', 'created_at', 'updated_at', 'status', 'title', 'article_type', 'subject_area', 'abstract', 'keywords',
    'corresponding_name', 'corresponding_email', 'authors_json', 'editor', 'folder_id', 'revision', 'author_key',
    'decision_letter', 'history_json'],
  reviews: ['review_id', 'reference', 'round', 'reviewer_name', 'reviewer_email', 'scope', 'question', 'due_date', 'status',
    'invited_at', 'responded_at', 'submitted_at', 'recommendation', 'report_to_authors', 'confidential_to_editor', 'ai_use'],
  reviewers: ['email', 'name', 'key', 'created_at']
};

/* ================================================================ HTTP entry points */

function doGet(e) {
  return json_({ ok: true, service: 'AIDER editorial system' });
}

function doPost(e) {
  var p;
  try { p = JSON.parse(e.postData.contents); } catch (x) { return json_({ ok: false, error: 'Bad request' }); }
  return json_(handle_(p));
}

var ACTIONS = {
  submit: submit_, author_status: authorStatus_, author_revise: authorRevise_, author_withdraw: authorWithdraw_,
  agent_update: agentUpdate_, reviewer_view: reviewerView_, reviewer_respond: reviewerRespond_,
  reviewer_file: reviewerFile_, reviewer_submit: reviewerSubmit_
};
var READ_ONLY = ['author_status', 'reviewer_view', 'reviewer_file'];

function handle_(p) {
  var action = p.action || (p.schema === 'aider-submission/1' ? 'submit' : '');
  var fn = ACTIONS[action];
  if (!fn) return { ok: false, error: 'Unknown action' };
  var lock = null;
  try {
    if (READ_ONLY.indexOf(action) < 0) { lock = LockService.getScriptLock(); lock.waitLock(20000); }
    var out = fn(p) || {};
    out.ok = true;
    return out;
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (x) { /* ignore */ } }
  }
}

/* ================================================================ public: submit */

function submit_(p) {
  if (p.schema !== 'aider-submission/1') throw new Error('Unknown schema');
  if (!/^AIDER-\d{8}-[A-Z0-9]{6}$/.test(p.reference || '')) throw new Error('Bad reference');
  if (!p.title || !p.abstract) throw new Error('Missing title or abstract');
  if (!isArr_(p.authors) || !p.authors.length) throw new Error('Missing authors');
  if (!isArr_(p.files) || !p.files.some(function (f) { return f.role === 'main'; })) throw new Error('Missing main document');
  var c = p.confirmations || {};
  if (!(c.original && c.authors_approved && c.licence_cc_by && c.privacy)) throw new Error('Confirmations missing');
  if (findSubmission_(p.reference)) throw new Error('Duplicate reference');
  throttle_();

  var folder = saveJob_(p.reference, p.files, Object.assign({}, p, { type: 'new_submission' }));
  var corr = p.authors.filter(function (a) { return a.corresponding; })[0] || p.authors[0];
  var key = newKey_();
  var now = iso_();
  append_('submissions', {
    reference: p.reference, created_at: now, updated_at: now, status: 'submitted', title: p.title,
    article_type: p.article_type || '', subject_area: p.subject_area || '', abstract: p.abstract,
    keywords: (p.keywords || []).join(', '), corresponding_name: corr.name || '', corresponding_email: corr.email || '',
    authors_json: JSON.stringify(p.authors), editor: '', folder_id: folder.getId(), revision: 0, author_key: key,
    decision_letter: '', history_json: JSON.stringify([{ at: now, status: 'submitted', note: 'Manuscript received.' }])
  });

  mail_(cfg_('EDITORIAL_EMAIL'), '[AIDER] New submission ' + p.reference + ': ' + p.title.slice(0, 80),
    'Reference: ' + p.reference + '\nType: ' + p.article_type + '\nTitle: ' + p.title +
    '\nAuthors: ' + p.authors.map(function (a) { return a.name; }).join(', ') +
    '\nCorresponding: ' + corr.name + ' <' + corr.email + '>\nSubject area: ' + p.subject_area +
    '\n\nFolder: ' + folder.getUrl() + '\n\nThe AI agent will run the initial checks and update the status automatically.');
  if (validEmail_(corr.email)) {
    mail_(corr.email, 'Submission received: ' + p.reference,
      'Dear ' + corr.name + ',\n\nThank you for submitting your manuscript "' + p.title + '" to AI-Driven Energy Research.\n\n' +
      'Reference: ' + p.reference + '\n\nYou can follow its progress in your author dashboard:\n' + authorLink_(p.reference, key) +
      '\n\nThis link contains your private access key; please keep it safe. The editorial office will contact you after the initial checks.' +
      signature_());
  }
  return { reference: p.reference, author_key: key, dashboard_url: authorLink_(p.reference, key) };
}

/* ================================================================ author */

function authorAuth_(p) {
  var s = findSubmission_(String(p.reference || '').trim());
  if (!s || !p.key || s.author_key !== String(p.key).trim()) throw new Error('Reference or access key not recognised');
  return s;
}

function authorStatus_(p) {
  var s = authorAuth_(p);
  var history = parse_(s.history_json, []).map(function (h) {
    return { at: h.at, status: h.status, label: STATUS[h.status] || h.status, note: h.note || '' };
  });
  var round = Number(s.revision) || 0;
  var revs = reviewsFor_(s.reference).filter(function (r) { return Number(r.round) === round; });
  var decided = DECISIONS.indexOf(s.status) >= 0 || s.status === 'published';
  var reports = [];
  if (decided) {
    revs.filter(function (r) { return r.status === 'submitted'; }).forEach(function (r, i) {
      reports.push({ reviewer: 'Reviewer ' + (i + 1), scope: r.scope === 'question' ? r.question : 'Full manuscript', report: r.report_to_authors });
    });
  }
  return {
    submission: {
      reference: s.reference, title: s.title, article_type: s.article_type, subject_area: s.subject_area,
      submitted_at: s.created_at, updated_at: s.updated_at, status: s.status, status_label: STATUS[s.status] || s.status,
      revision: round, authors: parse_(s.authors_json, []).map(function (a) { return a.name; }),
      history: history,
      reviews: {
        invited: revs.filter(function (r) { return r.status; }).length,
        agreed: revs.filter(function (r) { return r.status === 'accepted' || r.status === 'submitted'; }).length,
        completed: revs.filter(function (r) { return r.status === 'submitted'; }).length
      },
      decision_letter: decided ? s.decision_letter : '',
      reports: reports,
      can_revise: s.status === 'minor_revision' || s.status === 'major_revision',
      can_withdraw: FINAL.indexOf(s.status) < 0
    }
  };
}

function authorRevise_(p) {
  var s = authorAuth_(p);
  if (!(s.status === 'minor_revision' || s.status === 'major_revision')) throw new Error('No revision has been requested');
  if (!isArr_(p.files) || !p.files.some(function (f) { return f.role === 'main'; })) throw new Error('Missing revised manuscript');
  if (!p.response_letter) throw new Error('Missing response to reviewers');
  var n = (Number(s.revision) || 0) + 1;
  var job = s.reference + '-R' + n;
  var folder = saveJob_(job, p.files, {
    schema: 'aider-submission/1', type: 'revision', reference: s.reference, revision: n, title: s.title,
    response_letter: p.response_letter, files: p.files
  });
  update_('submissions', s, { folder_id: folder.getId(), revision: n });
  setStatus_(s, 'revision_submitted', 'Revised manuscript (version ' + (n + 1) + ') received.');
  mail_(cfg_('EDITORIAL_EMAIL'), '[AIDER] Revision received ' + job + ': ' + s.title.slice(0, 80),
    'Reference: ' + s.reference + '\nRevision: ' + n + '\nFolder: ' + folder.getUrl());
  return { status: 'revision_submitted' };
}

function authorWithdraw_(p) {
  var s = authorAuth_(p);
  if (FINAL.indexOf(s.status) >= 0) throw new Error('This manuscript can no longer be withdrawn');
  setStatus_(s, 'withdrawn', 'Withdrawn by the authors.');
  mail_(cfg_('EDITORIAL_EMAIL'), '[AIDER] Withdrawn ' + s.reference, 'The authors withdrew ' + s.reference + ': ' + s.title);
  return { status: 'withdrawn' };
}

/* ================================================================ AI agent */

function agentUpdate_(p) {
  var secret = cfg_('AGENT_KEY');
  if (!secret || p.agent_key !== secret) throw new Error('Not authorised');
  var ref = String(p.reference || '').replace(/-R\d+$/, '');
  var s = findSubmission_(ref);
  if (!s) throw new Error('Unknown reference');
  var st = p.status;
  if (st === 'initial_checks' && (s.status === 'submitted' || s.status === 'revision_submitted')) {
    setStatus_(s, 'initial_checks', 'Automated initial checks started.', p.editor_note);
  } else if (st === 'checks_complete' && ['submitted', 'revision_submitted', 'initial_checks'].indexOf(s.status) >= 0) {
    setStatus_(s, 'checks_complete', 'Initial checks complete; the manuscript is waiting for an editor.', p.editor_note);
    mail_(cfg_('EDITORIAL_EMAIL'), '[AIDER] Initial checks complete ' + s.reference,
      'The AI agent finished the initial checks for ' + s.reference + ': ' + s.title + '.\n' +
      'metadata.json and screening.md are in the completed/ folder.\n' + (p.editor_note ? '\nAgent summary: ' + p.editor_note + '\n' : '') +
      '\nOpen the AIDER editorial system Sheet to assign an editor and invite reviewers.');
  } else if (st === 'failed') {
    addHistory_(s, s.status, '', 'AI agent reported a problem: ' + (p.editor_note || 'no details'));
    mail_(cfg_('EDITORIAL_EMAIL'), '[AIDER] Agent problem ' + s.reference, p.editor_note || 'The AI agent could not complete the initial checks.');
  } else {
    addHistory_(s, s.status, '', 'Agent update ignored (status ' + st + ' while ' + s.status + ')');
  }
  return { status: findSubmission_(ref).status };
}

/* ================================================================ reviewer */

function reviewerAuth_(p) {
  var key = String(p.key || '').trim();
  var r = key && rows_('reviewers').filter(function (x) { return x.key === key; })[0];
  if (!r) throw new Error('Access key not recognised');
  return r;
}

function myReview_(rv, id) {
  var r = rows_('reviews').filter(function (x) { return x.review_id === id; })[0];
  if (!r || String(r.reviewer_email).toLowerCase() !== String(rv.email).toLowerCase()) throw new Error('Review not found');
  return r;
}

function reviewerView_(p) {
  var rv = reviewerAuth_(p);
  var mine = rows_('reviews').filter(function (r) { return String(r.reviewer_email).toLowerCase() === String(rv.email).toLowerCase() && r.status; });
  var out = mine.map(function (r) {
    var s = findSubmission_(r.reference) || {};
    var item = {
      review_id: r.review_id, reference: r.reference, round: Number(r.round) || 0, title: s.title, article_type: s.article_type,
      abstract: s.abstract, keywords: s.keywords, scope: r.scope || 'full', question: r.question || '',
      due_date: r.due_date, status: r.status, invited_at: r.invited_at, submission_status: s.status
    };
    if ((r.status === 'accepted' || r.status === 'submitted') && s.folder_id) item.files = listFiles_(s.folder_id);
    if (r.status === 'submitted') item.my_report = { recommendation: r.recommendation, report_to_authors: r.report_to_authors, submitted_at: r.submitted_at };
    return item;
  });
  return { reviewer: { name: rv.name, email: rv.email }, reviews: out };
}

function reviewerRespond_(p) {
  var rv = reviewerAuth_(p);
  var r = myReview_(rv, p.review_id);
  if (r.status !== 'invited') throw new Error('This invitation has already been answered');
  var s = findSubmission_(r.reference);
  if (!s || FINAL.indexOf(s.status) >= 0) throw new Error('This manuscript is no longer under consideration');
  var accept = !!p.accept;
  update_('reviews', r, { status: accept ? 'accepted' : 'declined', responded_at: iso_() });
  if (accept && ['checks_complete', 'with_editor', 'revision_submitted', 'initial_checks', 'submitted'].indexOf(s.status) >= 0) {
    setStatus_(s, 'under_review', 'Peer review in progress.');
  }
  mail_(s.editor || cfg_('EDITORIAL_EMAIL'), '[AIDER] Reviewer ' + (accept ? 'accepted' : 'declined') + ' ' + r.review_id,
    rv.name + ' <' + rv.email + '> ' + (accept ? 'accepted' : 'declined') + ' the invitation for ' + r.reference + '.' +
    (p.reason ? '\nReason: ' + p.reason : ''));
  return { status: accept ? 'accepted' : 'declined' };
}

function reviewerFile_(p) {
  var rv = reviewerAuth_(p);
  var r = myReview_(rv, p.review_id);
  if (!(r.status === 'accepted' || r.status === 'submitted')) throw new Error('Please accept the invitation first');
  var s = findSubmission_(r.reference);
  var allowed = listFiles_(s.folder_id).map(function (f) { return f.id; });
  if (allowed.indexOf(p.file_id) < 0) throw new Error('File not available');
  var f = DriveApp.getFileById(p.file_id);
  return { name: f.getName(), mime: f.getMimeType(), base64: Utilities.base64Encode(f.getBlob().getBytes()) };
}

function reviewerSubmit_(p) {
  var rv = reviewerAuth_(p);
  var r = myReview_(rv, p.review_id);
  if (r.status !== 'accepted') throw new Error(r.status === 'submitted' ? 'This report has already been submitted' : 'Please accept the invitation first');
  if (RECOMMENDATIONS.indexOf(p.recommendation) < 0) throw new Error('Please choose a recommendation');
  if (!p.report_to_authors || String(p.report_to_authors).trim().length < 20) throw new Error('Please write your comments to the authors');
  if (!p.ai_use) throw new Error('Please state whether AI tools were used');
  update_('reviews', r, {
    status: 'submitted', submitted_at: iso_(), recommendation: p.recommendation, report_to_authors: p.report_to_authors,
    confidential_to_editor: p.confidential_to_editor || '', ai_use: p.ai_use
  });
  var s = findSubmission_(r.reference);
  mail_(s.editor || cfg_('EDITORIAL_EMAIL'), '[AIDER] Report received ' + r.review_id,
    rv.name + ' submitted a report for ' + r.reference + ' (recommendation: ' + p.recommendation + ').');
  var round = Number(s.revision) || 0;
  var revs = reviewsFor_(s.reference).filter(function (x) { return Number(x.round) === round; });
  var pending = revs.filter(function (x) { return x.status === 'accepted' || x.status === 'invited'; }).length;
  var done = revs.filter(function (x) { return x.status === 'submitted'; }).length;
  if (s.status === 'under_review' && pending === 0 && done >= 2) {
    setStatus_(s, 'reviews_complete', 'Reviewer reports received; the editor is preparing a decision.');
    mail_(s.editor || cfg_('EDITORIAL_EMAIL'), '[AIDER] All reviews complete ' + s.reference, 'Ready for a decision: ' + s.title);
  }
  return { status: 'submitted' };
}

/* ================================================================ editor console (Sheet menu) */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('AIDER')
    .addItem('Set up sheets', 'setupSheets')
    .addSeparator()
    .addItem('Assign selected submission to me', 'menuAssign')
    .addItem('Send invitations for new reviewer rows', 'menuInvite')
    .addItem('Record decision for selected submission…', 'menuDecision')
    .addItem('Mark selected submission as published', 'menuPublished')
    .addItem('Resend dashboard link (selected submission)', 'menuResendAuthor')
    .addToUi();
}

function setupSheets() { Object.keys(SHEETS).forEach(sheet_); }

function selectedReference_() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== 'submissions') throw new Error('Select a row in the "submissions" sheet first');
  var row = sh.getActiveRange().getRow();
  var ref = sh.getRange(row, 1).getValue();
  if (!ref || row === 1) throw new Error('Select a submission row');
  return ref;
}

function menuAssign() { assignEditor_(selectedReference_(), Session.getActiveUser().getEmail()); }
function menuInvite() { var n = inviteReviewers_(); SpreadsheetApp.getUi().alert(n + ' invitation(s) sent.'); }
function menuPublished() { publish_(selectedReference_()); }
function menuResendAuthor() { resendAuthor_(selectedReference_()); }
function menuDecision() {
  var ui = SpreadsheetApp.getUi(), ref = selectedReference_();
  var d = ui.prompt('Decision for ' + ref, 'Type one of: minor_revision, major_revision, accepted, rejected', ui.ButtonSet.OK_CANCEL);
  if (d.getSelectedButton() !== ui.Button.OK) return;
  var l = ui.prompt('Decision letter for ' + ref, 'This text is sent to the authors with the reviewer reports.', ui.ButtonSet.OK_CANCEL);
  if (l.getSelectedButton() !== ui.Button.OK) return;
  recordDecision_(ref, d.getResponseText().trim(), l.getResponseText());
}

function assignEditor_(ref, email) {
  var s = findSubmission_(ref);
  update_('submissions', s, { editor: email });
  if (['submitted', 'initial_checks', 'checks_complete', 'revision_submitted'].indexOf(s.status) >= 0) setStatus_(s, 'with_editor', 'Assigned to a handling editor.');
}

/** Rows added by editors to the "reviews" sheet with reference + reviewer_name + reviewer_email (+ optional scope/question/due_date)
 *  and an EMPTY status are invited. scope: "full" (default) or "question" (targeted question in the "question" column). */
function inviteReviewers_() {
  var sent = 0;
  rows_('reviews').forEach(function (r) {
    if (r.status || !r.reference || !validEmail_(r.reviewer_email)) return;
    var s = findSubmission_(r.reference);
    if (!s || FINAL.indexOf(s.status) >= 0) return;
    var rv = reviewerFor_(r.reviewer_email, r.reviewer_name);
    var id = r.review_id || (r.reference + '-V' + (reviewsFor_(r.reference).filter(function (x) { return x.review_id; }).length + 1));
    var due = r.due_date || iso_(new Date(Date.now() + REVIEW_DAYS * 864e5)).slice(0, 10);
    update_('reviews', r, { review_id: id, round: Number(s.revision) || 0, scope: r.scope || 'full', due_date: due, status: 'invited', invited_at: iso_() });
    var ask = r.scope === 'question'
      ? 'We would be grateful for your answer to one specific question about this manuscript:\n\n  ' + r.question + '\n\nThis should take much less time than a full review. You are welcome to use AI tools to help; if you do, please tell us briefly how you used them (for example, the prompts).'
      : 'We would be grateful if you could review the full manuscript by ' + due + '.';
    mail_(r.reviewer_email, 'Invitation to review for AI-Driven Energy Research: ' + s.title.slice(0, 80),
      'Dear ' + (r.reviewer_name || 'colleague') + ',\n\nThe editors of AI-Driven Energy Research invite you to help assess the manuscript\n\n  "' + s.title + '"\n\n' +
      ask + '\n\nAbstract:\n' + s.abstract + '\n\nPlease accept or decline in your reviewer dashboard:\n' + reviewerLink_(rv.key) +
      '\n\nIf you have a conflict of interest, please decline. Thank you for supporting open, reproducible research.' + signature_());
    sent++;
  });
  return sent;
}

function recordDecision_(ref, code, letter) {
  if (DECISIONS.indexOf(code) < 0) throw new Error('Unknown decision: ' + code);
  var s = findSubmission_(ref);
  update_('submissions', s, { decision_letter: letter || '' });
  setStatus_(findSubmission_(ref), code, 'Editorial decision: ' + STATUS[code].replace('Decision: ', '') + '.');
  if (validEmail_(s.corresponding_email)) {
    mail_(s.corresponding_email, 'Decision on your manuscript ' + ref,
      'Dear ' + s.corresponding_name + ',\n\nA decision has been made on your manuscript "' + s.title + '": ' + STATUS[code].replace('Decision: ', '') +
      '.\n\nThe decision letter and reviewer reports are in your author dashboard:\n' + authorLink_(ref, s.author_key) + signature_());
  }
}

function publish_(ref) {
  var s = findSubmission_(ref);
  if (s.status !== 'accepted') throw new Error('Only accepted manuscripts can be marked as published');
  setStatus_(s, 'published', 'Published in AI-Driven Energy Research.');
}

function resendAuthor_(ref) {
  var s = findSubmission_(ref);
  mail_(s.corresponding_email, 'Your AIDER author dashboard: ' + ref, 'Dear ' + s.corresponding_name + ',\n\nYour author dashboard for "' + s.title + '":\n' + authorLink_(ref, s.author_key) + signature_());
}

/* ================================================================ helpers: status */

function setStatus_(s, status, note, editorNote) {
  addHistory_(s, status, note, editorNote);
  update_('submissions', findSubmission_(s.reference), { status: status, updated_at: iso_() });
}

function addHistory_(s, status, note, editorNote) {
  var fresh = findSubmission_(s.reference);
  var h = parse_(fresh.history_json, []);
  var item = { at: iso_(), status: status };
  if (note) item.note = note;
  if (editorNote) item.editor_note = String(editorNote).slice(0, 2000);
  h.push(item);
  update_('submissions', fresh, { history_json: JSON.stringify(h), updated_at: iso_() });
}

/* ================================================================ helpers: Drive */

function saveJob_(name, files, record) {
  var total = files.reduce(function (n, f) { return n + (Number(f.size) || 0); }, 0);
  if (total > MAX_BYTES) throw new Error('Files exceed the size limit');
  var root = DriveApp.getFolderById(cfg_('UPLOAD_FOLDER_ID'));
  if (root.getFoldersByName(name).hasNext()) throw new Error('Duplicate job ' + name);
  var folder = root.createFolder(name);
  files.forEach(function (f) {
    var safe = String(f.name || 'file').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150);
    var prefix = f.role === 'main' ? 'main__' : 'supp__';
    folder.createFile(Utilities.newBlob(Utilities.base64Decode(f.base64), f.mime || 'application/octet-stream', prefix + safe));
  });
  var rec = Object.assign({}, record, {
    files: files.map(function (f) { return { name: f.name, role: f.role, mime: f.mime, size: f.size }; }),
    received_at: iso_()
  });
  // written LAST: the Codex watcher treats submission.json as "upload complete"
  folder.createFile('submission.json', JSON.stringify(rec, null, 2), MimeType.PLAIN_TEXT);
  return folder;
}

function listFiles_(folderId) {
  var out = [], it = DriveApp.getFolderById(folderId).getFiles();
  while (it.hasNext()) {
    var f = it.next(), n = f.getName();
    if (n === 'submission.json') continue;
    out.push({ id: f.getId(), name: n.replace(/^(main|supp)__/, ''), role: /^main__/.test(n) ? 'main' : 'supplementary', size: f.getSize() });
  }
  return out;
}

/* ================================================================ helpers: Sheet */

function book_() {
  var id = cfg_('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var b = book_(), sh = b.getSheetByName(name);
  if (!sh) { sh = b.insertSheet(name); sh.appendRow(SHEETS[name]); }
  return sh;
}

function rows_(name) {
  var values = sheet_(name).getDataRange().getValues();
  var head = values[0] || SHEETS[name];
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _row: i + 1, _sheet: name };
    head.forEach(function (h, j) { o[h] = values[i][j] === undefined ? '' : values[i][j]; });
    out.push(o);
  }
  return out;
}

function append_(name, obj) {
  sheet_(name).appendRow(SHEETS[name].map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
}

function update_(name, rowObj, changes) {
  var sh = sheet_(name), head = sh.getDataRange().getValues()[0];
  Object.keys(changes).forEach(function (k) {
    var col = head.indexOf(k);
    if (col < 0) throw new Error('Unknown column ' + k);
    sh.getRange(rowObj._row, col + 1).setValue(changes[k]);
    rowObj[k] = changes[k];
  });
}

function findSubmission_(ref) { return rows_('submissions').filter(function (s) { return s.reference === ref; })[0] || null; }
function reviewsFor_(ref) { return rows_('reviews').filter(function (r) { return r.reference === ref; }); }

function reviewerFor_(email, name) {
  var r = rows_('reviewers').filter(function (x) { return String(x.email).toLowerCase() === String(email).toLowerCase(); })[0];
  if (r) return r;
  var obj = { email: email, name: name || '', key: newKey_(), created_at: iso_() };
  append_('reviewers', obj);
  return obj;
}

/* ================================================================ helpers: misc */

function cfg_(k) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v && k === 'SITE_URL') return SITE_URL_DEFAULT;
  if (!v && (k === 'UPLOAD_FOLDER_ID' || k === 'EDITORIAL_EMAIL')) throw new Error('Server not configured: ' + k);
  return v;
}
function authorLink_(ref, key) { return cfg_('SITE_URL') + '/dashboard.html#ref=' + encodeURIComponent(ref) + '&key=' + encodeURIComponent(key); }
function reviewerLink_(key) { return cfg_('SITE_URL') + '/review.html#key=' + encodeURIComponent(key); }
function signature_() { return '\n\nEditorial Office\nAI-Driven Energy Research (ISSN 2979-8639)\n' + cfg_('SITE_URL'); }
function newKey_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40); }
function iso_(d) { return (d || new Date()).toISOString(); }
function isArr_(x) { return Object.prototype.toString.call(x) === '[object Array]'; }
function validEmail_(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '')); }
function parse_(s, d) { try { return s ? JSON.parse(s) : d; } catch (x) { return d; } }

function mail_(to, subject, body) {
  if (!validEmail_(to)) return;
  MailApp.sendEmail({ to: to, subject: subject, body: body, name: 'AI-Driven Energy Research', replyTo: cfg_('EDITORIAL_EMAIL') });
}

function throttle_() {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get('submits') || 0) + 1;
  if (n > MAX_SUBMITS_PER_10_MIN) throw new Error('Too many submissions; please try again later');
  cache.put('submits', String(n), 600);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
