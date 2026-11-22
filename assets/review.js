/* AIDER reviewer dashboard */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = window.aiderEsc, fmt = window.aiderDate;
  var key = '';
  var REC = [['', 'Select…'], ['accept', 'Accept'], ['minor_revision', 'Minor revision'], ['major_revision', 'Major revision'], ['reject', 'Reject'], ['answer_only', 'No recommendation (answering the specific question only)']];

  async function load() {
    $('#v-msg').textContent = 'Loading…';
    try {
      var j = await window.aiderCall('reviewer_view', { key: key });
      $('#v-msg').textContent = '';
      try { localStorage.setItem('aider-reviewer-key', key); } catch (e) { /* ignore */ }
      render(j);
    } catch (e) { $('#v-msg').textContent = e.message; $('#login').hidden = false; $('#view').hidden = true; }
  }

  function task(r) {
    return r.scope === 'question' ? '<p><b>Your question:</b> ' + esc(r.question) + '</p>' : '<p><b>Task:</b> review of the full manuscript.</p>';
  }
  function head(r) {
    return '<p class="small">' + esc(r.reference) + (r.round ? ' &middot; revised version ' + (r.round + 1) : '') + ' &middot; ' + esc(r.article_type || '') + ' &middot; due ' + esc(r.due_date || '') + '</p>' +
      '<h3 style="margin-top:2px">' + esc(r.title) + '</h3>';
  }

  function render(j) {
    $('#login').hidden = true;
    var inv = j.reviews.filter(function (r) { return r.status === 'invited'; });
    var act = j.reviews.filter(function (r) { return r.status === 'accepted'; });
    var done = j.reviews.filter(function (r) { return r.status === 'submitted' || r.status === 'declined'; });
    var h = '<p>Signed in as <b>' + esc(j.reviewer.name || j.reviewer.email) + '</b> (' + esc(j.reviewer.email) + ')</p>';

    h += '<div class="section-head"><h2>Invitations awaiting your response (' + inv.length + ')</h2></div>';
    h += inv.length ? inv.map(function (r) {
      return '<div class="article" data-id="' + esc(r.review_id) + '">' + head(r) + task(r) +
        '<details><summary class="small">Abstract</summary><p>' + esc(r.abstract) + '</p></details>' +
        '<p><button type="button" class="btn act-accept">Agree to review</button> <button type="button" class="btn secondary act-decline">Decline</button></p></div>';
    }).join('') : '<p class="small">None.</p>';

    h += '<div class="section-head"><h2>Reviews in progress (' + act.length + ')</h2></div>';
    h += act.length ? act.map(function (r) {
      return '<div class="article" data-id="' + esc(r.review_id) + '">' + head(r) + task(r) +
        '<details><summary class="small">Abstract</summary><p>' + esc(r.abstract) + '</p></details>' +
        '<p class="small"><b>Files:</b> ' + (r.files || []).map(function (f) { return '<button type="button" class="linkbtn dl" data-file="' + esc(f.id) + '">' + esc(f.name) + '</button> (' + (f.size / 1048576).toFixed(1) + ' MB)'; }).join(' &middot; ') + '</p>' +
        '<div class="form-row"><label>Recommendation <span class="req">*</span></label><select class="f-rec">' + REC.map(function (x) { return '<option value="' + x[0] + '">' + x[1] + '</option>'; }).join('') + '</select></div>' +
        '<div class="form-row"><label>' + (r.scope === 'question' ? 'Your answer (shared with the authors)' : 'Comments to the authors') + ' <span class="req">*</span></label><textarea class="f-report" rows="10"></textarea></div>' +
        '<div class="form-row"><label>Confidential comments to the editor</label><textarea class="f-conf" rows="3"></textarea></div>' +
        '<div class="form-row"><label>Use of AI tools <span class="req">*</span></label><textarea class="f-ai" rows="3" placeholder="Which tools you used and how, including prompts if possible; or \'No AI tools were used.\'"></textarea></div>' +
        '<p><button type="button" class="btn act-submit">Submit report</button> <span class="small msg"></span></p></div>';
    }).join('') : '<p class="small">None.</p>';

    h += '<div class="section-head"><h2>Completed and declined</h2></div>';
    h += done.length ? '<table><tr><th>Reference</th><th>Title</th><th>Status</th></tr>' + done.map(function (r) {
      return '<tr><td>' + esc(r.reference) + '</td><td>' + esc(r.title) + '</td><td>' + (r.status === 'submitted' ? 'Report submitted ' + fmt(r.my_report && r.my_report.submitted_at) : 'Declined') + '</td></tr>';
    }).join('') + '</table>' : '<p class="small">None.</p>';

    var v = $('#view'); v.innerHTML = h; v.hidden = false;
    Array.prototype.forEach.call(v.querySelectorAll('.article'), wire);
  }

  function wire(box) {
    var id = box.dataset.id;
    var a = $('.act-accept', box), d = $('.act-decline', box), s = $('.act-submit', box);
    if (a) a.onclick = function () { respond(id, true); };
    if (d) d.onclick = function () { var why = prompt('Optional: reason for declining (e.g. conflict of interest, outside expertise, no time). Suggestions of other reviewers are welcome.') ; if (why !== null) respond(id, false, why); };
    Array.prototype.forEach.call(box.querySelectorAll('.dl'), function (b) { b.onclick = function () { download(id, b.dataset.file, b); }; });
    if (s) s.onclick = async function () {
      var msg = $('.msg', box);
      var body = { key: key, review_id: id, recommendation: $('.f-rec', box).value, report_to_authors: $('.f-report', box).value.trim(), confidential_to_editor: $('.f-conf', box).value.trim(), ai_use: $('.f-ai', box).value.trim() };
      if (!body.recommendation || body.report_to_authors.length < 20 || !body.ai_use) { msg.textContent = 'Please complete the recommendation, comments and AI-use statement.'; return; }
      if (!confirm('Submit this report? It cannot be edited afterwards.')) return;
      s.disabled = true; msg.textContent = 'Submitting…';
      try { await window.aiderCall('reviewer_submit', body); load(); } catch (e) { msg.textContent = e.message; s.disabled = false; }
    };
  }

  async function respond(id, accept, reason) {
    try { await window.aiderCall('reviewer_respond', { key: key, review_id: id, accept: accept, reason: reason || '' }); load(); }
    catch (e) { alert(e.message); }
  }

  async function download(id, fileId, btn) {
    var label = btn.textContent; btn.textContent = 'Downloading…';
    try {
      var j = await window.aiderCall('reviewer_file', { key: key, review_id: id, file_id: fileId });
      var bin = atob(j.base64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([bytes], { type: j.mime || 'application/octet-stream' }));
      var a = document.createElement('a'); a.href = url; a.download = j.name.replace(/^(main|supp)__/, ''); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    } catch (e) { alert(e.message); }
    btn.textContent = label;
  }

  function init() {
    if (!window.AIDER_API) { $('#offline').hidden = false; }
    var h = window.aiderHash(), stored = '';
    try { stored = localStorage.getItem('aider-reviewer-key') || ''; } catch (e) { /* ignore */ }
    $('#v-open').onclick = function () { key = $('#v-key').value.trim(); if (key) load(); };
    key = h.key || stored;
    if (key && window.AIDER_API) { $('#v-key').value = key; load(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
