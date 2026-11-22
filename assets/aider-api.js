/* AIDER editorial system: shared configuration and API helper.
 * AIDER_API is the deployed Google Apps Script web-app URL (see _docs/integration-guide-codex-drive.md).
 * While it is empty, the submission form falls back to email and the dashboards show a notice. */
window.AIDER_API = '';
window.AIDER_EMAIL = 'jianou.jiang@eng.ox.ac.uk';

window.aiderCall = async function (action, params) {
  if (!window.AIDER_API) throw new Error('The online editorial system is not connected yet.');
  var r = await fetch(window.AIDER_API, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action: action }, params || {}))
  });
  var j;
  try { j = await r.json(); } catch (e) { throw new Error('Unexpected response from the editorial system.'); }
  if (!j.ok) throw new Error(j.error || 'Request failed.');
  return j;
};

window.aiderEsc = function (t) {
  return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
};
window.aiderDate = function (iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
window.aiderHash = function () {
  var o = {};
  location.hash.replace(/^#/, '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) o[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
  return o;
};
window.aiderFileToB64 = function (file) {
  return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(file); });
};
