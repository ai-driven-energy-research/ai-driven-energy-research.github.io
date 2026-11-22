#!/usr/bin/env node
/* Local test harness for Code.gs.
 * Emulates the Google services Code.gs uses (Sheets, Drive, Mail, Cache, Lock, Properties,
 * ContentService, Utilities) in memory, serves the website from the repo root, and routes
 * POST /api to doPost(). assets/aider-api.js is rewritten on the fly to point at /api.
 *
 *   node _docs/apps-script/mock_server.js [port]
 *   GET /__mail   -> JSON list of emails "sent"
 *   GET /__state  -> sheets content
 *   POST /__run   -> {"fn":"inviteReviewers_","args":[]} call an editor function
 */
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..', '..');
const PORT = +process.argv[2] || 8790;

/* ---------- in-memory Google services ---------- */
const sheets = {}; const mails = []; const cache = {};
const props = { UPLOAD_FOLDER_ID: 'F_UPLOAD', EDITORIAL_EMAIL: 'editor@aider.test', AGENT_KEY: 'agent-secret', SITE_URL: `http://127.0.0.1:${PORT}` };
let idc = 0; const nid = p => `${p}${++idc}`;
const files = {}, folders = { F_UPLOAD: { id: 'F_UPLOAD', name: 'upload', children: [], files: [] } };

function Sheet(name) {
  const data = [];
  return {
    getName: () => name,
    appendRow: r => data.push(r.slice()),
    getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
    getRange: (row, col) => ({ setValue: v => { while (data.length < row) data.push([]); data[row - 1][col - 1] = v; }, getValue: () => (data[row - 1] || [])[col - 1] }),
    _data: data
  };
}
const book = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = Sheet(n)) };
function Folder(f) {
  return {
    getId: () => f.id, getUrl: () => `https://drive.mock/${f.id}`, getName: () => f.name,
    createFolder: name => { const id = nid('F'); folders[id] = { id, name, children: [], files: [], parent: f.id }; f.children.push(id); return Folder(folders[id]); },
    getFoldersByName: name => iter(f.children.filter(c => folders[c].name === name).map(c => Folder(folders[c]))),
    createFile: (a, content, mime) => {
      const id = nid('D');
      const blob = typeof a === 'string' ? { name: a, bytes: Buffer.from(content), mime } : a;
      files[id] = { id, name: blob.name, bytes: blob.bytes, mime: blob.mime, parent: f.id };
      f.files.push(id); return File(files[id]);
    },
    getFiles: () => iter(f.files.map(i => File(files[i])))
  };
}
function File(x) {
  return { getId: () => x.id, getName: () => x.name, getMimeType: () => x.mime, getSize: () => x.bytes.length, getBlob: () => ({ getBytes: () => x.bytes }) };
}
function iter(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }

const ctx = {
  console, JSON, Date, Math, Object, Array, String, Number, RegExp, Error, encodeURIComponent,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => book, openById: () => book },
  DriveApp: { getFolderById: id => { if (!folders[id]) throw new Error('No folder ' + id); return Folder(folders[id]); }, getFileById: id => File(files[id]) },
  MailApp: { sendEmail: o => mails.push(o) },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => ({ content: s }) }) },
  MimeType: { PLAIN_TEXT: 'text/plain' },
  Session: { getActiveUser: () => ({ getEmail: () => 'editor@aider.test' }) },
  Utilities: {
    newBlob: (bytes, mime, name) => ({ bytes: Buffer.from(bytes), mime, name }),
    base64Decode: s => Buffer.from(s, 'base64'), base64Encode: b => Buffer.from(b).toString('base64'),
    getUuid: () => crypto.randomUUID()
  }
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
vm.runInContext('setupSheets()', ctx);

/* ---------- HTTP ---------- */
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.pdf': 'application/pdf', '.png': 'image/png' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(body); };
  if (req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      try {
        if (url.pathname === '/api') return send(200, ctx.doPost({ postData: { contents: body } }).content);
        if (url.pathname === '/__run') { const { fn, args } = JSON.parse(body); const r = ctx[fn].apply(null, args || []); return send(200, JSON.stringify({ ok: true, result: r === undefined ? null : r })); }
      } catch (e) { return send(500, JSON.stringify({ ok: false, error: String(e.message) })); }
      send(404, '{}');
    });
    return;
  }
  if (url.pathname === '/__mail') return send(200, JSON.stringify(mails));
  if (url.pathname === '/__state') return send(200, JSON.stringify(Object.fromEntries(Object.entries(sheets).map(([k, v]) => [k, v._data]))));
  let p = path.join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return send(404, 'not found', 'text/plain');
  let data = fs.readFileSync(p);
  if (p.endsWith('aider-api.js')) data = Buffer.from(data.toString().replace("window.AIDER_API = '';", "window.AIDER_API = '/api';"));
  send(200, data, MIME[path.extname(p)] || 'application/octet-stream');
}).listen(PORT, () => console.log(`mock AIDER server on http://127.0.0.1:${PORT}`));
