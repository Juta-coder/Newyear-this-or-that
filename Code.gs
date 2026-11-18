/**
 * NEW YEAR THIS OR THAT! — Google Sheet backend (Google Apps Script)
 *
 * วิธีติดตั้ง (ทำครั้งเดียว) — ดูรายละเอียดใน README.md
 *  1. เปิด Google Sheet "NEW YEAR THIS OR THAT!" > Extensions (ส่วนขยาย) > Apps Script
 *  2. ลบโค้ดเดิม แล้ววางไฟล์นี้ทั้งหมด > Save
 *  3. เลือกฟังก์ชัน setup แล้วกด Run (อนุญาตสิทธิ์ครั้งแรก)
 *  4. Deploy > New deployment > Web app
 *       Execute as: Me      Who has access: Anyone
 *  5. คัดลอก Web app URL (ลงท้าย /exec) ไปใส่ใน public/js/config.js
 *
 * Security
 *  - Players can only APPEND a row. They can never read data.
 *  - Reading data needs a token, issued only after the PIN is checked here on the server.
 *  - The Sheet itself stays private (only people you share it with can open it).
 *  - Change the PIN: Project Settings > Script properties > ADMIN_PIN
 */

// ---- Must match public/questions.json (ids + option values/labels) ----
var STEPS = [
  { id: 'dress_code',   header: 'Step 01 - Dress Code',   type: 'choice', options: { themed: 'THEMED PARTY', free: 'FREE STYLE' } },
  { id: 'fashion_show', header: 'Step 02 - Fashion Show', type: 'choice', options: { yes: "YES! LET'S SHOW OFF!", no: "NO, LET'S JUST HAVE FUN!" } },
  { id: 'party_theme',  header: 'Step 03 - Party Theme',  type: 'text', max: 200 },
  { id: 'grand_prize',  header: 'Step 04 - Grand Prize',  type: 'text', max: 200 },
  { id: 'game_time',    header: 'Step 05 - Game Time',    type: 'choice', options: { team: 'TEAM CHALLENGE', solo: 'SOLO FUN' } },
  { id: 'are_you_in',   header: 'Step 06 - Are You In?',  type: 'choice', options: { yes: 'YES! COUNT ME IN!', maybe: 'MAYBE... LET\'S SEE!', no: 'NO, NOT THIS TIME.' } }
];
// Google Sheet ที่ใช้เก็บคำตอบ (ID จากลิงก์ docs.google.com/spreadsheets/d/<ID>/edit)
var SPREADSHEET_ID = '19JfmwUqturm4ZequH5XMTE7x5--MVjbjzGrohvm_l94';
var SHEET_NAME = 'Responses';
var HEADERS = ['Session ID', 'Timestamp'].concat(STEPS.map(function (s) { return s.header; }));
var TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

// ------------------------------------------------------------------ entry points
function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, code: 400, error: 'Bad request' }); }
  try {
    if (req.action === 'submit') return json_(submit_(req));
    if (req.action === 'login') return json_(login_(req));
    if (req.action === 'responses') return json_(responses_(req));
    return json_({ ok: false, code: 404, error: 'Unknown action' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, code: 500, error: 'Server error' });
  }
}

function doGet() {
  return json_({ ok: true, app: 'NEW YEAR THIS OR THAT!', message: 'Backend is running 🎉' });
}

/** Run once from the editor: creates the Responses sheet, headers and secrets. */
function setup() {
  sheet_();
  props_();
  Logger.log('Ready! Now: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone)');
}

// ------------------------------------------------------------------ actions
function submit_(req) {
  var sid = String(req.sessionId || '');
  if (!/^[A-Za-z0-9-]{16,64}$/.test(sid)) return { ok: false, code: 400, error: 'Invalid session' };

  var cache = CacheService.getScriptCache();
  if (cache.get('sid_' + sid)) return { ok: true, duplicate: true };

  var answers = req.answers || {};
  var row = [sid, new Date()];
  STEPS.forEach(function (s) {
    var v = answers[s.id];
    if (s.type === 'choice') {
      row.push(s.options.hasOwnProperty(v) ? s.options[v] : '');
    } else {
      var t = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, s.max) : '';
      if (/^[=+\-@]/.test(t)) t = "'" + t; // never let player text become a formula
      row.push(t);
    }
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_();
    var found = sh.getLastRow() > 1 && sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(sid).matchEntireCell(true).findNext();
    if (found) { cache.put('sid_' + sid, '1', 21600); return { ok: true, duplicate: true }; }
    sh.appendRow(row);
    cache.put('sid_' + sid, '1', 21600);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, code: 201 };
}

function login_(req) {
  var cache = CacheService.getScriptCache();
  if (cache.get('pin_locked')) return { ok: false, code: 429, error: 'Too many attempts. Try again in a minute.' };
  var p = props_();
  if (String(req.pin || '') !== p.pin) {
    var fails = Number(cache.get('pin_fails') || 0) + 1;
    cache.put('pin_fails', String(fails), 300);
    if (fails >= 8) { cache.put('pin_locked', '1', 60); cache.remove('pin_fails'); }
    Utilities.sleep(400);
    return { ok: false, code: 401, error: 'Incorrect PIN. Try again!' };
  }
  cache.remove('pin_fails');
  var exp = String(Date.now() + TOKEN_TTL_MS);
  return { ok: true, token: exp + '.' + sign_(exp, p.secret), expiresIn: TOKEN_TTL_MS };
}

function responses_(req) {
  if (!verify_(req.token)) return { ok: false, code: 401, error: 'Locked' };
  var sh = sheet_();
  var n = sh.getLastRow() - 1;
  var rows = [];
  if (n > 0) {
    var values = sh.getRange(2, 1, n, HEADERS.length).getValues();
    values.forEach(function (r, i) {
      if (!r[0]) return;
      var o = { id: i + 1, session_id: String(r[0]), created_at: r[1] instanceof Date ? r[1].toISOString() : String(r[1]) };
      STEPS.forEach(function (s, k) {
        var v = r[k + 2];
        if (v === '' || v == null) { o[s.id] = null; return; }
        if (s.type === 'choice') {
          var key = null;
          for (var opt in s.options) if (s.options[opt] === v || opt === v) key = opt;
          o[s.id] = key || String(v);
        } else {
          o[s.id] = String(v).replace(/^'/, '');
        }
      });
      rows.push(o);
    });
  }
  rows.reverse();
  return { ok: true, responses: rows, serverTime: new Date().toISOString() };
}

// ------------------------------------------------------------------ helpers
function sheet_() {
  var ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    var first = ss.getSheets()[0];
    if (first && first.getLastRow() === 0) { sh = first.setName(SHEET_NAME); }
    else { sh = ss.insertSheet(SHEET_NAME); }
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#1b1464').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange('B:B').setNumberFormat('dd/MM/yyyy HH:mm:ss');
    sh.setColumnWidth(1, 290);
    for (var c = 3; c <= HEADERS.length; c++) sh.setColumnWidth(c, 200);
  }
  return sh;
}

function props_() {
  var sp = PropertiesService.getScriptProperties();
  var pin = sp.getProperty('ADMIN_PIN');
  var secret = sp.getProperty('TOKEN_SECRET');
  if (!pin) { pin = '1234'; sp.setProperty('ADMIN_PIN', pin); }
  if (!secret) { secret = Utilities.getUuid() + Utilities.getUuid(); sp.setProperty('TOKEN_SECRET', secret); }
  return { pin: String(pin), secret: secret };
}

function sign_(value, secret) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(value, secret)).replace(/=+$/, '');
}

function verify_(token) {
  if (typeof token !== 'string') return false;
  var parts = token.split('.');
  if (parts.length !== 2 || Number(parts[0]) < Date.now()) return false;
  return sign_(parts[0], props_().secret) === parts[1];
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
