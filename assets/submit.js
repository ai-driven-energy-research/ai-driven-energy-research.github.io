/* AIDER online submission system.
 *
 * Seven-step form in the style of conventional manuscript systems. The uploaded
 * manuscript is read in the browser to pre-fill title, abstract, authors and
 * keywords (no file leaves the browser until the author presses Submit).
 *
 * Delivery: if SUBMIT_ENDPOINT is set, the submission (metadata + files, base64)
 * is POSTed there as JSON — see _docs/integration-guide-codex-drive.md. If it is
 * empty, the author is given an email to the editorial office instead.
 */
(function () {
  'use strict';

  var CONFIG = {
    SUBMIT_ENDPOINT: '',            // e.g. Google Apps Script web-app URL
    EDITORIAL_EMAIL: 'jianou.jiang@eng.ox.ac.uk',
    MAX_MAIN_MB: 20,
    MAX_TOTAL_MB: 25,
    STORE_KEY: 'aider-submission-draft-v1'
  };
  window.AIDER_SUBMIT_CONFIG = CONFIG;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var state = { step: 1, mainFile: null, suppFiles: [], prefilled: [], extraction: null };
  var TOTAL = 7;

  /* ---------------------------------------------------------- utilities */
  function clean(t) {
    return (t || '').replace(/­/g, '').replace(/(\w)-\s*\n\s*(\w)/g, '$1$2')
      .replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').trim();
  }
  function oneLine(t) { return clean(t).replace(/\s*\n\s*/g, ' ').trim(); }
  function words(t) { t = (t || '').trim(); return t ? t.split(/\s+/).length : 0; }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mb(n) { return (n / 1048576).toFixed(1) + ' MB'; }
  function ref() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    var r = Math.random().toString(36).slice(2, 8).toUpperCase();
    return 'AIDER-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + r;
  }
  function store(save) {
    try {
      if (save) localStorage.setItem(CONFIG.STORE_KEY, JSON.stringify(save));
      else return JSON.parse(localStorage.getItem(CONFIG.STORE_KEY) || 'null');
    } catch (e) { return null; }
  }

  /* ---------------------------------------------------------- extraction */
  var STOP_ABS = /\n\s*(?:keywords?|key\s*words|index\s+terms|highlights|(?:1|I)\.?\s+introduction|introduction|nomenclature|graphical abstract)\b/i;

  var FOOTER_LINE = /corresponding author|preprint submitted to|e-?mail address|under review at|^\s*[\u2217*]\s/i;

  function fromText(text) {
    var out = {};
    var t = '\n' + clean(text) + '\n';
    var a = t.match(/\n\s*abstract\s*[:.—–-]?\s*/i);
    if (a) {
      var rest = t.slice(a.index + a[0].length);
      var stop = rest.search(STOP_ABS);
      var abs = oneLine(stop > 0 ? rest.slice(0, stop) : rest.slice(0, 3000));
      if (words(abs) > 400) abs = abs.split(/\s+/).slice(0, 400).join(' ');
      if (words(abs) >= 30) out.abstract = abs;
    }
    var k = t.match(/\n\s*(?:keywords?|key\s*words|index\s+terms)\s*[:.—–-]?\s*([\s\S]{3,400}?)(?:\n\s*\n|\n\s*(?:(?:1|I)\.?\s+)?introduction\b|\n\s*(?:highlights|nomenclature|abstract)\b|$)/i);
    if (k) {
      var kw = oneLine(k[1]).split(/\s*[;,·•]\s*|\s+–\s+|\s{2,}/).map(function (s) { return s.replace(/\.$/, '').trim(); })
        .filter(function (s) { return s && s.length < 60 && s.split(/\s+/).length <= 6; });
      if (kw.length) out.keywords = kw.slice(0, 8);
    }
    return out;
  }

  function splitAuthors(line) {
    line = line.replace(/[\d*†‡§¶‖#]+/g, ' ').replace(/\s+/g, ' ');
    return line.split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*|\s*·\s*|\s*;\s*/i)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return /^[A-Z][\p{L}.'\- ]{1,60}$/u.test(s) && s.split(' ').length >= 2 && s.split(' ').length <= 5 && !/\.$/.test(s) && !/universit|department|institute|school|college|laborator|academy|centre|center/i.test(s); });
  }

  async function extractPdf(buf) {
    if (!window.pdfjsLib) throw new Error('PDF reader not loaded');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    var pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    var pages = Math.min(pdf.numPages, 2), lines1 = [], all = '';
    for (var p = 1; p <= pages; p++) {
      var page = await pdf.getPage(p);
      var tc = await page.getTextContent();
      var rows = {};
      tc.items.forEach(function (it) {
        if (!it.str || !it.str.trim()) return;
        var y = Math.round(it.transform[5]);
        var size = Math.round(Math.abs(it.transform[3]) * 10) / 10 || it.height;
        var key = Object.keys(rows).find(function (ky) { return Math.abs(ky - y) <= 2; });
        if (key === undefined) { key = y; rows[key] = { y: y, items: [] }; }
        rows[key].items.push({ x: it.transform[4], s: it.str, size: size });
      });
      var ordered = Object.keys(rows).map(function (k) { return rows[k]; }).sort(function (a, b) { return b.y - a.y; });
      ordered.forEach(function (r) {
        r.items.sort(function (a, b) { return a.x - b.x; });
        var text = r.items.map(function (i) { return i.s; }).join(' ').replace(/\s+/g, ' ').trim();
        var size = Math.max.apply(null, r.items.map(function (i) { return i.size; }));
        if (FOOTER_LINE.test(text) || /^\d{1,3}$/.test(text)) return; // footnotes, running footers, page numbers
        if (p === 1) lines1.push({ text: text, size: size, y: r.y });
        all += text + '\n';
      });
      all += '\n';
    }
    var out = fromText(all);
    // title = largest font on page 1 (ignoring very short lines), consecutive lines of that size
    var cands = lines1.filter(function (l) { return l.text.length > 3 && !/^(arxiv|preprint|doi|journal|vol\.|page)/i.test(l.text); });
    if (cands.length) {
      var max = Math.max.apply(null, cands.map(function (l) { return l.size; }));
      var idx = lines1.findIndex(function (l) { return l.size === max && l.text.length > 3; });
      var title = [];
      for (var i = idx; i < lines1.length && Math.abs(lines1[i].size - max) < 0.6; i++) title.push(lines1[i].text);
      var tt = oneLine(title.join('\n').replace(/([a-z])-\n([a-z])/g, '$1$2'));
      if (tt.length > 8 && tt.length < 400) out.title = tt;
      // authors = next lines after title, before affiliations / abstract
      var authors = [];
      for (var j = idx + title.length; j < Math.min(lines1.length, idx + title.length + 4); j++) {
        var ln = lines1[j].text;
        if (/abstract|@|universit|department|institute|school of|laborator/i.test(ln)) break;
        authors = authors.concat(splitAuthors(ln));
      }
      if (authors.length) out.authors = authors.slice(0, 30);
    }
    return out;
  }

  async function extractDocx(buf) {
    if (!window.mammoth) throw new Error('Word reader not loaded');
    var res = await window.mammoth.convertToHtml({ arrayBuffer: buf });
    var div = document.createElement('div'); div.innerHTML = res.value;
    var blocks = $$('h1,h2,h3,p', div).map(function (e) { return { tag: e.tagName, text: oneLine(e.textContent) }; })
      .filter(function (b) { return b.text; });
    var text = blocks.map(function (b) { return b.text; }).join('\n');
    var out = fromText(text);
    var tIdx = blocks.findIndex(function (b) { return b.tag === 'H1'; });
    if (tIdx < 0 || tIdx > 4) tIdx = blocks.findIndex(function (b) { return b.text.length > 10 && b.text.length < 300; });
    if (tIdx >= 0) {
      out.title = blocks[tIdx].text;
      var authors = [];
      for (var j = tIdx + 1; j < Math.min(blocks.length, tIdx + 4); j++) {
        if (/^abstract|@|universit|department|institute/i.test(blocks[j].text)) break;
        authors = authors.concat(splitAuthors(blocks[j].text));
      }
      if (authors.length) out.authors = authors;
    }
    return out;
  }

  function braced(src, cmd) {
    var i = src.search(new RegExp('\\\\' + cmd + '\\s*(\\[[^\\]]*\\])?\\s*\\{'));
    if (i < 0) return null;
    i = src.indexOf('{', i);
    var depth = 0, j = i;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (!depth) break; }
    }
    return src.slice(i + 1, j);
  }
  function detex(s) {
    return oneLine((s || '').replace(/(^|[^\\])%.*$/gm, '$1').replace(/\\\\/g, ' ')
      .replace(/\\(thanks|footnote|inst|affil|affiliation|orcidlink|corref|fnref|tnoteref)\s*(\[[^\]]*\])?\{[^{}]*\}/g, '')
      .replace(/\\(textbf|textit|emph|mathrm|text)\{([^{}]*)\}/g, '$2')
      .replace(/\$([^$]*)\$/g, '$1').replace(/\\[a-zA-Z]+\*?/g, ' ').replace(/[{}~]/g, ' '));
  }
  function newcmd(src, name) {
    var key = '\\newcommand{\\' + name + '}', i = src.indexOf(key);
    if (i < 0) return null;
    i = src.indexOf('{', i + key.length);
    var depth = 0, j = i;
    for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (!depth) break; } }
    return src.slice(i + 1, j);
  }
  function extractTex(src) {
    var out = {};
    var t = braced(src, 'title') || newcmd(src, 'papertitle'); if (t) out.title = detex(t);
    var pa = newcmd(src, 'paperauthors');
    if (pa) out.authors = pa.replace(/\$\^\{?[^$]*\}?\$/g, '').split(/,|\\and|\band\b/).map(detex).filter(Boolean);
    var pk = newcmd(src, 'paperkeywords'); if (pk) out.keywords = pk.split(/,|;/).map(detex).filter(Boolean);
    var abs = src.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/) || [null, braced(src, 'abstract')];
    if (abs[1]) out.abstract = detex(abs[1]);
    var kw = src.match(/\\begin\{keywords?\}([\s\S]*?)\\end\{keywords?\}/);
    var kws = kw ? kw[1] : (braced(src, 'keywords') || braced(src, 'keyword'));
    if (kws && !out.keywords) out.keywords = kws.split(/\\sep|,|;/).map(detex).filter(Boolean).slice(0, 8);
    var authors = [], re = /\\author\s*(\[[^\]]*\])?\s*\{/g, m;
    while ((m = re.exec(src))) {
      var body = braced(src.slice(m.index), 'author');
      (body || '').split(/\\and|,|\band\b/).forEach(function (a) { a = detex(a); if (a && a.length < 60) authors.push(a); });
    }
    if (authors.length) out.authors = authors;
    return out;
  }

  async function extractZip(buf) {
    if (!window.JSZip) throw new Error('Zip reader not loaded');
    var zip = await window.JSZip.loadAsync(buf);
    var names = Object.keys(zip.files).filter(function (n) { return !zip.files[n].dir && !/__MACOSX/.test(n); });
    for (var i = 0; i < names.length; i++) {
      if (/\.tex$/i.test(names[i])) {
        var src = await zip.file(names[i]).async('string');
        if (/\\documentclass/.test(src) && /\\begin\{document\}/.test(src)) return Object.assign(extractTex(src), { from: names[i] });
      }
    }
    var docx = names.find(function (n) { return /\.docx$/i.test(n); });
    if (docx) return Object.assign(await extractDocx(await zip.file(docx).async('arraybuffer')), { from: docx });
    var pdf = names.find(function (n) { return /\.pdf$/i.test(n); });
    if (pdf) return Object.assign(await extractPdf(await zip.file(pdf).async('arraybuffer')), { from: pdf });
    return {};
  }

  async function extract(file) {
    var buf = await file.arrayBuffer();
    var n = file.name.toLowerCase();
    if (n.endsWith('.pdf')) return extractPdf(buf);
    if (n.endsWith('.docx')) return extractDocx(buf);
    if (n.endsWith('.tex')) return extractTex(new TextDecoder().decode(buf));
    if (n.endsWith('.zip')) return extractZip(buf);
    return {};
  }
  window.AIDER_extract = extract; // exposed for testing

  /* ---------------------------------------------------------- authors UI */
  function authorCard(a, i) {
    a = a || {};
    var d = document.createElement('div');
    d.className = 'author-card';
    d.innerHTML = '<div class="head"><span>Author ' + (i + 1) + '</span><button type="button" class="linkbtn rm">Remove</button></div>' +
      '<div class="form-grid">' +
      '<div class="form-row"><label>Full name <span class="req">*</span></label><input type="text" data-k="name" required></div>' +
      '<div class="form-row"><label>Email <span class="req">*</span></label><input type="email" data-k="email" required></div>' +
      '<div class="form-row"><label>Affiliation <span class="req">*</span></label><input type="text" data-k="affiliation" required></div>' +
      '<div class="form-row"><label>Country <span class="req">*</span></label><input type="text" data-k="country" required></div>' +
      '<div class="form-row"><label>ORCID</label><input type="text" data-k="orcid" placeholder="0000-0000-0000-0000"></div>' +
      '<div class="form-row check" style="align-self:end"><label><input type="radio" name="corresponding" data-k="corresponding"> Corresponding author</label></div>' +
      '</div>';
    $$('input[data-k]', d).forEach(function (inp) {
      var k = inp.dataset.k;
      if (inp.type === 'radio') inp.checked = !!a[k]; else inp.value = a[k] || '';
      if (a._prefilled && k === 'name' && a.name) inp.classList.add('prefilled');
    });
    $('.rm', d).onclick = function () { d.remove(); renumber(); save(); };
    return d;
  }
  function renumber() { $$('#authors .author-card').forEach(function (c, i) { $('.head span', c).textContent = 'Author ' + (i + 1); }); }
  function getAuthors() {
    return $$('#authors .author-card').map(function (c) {
      var a = {};
      $$('input[data-k]', c).forEach(function (inp) { a[inp.dataset.k] = inp.type === 'radio' ? inp.checked : inp.value.trim(); });
      return a;
    });
  }
  function setAuthors(list) {
    var box = $('#authors'); box.innerHTML = '';
    (list && list.length ? list : [{ corresponding: true }]).forEach(function (a, i) { box.appendChild(authorCard(a, i)); });
  }

  /* ---------------------------------------------------------- form state */
  function fields() {
    var f = $('#subform'), o = {};
    $$('input[name],select[name],textarea[name]', f).forEach(function (el) {
      if (el.name === 'corresponding') return;
      o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    });
    o.authors = getAuthors();
    return o;
  }
  function restore(o) {
    if (!o) return;
    $$('#subform input[name],#subform select[name],#subform textarea[name]').forEach(function (el) {
      if (!(el.name in o) || el.name === 'corresponding') return;
      if (el.type === 'checkbox') el.checked = !!o[el.name]; else el.value = o[el.name];
    });
    setAuthors(o.authors);
    state.prefilled = o._prefilled || [];
    state.prefilled.forEach(function (n) { var el = $('[name="' + n + '"]'); if (el) el.classList.add('prefilled'); });
    if (o._step) state.step = Math.min(o._step, 6);
  }
  function save() {
    var o = fields(); o._prefilled = state.prefilled; o._step = state.step;
    store(o);
    $('#savestate').textContent = 'Draft saved in this browser';
  }

  function applyExtraction(x) {
    var filled = [];
    function put(name, val) {
      var el = $('[name="' + name + '"]');
      if (!el || !val) return;
      if (el.value && state.prefilled.indexOf(name) < 0) return; // never overwrite author edits
      el.value = val; el.classList.add('prefilled'); filled.push(name);
    }
    put('title', x.title);
    put('abstract', x.abstract);
    if (x.keywords) put('keywords', x.keywords.join(', '));
    var current = getAuthors().filter(function (a) { return a.name; });
    if (x.authors && x.authors.length && !current.length) {
      setAuthors(x.authors.map(function (n, i) { return { name: n, corresponding: i === 0, _prefilled: true }; }));
      filled.push('authors');
    }
    state.prefilled = filled.filter(function (n) { return n !== 'authors'; });
    updateCount();
    return filled;
  }

  /* ---------------------------------------------------------- files */
  function renderFiles() {
    var ul = $('#filelist'); ul.innerHTML = '';
    state.suppFiles.forEach(function (f, i) {
      var li = document.createElement('li');
      li.innerHTML = '<span>' + esc(f.name) + ' &middot; ' + mb(f.size) + '</span>';
      var b = document.createElement('button'); b.type = 'button'; b.className = 'linkbtn'; b.textContent = 'Remove';
      b.onclick = function () { state.suppFiles.splice(i, 1); renderFiles(); };
      li.appendChild(b); ul.appendChild(li);
    });
  }
  async function onMain(file) {
    var st = $('#extract-status');
    st.hidden = false;
    if (!file) return;
    if (file.size > CONFIG.MAX_MAIN_MB * 1048576) { st.textContent = 'The file is larger than ' + CONFIG.MAX_MAIN_MB + ' MB. Please reduce its size.'; return; }
    state.mainFile = file;
    st.textContent = 'Reading ' + file.name + ' (' + mb(file.size) + ')…';
    try {
      var x = await extract(file);
      state.extraction = { source_file: x.from || file.name, method: 'browser-heuristic-v1', found: Object.keys(x).filter(function (k) { return k !== 'from'; }) };
      var filled = applyExtraction(x);
      var labels = { title: 'title', abstract: 'abstract', keywords: 'keywords', authors: 'author names' };
      st.innerHTML = '<b>' + esc(file.name) + '</b> uploaded. ' + (filled.length
        ? 'Pre-filled: ' + filled.map(function (k) { return labels[k]; }).join(', ') + '. Please check these fields in the next steps.'
        : 'The details could not be read automatically from this file; please enter them in the next steps.');
      save();
    } catch (e) {
      st.innerHTML = '<b>' + esc(file.name) + '</b> uploaded. Automatic reading was not possible (' + esc(e.message) + '); please enter the details in the next steps.';
    }
  }

  /* ---------------------------------------------------------- validation */
  var REQUIRED = {
    1: function () { return state.mainFile ? [] : ['Main document']; },
    2: function (o) { var m = []; if (!o.article_type) m.push('Article type'); if (!o.title.trim()) m.push('Title'); if (!o.abstract.trim()) m.push('Abstract'); if (words(o.abstract) > 300) m.push('Abstract is longer than 300 words'); return m; },
    3: function (o) { var m = [], n = o.keywords.split(',').filter(function (s) { return s.trim(); }).length; if (n < 3 || n > 6) m.push('Three to six keywords'); if (!o.subject_area) m.push('Subject area'); return m; },
    4: function (o) {
      var m = [];
      if (!o.authors.length) m.push('At least one author');
      o.authors.forEach(function (a, i) { ['name', 'email', 'affiliation', 'country'].forEach(function (k) { if (!a[k]) m.push('Author ' + (i + 1) + ': ' + k); }); if (a.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) m.push('Author ' + (i + 1) + ': valid email'); });
      if (!o.authors.some(function (a) { return a.corresponding; })) m.push('Corresponding author');
      return m;
    },
    5: function () { return []; },
    6: function (o) {
      var m = [];
      [['cover_letter', 'Cover letter'], ['data_availability', 'Data and code availability'], ['ai_statement', 'Use of AI tools'], ['funding', 'Funding'], ['competing_interests', 'Competing interests']].forEach(function (p) { if (!o[p[0]].trim()) m.push(p[1]); });
      [['c_original', 'Originality confirmation'], ['c_authors', 'Author approval'], ['c_licence', 'Licence agreement'], ['c_privacy', 'Privacy agreement']].forEach(function (p) { if (!o[p[0]]) m.push(p[1]); });
      return m;
    }
  };
  function missingAll(o) { var m = []; for (var s = 1; s <= 6; s++) m = m.concat(REQUIRED[s](o).map(function (x) { return 'Step ' + s + ': ' + x; })); return m; }

  /* ---------------------------------------------------------- navigation */
  function show(step) {
    state.step = step;
    $$('.step-panel').forEach(function (p) { p.classList.toggle('current', +p.dataset.step === step); });
    $$('#steps li').forEach(function (li) { var s = +li.dataset.step; li.classList.toggle('current', s === step); li.classList.toggle('done', s < step); });
    $('#prev').style.visibility = step === 1 ? 'hidden' : 'visible';
    $('#next').style.display = step === TOTAL ? 'none' : '';
    if (step === TOTAL) renderSummary();
    window.scrollTo(0, $('#steps').offsetTop - 10);
  }
  function next() {
    var o = fields(), m = REQUIRED[state.step](o);
    if (m.length) { alert('Please complete the following before continuing:\n\n• ' + m.join('\n• ')); return; }
    save(); show(state.step + 1);
  }

  function payload(o) {
    return {
      schema: 'aider-submission/1',
      reference: o._reference,
      submitted_at: new Date().toISOString(),
      article_type: o.article_type, title: o.title.trim(), abstract: o.abstract.trim(),
      keywords: o.keywords.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      subject_area: o.subject_area,
      authors: o.authors,
      suggested_reviewers: o.suggested_reviewers, opposed_reviewers: o.opposed_reviewers,
      cover_letter: o.cover_letter, data_availability: o.data_availability, repository_url: o.repository_url,
      ai_statement: o.ai_statement, funding: o.funding, competing_interests: o.competing_interests,
      previous_submission: o.previous_submission,
      confirmations: { original: o.c_original, authors_approved: o.c_authors, licence_cc_by: o.c_licence, privacy: o.c_privacy },
      extraction: state.extraction,
      files: []
    };
  }
  function asText(p) {
    var a = p.authors.map(function (x, i) { return (i + 1) + '. ' + x.name + (x.corresponding ? ' (corresponding)' : '') + ' <' + x.email + '>, ' + x.affiliation + ', ' + x.country + (x.orcid ? ', ORCID ' + x.orcid : ''); }).join('\n');
    return ['AIDER manuscript submission ' + p.reference, '',
      'Article type: ' + p.article_type, 'Title: ' + p.title, 'Subject area: ' + p.subject_area, 'Keywords: ' + p.keywords.join(', '), '',
      'Abstract:', p.abstract, '', 'Authors:', a, '',
      'Cover letter:', p.cover_letter, '', 'Data and code availability:', p.data_availability, 'Repository: ' + (p.repository_url || '-'), '',
      'Use of AI tools:', p.ai_statement, '', 'Funding:', p.funding, '', 'Competing interests:', p.competing_interests, '',
      'Suggested reviewers:', p.suggested_reviewers || '-', '', 'Opposed reviewers:', p.opposed_reviewers || '-', '',
      'Previously submitted: ' + p.previous_submission,
      'Confirmations: original, all authors approved, CC BY 4.0, privacy - all confirmed', '',
      'Files: ' + [state.mainFile].concat(state.suppFiles).filter(Boolean).map(function (f) { return f.name; }).join(', ')].join('\n');
  }

  function renderSummary() {
    var o = fields();
    var rows = [
      ['Main document', state.mainFile ? esc(state.mainFile.name) + ' (' + mb(state.mainFile.size) + ')' : '<i>missing</i>'],
      ['Supplementary files', state.suppFiles.length ? state.suppFiles.map(function (f) { return esc(f.name); }).join('<br>') : 'None'],
      ['Article type', esc(o.article_type)], ['Title', esc(o.title)], ['Abstract', esc(o.abstract).replace(/\n/g, '<br>')],
      ['Keywords', esc(o.keywords)], ['Subject area', esc(o.subject_area)],
      ['Authors', o.authors.map(function (a) { return esc(a.name) + (a.corresponding ? ' (corresponding)' : '') + '<br><span class="small">' + esc([a.email, a.affiliation, a.country].filter(Boolean).join(' · ')) + '</span>'; }).join('<br>')],
      ['Suggested reviewers', esc(o.suggested_reviewers || 'None').replace(/\n/g, '<br>')],
      ['Opposed reviewers', esc(o.opposed_reviewers || 'None').replace(/\n/g, '<br>')],
      ['Data and code availability', esc(o.data_availability) + (o.repository_url ? '<br>' + esc(o.repository_url) : '')],
      ['Use of AI tools', esc(o.ai_statement)], ['Funding', esc(o.funding)], ['Competing interests', esc(o.competing_interests)]
    ];
    $('#summary').innerHTML = rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('');
    var m = missingAll(o), box = $('#missing'), area = $('#submit-area');
    if (m.length) { box.hidden = false; box.innerHTML = '<p><b>Incomplete submission.</b> Please complete:</p><ul><li>' + m.map(esc).join('</li><li>') + '</li></ul>'; area.innerHTML = ''; return; }
    box.hidden = true;
    area.innerHTML = '<p><button type="button" class="btn" id="do-submit">Submit manuscript</button></p>';
    $('#do-submit').onclick = submit;
  }

  function b64(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1]); };
      r.onerror = rej; r.readAsDataURL(file);
    });
  }

  async function submit() {
    var o = fields(); o._reference = ref();
    var p = payload(o), area = $('#submit-area');
    var files = [state.mainFile].concat(state.suppFiles).filter(Boolean);
    var total = files.reduce(function (s, f) { return s + f.size; }, 0);

    if (CONFIG.SUBMIT_ENDPOINT && total <= CONFIG.MAX_TOTAL_MB * 1048576) {
      area.innerHTML = '<div class="status-line">Uploading your submission… please keep this page open.</div>';
      try {
        for (var i = 0; i < files.length; i++) {
          p.files.push({ name: files[i].name, role: i === 0 ? 'main' : 'supplementary', mime: files[i].type || 'application/octet-stream', size: files[i].size, base64: await b64(files[i]) });
        }
        var r = await fetch(CONFIG.SUBMIT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(p) });
        var j = null; try { j = await r.json(); } catch (e) { /* opaque or non-JSON */ }
        if (j && j.ok === false) throw new Error(j.error || 'rejected');
        done(p, true);
        return;
      } catch (e) {
        area.innerHTML = '<div class="notice warn"><p>The upload did not complete (' + esc(e.message) + '). You can submit by email instead:</p></div>';
      }
    }
    emailFallback(p, area);
  }

  function emailFallback(p, area) {
    var body = asText(p);
    var subject = 'Manuscript submission ' + p.reference + ': ' + p.title.slice(0, 90);
    var mail = 'mailto:' + CONFIG.EDITORIAL_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body.length > 1800 ? body.slice(0, 1800) + '\n\n[Full submission form attached]' : body);
    var blob = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
    area.innerHTML = '<div class="notice"><p><b>Final step: send your submission to the editorial office.</b></p><ol>' +
      '<li><a class="btn secondary" download="' + p.reference + '-submission-form.txt" href="' + blob + '">Download submission form</a></li>' +
      '<li><a class="btn" href="' + mail + '">Email the editorial office</a> and attach the downloaded form together with your manuscript' + (state.suppFiles.length ? ' and supplementary files' : '') + '.</li>' +
      '</ol><p class="small">If the email link does not open, send the files to <a href="mailto:' + CONFIG.EDITORIAL_EMAIL + '">' + CONFIG.EDITORIAL_EMAIL + '</a> quoting reference <b>' + p.reference + '</b>.</p></div>';
    store({});
  }

  function done(p) {
    $('#submit-area').innerHTML = '<div class="notice"><p><b>Thank you. Your manuscript has been submitted.</b></p><p>Reference: <b>' + esc(p.reference) + '</b>. The corresponding author will receive an acknowledgement from the editorial office. Please quote the reference in any correspondence.</p></div>';
    $('#prev').style.visibility = 'hidden';
    store({});
  }

  /* ---------------------------------------------------------- init */
  function updateCount() { $('#abs-count').textContent = words($('#f-abstract').value); }

  function init() {
    setAuthors();
    restore(store());
    $('#file-main').addEventListener('change', function (e) { onMain(e.target.files[0]); });
    var dz = $('#dz-main');
    ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); }); });
    dz.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) onMain(e.dataTransfer.files[0]); });
    $('#file-supp').addEventListener('change', function (e) { state.suppFiles = state.suppFiles.concat(Array.prototype.slice.call(e.target.files)); e.target.value = ''; renderFiles(); });
    $('#add-author').onclick = function () { var box = $('#authors'); box.appendChild(authorCard({}, box.children.length)); };
    $('#next').onclick = next;
    $('#prev').onclick = function () { save(); show(Math.max(1, state.step - 1)); };
    $('#f-abstract').addEventListener('input', updateCount);
    $('#subform').addEventListener('input', function (e) { if (e.target.classList) e.target.classList.remove('prefilled'); var i = state.prefilled.indexOf(e.target.name); if (i >= 0) state.prefilled.splice(i, 1); });
    $('#subform').addEventListener('change', save);
    updateCount();
    show(state.mainFile ? state.step : 1);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
