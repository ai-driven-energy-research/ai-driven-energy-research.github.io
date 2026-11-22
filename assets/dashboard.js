/* AIDER author dashboard */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var esc = window.aiderEsc, fmt = window.aiderDate;
  var KEY = 'aider-author-manuscripts';
  var current = null;

  function saved() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function remember(ref, key, title) {
    try {
      var l = saved().filter(function (m) { return m.ref !== ref; });
      l.unshift({ ref: ref, key: key, title: title });
      localStorage.setItem(KEY, JSON.stringify(l.slice(0, 20)));
    } catch (e) { /* ignore */ }
  }
  function renderSaved() {
    var l = saved();
    if (!l.length) { $('#saved').innerHTML = ''; return; }
    $('#saved').innerHTML = '<h2>Manuscripts on this device</h2><table><tr><th>Reference</th><th>Title</th><th></th></tr>' +
      l.map(function (m, i) { return '<tr><td>' + esc(m.ref) + '</td><td>' + esc(m.title || '') + '</td><td><button type="button" class="linkbtn" data-i="' + i + '">Open</button></td></tr>'; }).join('') + '</table>';
    Array.prototype.forEach.call(document.querySelectorAll('#saved [data-i]'), function (b) {
      b.onclick = function () { var m = saved()[+b.dataset.i]; open(m.ref, m.key); };
    });
  }

  async function open(ref, key) {
    $('#d-msg').textContent = 'Loading…';
    try {
      var j = await window.aiderCall('author_status', { reference: ref, key: key });
      current = { ref: ref, key: key };
      remember(ref, key, j.submission.title);
      $('#d-msg').textContent = '';
      render(j.submission);
    } catch (e) { $('#d-msg').textContent = e.message; }
  }

  var STEPS = [['submitted', 'Submitted'], ['checks', 'Initial checks'], ['editor', 'With editor'], ['review', 'Under review'], ['decision', 'Decision']];
  function stage(st) {
    if (st === 'submitted' || st === 'revision_submitted') return 0;
    if (st === 'initial_checks' || st === 'checks_complete') return 1;
    if (st === 'with_editor') return 2;
    if (st === 'under_review' || st === 'reviews_complete') return 3;
    return 4;
  }

  function render(s) {
    $('#login').hidden = true;
    var at = stage(s.status);
    var html = '<p><button type="button" class="linkbtn" id="back">&larr; All manuscripts</button></p>' +
      '<h2 style="margin-top:4px">' + esc(s.title) + '</h2>' +
      '<table><tr><th style="width:28%">Reference</th><td>' + esc(s.reference) + (s.revision ? ' (version ' + (s.revision + 1) + ')' : '') + '</td></tr>' +
      '<tr><th>Article type</th><td>' + esc(s.article_type) + '</td></tr>' +
      '<tr><th>Authors</th><td>' + esc(s.authors.join(', ')) + '</td></tr>' +
      '<tr><th>Submitted</th><td>' + fmt(s.submitted_at) + '</td></tr>' +
      '<tr><th>Current status</th><td><b>' + esc(s.status_label) + '</b> <span class="small">(updated ' + fmt(s.updated_at) + ')</span></td></tr></table>' +
      '<ol class="steps">' + STEPS.map(function (x, i) { return '<li class="' + (i < at ? 'done' : i === at ? 'current' : '') + '"><b>Stage ' + (i + 1) + '</b>' + x[1] + '</li>'; }).join('') + '</ol>' +
      '<h3>Peer review progress</h3><p>Reviewers invited: <b>' + s.reviews.invited + '</b> &middot; agreed: <b>' + s.reviews.agreed + '</b> &middot; reports received: <b>' + s.reviews.completed + '</b></p>';
    if (s.decision_letter || s.reports.length) {
      html += '<h3>Decision letter</h3><div class="notice"><p style="white-space:pre-wrap">' + esc(s.decision_letter || '(no letter)') + '</p></div>';
      s.reports.forEach(function (r) {
        html += '<h4>' + esc(r.reviewer) + (r.scope && r.scope !== 'Full manuscript' ? ': ' + esc(r.scope) : '') + '</h4><p style="white-space:pre-wrap">' + esc(r.report) + '</p>';
      });
    }
    html += '<h3>Status history</h3><table><tr><th style="width:22%">Date</th><th style="width:30%">Status</th><th>Note</th></tr>' +
      s.history.slice().reverse().map(function (h) { return '<tr><td>' + fmt(h.at) + '</td><td>' + esc(h.label) + '</td><td>' + esc(h.note) + '</td></tr>'; }).join('') + '</table>';
    if (s.can_revise) {
      html += '<h3>Submit a revised manuscript</h3>' +
        '<div class="form-row"><label>Revised manuscript (main document) <span class="req">*</span></label><input type="file" id="r-main" accept=".pdf,.docx,.zip,.tex"></div>' +
        '<div class="form-row"><label>Other files (optional: marked-up version, supplementary files)</label><input type="file" id="r-supp" multiple></div>' +
        '<div class="form-row"><label>Response to reviewers <span class="req">*</span></label><textarea id="r-resp" rows="8" placeholder="Point-by-point response to each reviewer comment"></textarea></div>' +
        '<p><button type="button" class="btn" id="r-send">Submit revision</button> <span class="small" id="r-msg"></span></p>';
    }
    if (s.can_withdraw) html += '<hr><p class="small">To withdraw this manuscript from consideration: <button type="button" class="linkbtn" id="withdraw">Withdraw manuscript</button></p>';
    var v = $('#view'); v.innerHTML = html; v.hidden = false;
    $('#back').onclick = function () { v.hidden = true; $('#login').hidden = false; renderSaved(); history.replaceState(null, '', location.pathname); };
    if (s.can_revise) $('#r-send').onclick = revise;
    if (s.can_withdraw) $('#withdraw').onclick = withdraw;
  }

  async function revise() {
    var main = $('#r-main').files[0], supp = Array.prototype.slice.call($('#r-supp').files), resp = $('#r-resp').value.trim();
    if (!main || !resp) { $('#r-msg').textContent = 'Please add the revised manuscript and your response to reviewers.'; return; }
    var all = [main].concat(supp), total = all.reduce(function (n, f) { return n + f.size; }, 0);
    if (total > 25 * 1048576) { $('#r-msg').textContent = 'Files exceed 25 MB in total.'; return; }
    $('#r-msg').textContent = 'Uploading…'; $('#r-send').disabled = true;
    try {
      var files = [];
      for (var i = 0; i < all.length; i++) files.push({ name: all[i].name, role: i === 0 ? 'main' : 'supplementary', mime: all[i].type || 'application/octet-stream', size: all[i].size, base64: await window.aiderFileToB64(all[i]) });
      await window.aiderCall('author_revise', { reference: current.ref, key: current.key, files: files, response_letter: resp });
      open(current.ref, current.key);
    } catch (e) { $('#r-msg').textContent = e.message; $('#r-send').disabled = false; }
  }

  async function withdraw() {
    if (!confirm('Withdraw this manuscript? This cannot be undone.')) return;
    try { await window.aiderCall('author_withdraw', { reference: current.ref, key: current.key }); open(current.ref, current.key); }
    catch (e) { alert(e.message); }
  }

  function init() {
    if (!window.AIDER_API) { $('#offline').hidden = false; }
    renderSaved();
    $('#d-open').onclick = function () { open($('#d-ref').value.trim(), $('#d-key').value.trim()); };
    var h = window.aiderHash();
    if (h.ref && h.key && window.AIDER_API) { $('#d-ref').value = h.ref; $('#d-key').value = h.key; open(h.ref, h.key); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
