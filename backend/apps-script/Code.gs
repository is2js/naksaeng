var VERIFICATION_SCHEMA_VERSION = 1;
var VERIFICATION_SHEET_NAME = '인증명단';
var VERIFICATION_HEADERS = ['동', '타입', '닉네임', '상태'];
var MEMBER_CODE_HEADERS = ['회원코드 해시', '회원코드 발급일', '회원코드 폐기일'];
var MEMBER_CODE_PLAINTEXT_HEADERS = ['', '회원코드 원문', '회원코드', '인증코드', '코드'];
var MEMBER_CODE_REVISION = 1;
var MEMBER_CODE_DIALOG_PROPERTY = 'BUNFIRVIL_MEMBER_CODE_DIALOG';
var OPERATOR_CODE_DIALOG_PROPERTY = 'BUNFIRVIL_OPERATOR_CODE_DIALOG';
var VERIFICATION_STATUSES = ['인증됨', '운영자', '중지'];
var REQUEST_SHEET_NAME = '가입요청';
var REQUEST_HEADERS = ['요청ID', '요청일시', '동', '타입', '닉네임', '심사결정', '처리결과', '처리일시'];
var REQUEST_MAX_ROWS = 5000;
var REQUEST_MAX_PENDING = 300;

function setupVerificationSheet() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('Google Sheet의 확장 프로그램 → Apps Script에서 실행해 주세요.');
  var members = ensureSheet_(book, VERIFICATION_SHEET_NAME, VERIFICATION_HEADERS);
  ensureMemberCodeColumns_(members);
  var requests = ensureSheet_(book, REQUEST_SHEET_NAME, REQUEST_HEADERS);
  members.getRange('D2:D').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(VERIFICATION_STATUSES, true).setAllowInvalid(false).build());
  requests.getRange('F2:F').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['대기', '승인', '반려'], true).setAllowInvalid(false).build());
  // Preserve the operator digest and unrelated script properties.
  PropertiesService.getScriptProperties().setProperties({
    BUNFIRVIL_SPREADSHEET_ID: book.getId(), BUNFIRVIL_VERIFICATION_SHEET: VERIFICATION_SHEET_NAME,
  }, false);
  var exists = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'onRegistrationDecisionEdit';
  });
  if (!exists) ScriptApp.newTrigger('onRegistrationDecisionEdit').forSpreadsheet(book).onEdit().create();
  return { ok: true, sheets: [VERIFICATION_SHEET_NAME, REQUEST_SHEET_NAME] };
}

function ensureSheet_(book, name, headers) {
  var sheet = book.getSheetByName(name) || book.insertSheet(name);
  var current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (current.every(function (v) { return !String(v).trim(); })) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  else if (!sameValues_(current, headers)) throw new Error(name + ' 헤더를 확인하세요: ' + headers.join(' | ') + '. 기존 데이터는 변경하지 않았습니다.');
  sheet.setFrozenRows(1);
  return sheet;
}

function memberCodeHeadersValid_(sheet) {
  return sameValues_(sheet.getRange(1, 5, 1, 3).getDisplayValues()[0], MEMBER_CODE_HEADERS);
}
function ensureMemberCodeColumns_(sheet) {
  var headerRange = sheet.getRange(1, 5, 1, 3);
  var current = headerRange.getDisplayValues()[0];
  if (sameValues_(current, MEMBER_CODE_HEADERS)) return;
  // Displayed emptiness is not blankness: a formula returning "" or a hidden
  // number format must never cause existing E:G contents to be overwritten.
  var occupied = sheet.getLastRow() > 1 && !sheet.getRange(2, 5, sheet.getLastRow() - 1, 3).isBlank();
  if (!headerRange.isBlank() || occupied) {
    throw new Error('인증명단 E:G에 다른 헤더나 데이터가 있습니다. 백업 후 확인하세요. 기존 데이터는 변경하지 않았습니다.');
  }
  sheet.getRange(1, 5, 1, 3).setValues([MEMBER_CODE_HEADERS]);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('분퍼빌 회원 관리')
    .addItem('초기 설치 / 드롭다운 준비', 'setupVerificationSheet')
    .addItem('운영자 인증코드 설정', 'configureOperatorCode')
    .addItem('선택 회원 코드 발급/재발급', 'issueSelectedMemberCode')
    .addItem('선택 회원 코드 폐기', 'revokeSelectedMemberCode')
    .addItem('기존 요청 분리 (백업 후 이동)', 'migrateLegacyRequests')
    .addItem('미처리 승인 / 반려 재처리', 'processPendingDecisions').addToUi();
}

function configureOperatorCode() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var id = PropertiesService.getScriptProperties().getProperty('BUNFIRVIL_SPREADSHEET_ID');
  if (!book || !id || book.getId() !== id) throw new Error('먼저 인증 Sheet에서 초기 설치를 실행하세요.');
  var descriptor = { bookId: id, createdAt: Date.now(), dialogId: Utilities.getUuid() };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('다른 처리가 진행 중입니다. 잠시 후 다시 시도하세요.');
  try { PropertiesService.getUserProperties().setProperty(OPERATOR_CODE_DIALOG_PROPERTY, JSON.stringify(descriptor)); }
  finally { lock.releaseLock(); }
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(operatorCodeDialogHtml_(descriptor)).setWidth(500).setHeight(530), '운영자 인증코드 설정');
}

// Only a fresh dialog opened by the current sheet editor can change the hash.
// This is not a doPost action; an active bound spreadsheet is required.
function saveOperatorCode(payload) {
  var saved = PropertiesService.getUserProperties().getProperty(OPERATOR_CODE_DIALOG_PROPERTY);
  var target;
  try { target = JSON.parse(saved || 'null'); } catch (_) { target = null; }
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var id = PropertiesService.getScriptProperties().getProperty('BUNFIRVIL_SPREADSHEET_ID');
  if (!payload || !target || !book || !id || book.getId() !== id || target.bookId !== id
    || typeof target.createdAt !== 'number' || Date.now() - target.createdAt < 0 || Date.now() - target.createdAt > 300000
    || payload.createdAt !== target.createdAt || payload.dialogId !== target.dialogId
    || !validSheetStoredCode_(payload.code)) throw new Error('설정 창을 닫고 인증 Sheet에서 다시 시작하세요. = 또는 작은따옴표로 시작하는 코드는 사용할 수 없습니다.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('다른 처리가 진행 중입니다. 잠시 후 다시 시도하세요.');
  try {
    if (PropertiesService.getUserProperties().getProperty(OPERATOR_CODE_DIALOG_PROPERTY) !== saved) throw new Error('설정 창을 닫고 다시 시작하세요.');
    var sheet = book.getSheetByName(VERIFICATION_SHEET_NAME);
    if (!sheet || !sameValues_(sheet.getRange(1, 1, 1, 4).getDisplayValues()[0], VERIFICATION_HEADERS)) throw new Error('인증명단 헤더를 확인하세요.');
    checkCodeColumnHeader_(sheet);
    var store = PropertiesService.getScriptProperties();
    var key = 'BUNFIRVIL_OPERATOR_CODE_SHA256';
    var oldHash = store.getProperty(key) || '';
    var roster = operatorRoster_(sheet);
    if (!roster.length) throw new Error('인증명단에 운영자 상태 행이 없습니다.');
    var snapshots = roster.map(function (item) {
      var range = sheet.getRange(item.row, 8, 1, 1);
      if (!range.canEdit() || isProtectedCodeRange_(range) || range.getFormulas()[0][0]) throw new Error('운영자 H열에 수식 또는 보호된 셀이 있어 변경하지 않았습니다.');
      var value = range.getValues()[0][0];
      if (value !== '' && value != null && (typeof value !== 'string' || !validSheetStoredCode_(value)
        || !oldHash || !constantEqual_(digest_(value), oldHash))) {
        throw new Error('운영자 H열의 기존 내용이 현재 코드와 일치하지 않아 변경하지 않았습니다. 운영자가 직접 확인하세요.');
      }
      return { row: item.row, value: value == null ? '' : value, format: range.getNumberFormat() };
    });
    // The Sheet and Script Properties are different services and cannot commit
    // atomically. Fail closed while writing; on failure restore only our own
    // unchanged cells, and never re-enable authentication if recovery is unsure.
    if ((store.getProperty(key) || '') !== oldHash) throw new Error('운영자 설정이 변경되어 중단했습니다.');
    store.setProperty(key, '');
    if (store.getProperty(key)) throw new Error('운영자 인증 잠시 중단을 확인하지 못해 변경하지 않았습니다.');
    var touched = [];
    try {
      for (var i = 0; i < snapshots.length; i++) {
        var snapshot = snapshots[i], cell = sheet.getRange(snapshot.row, 8, 1, 1);
        if (JSON.stringify(operatorRoster_(sheet)) !== JSON.stringify(roster) || !cell.canEdit() || isProtectedCodeRange_(cell)
          || cell.getFormulas()[0][0] || cell.getValues()[0][0] !== snapshot.value) throw new Error('운영자 행이 변경되었습니다.');
        touched.push(snapshot); // include writes whose response may be lost
        cell.setNumberFormat('@').setValue(payload.code);
      }
      SpreadsheetApp.flush();
      if (JSON.stringify(operatorRoster_(sheet)) !== JSON.stringify(roster)) throw new Error('운영자 행이 변경되었습니다.');
      for (var j = 0; j < snapshots.length; j++) {
        var check = sheet.getRange(snapshots[j].row, 8, 1, 1);
        if (check.getFormulas()[0][0] || check.getValues()[0][0] !== payload.code || check.getDisplayValues()[0][0] !== payload.code) throw new Error('운영자 원문 저장을 확인하지 못했습니다.');
      }
      var newHash = digest_(payload.code);
      store.setProperty(key, newHash);
      if (!constantEqual_(String(store.getProperty(key) || ''), newHash)) throw new Error('운영자 해시 저장을 확인하지 못했습니다.');
      // Recheck immediately before success; direct sheet edits do not honor
      // ScriptLock, so detected concurrent changes must fail closed.
      if (JSON.stringify(operatorRoster_(sheet)) !== JSON.stringify(roster)) throw new Error('운영자 행이 변경되었습니다.');
      for (var p = 0; p < snapshots.length; p++) {
        var verified = sheet.getRange(snapshots[p].row, 8, 1, 1);
        if (verified.getFormulas()[0][0] || verified.getValues()[0][0] !== payload.code || verified.getDisplayValues()[0][0] !== payload.code) {
          throw new Error('운영자 원문 저장을 확인하지 못했습니다.');
        }
      }
    } catch (_) {
      var disabled = false, restored = true;
      try { store.setProperty(key, ''); disabled = !store.getProperty(key); } catch (ignored) { disabled = false; }
      if (disabled) {
        for (var n = touched.length - 1; n >= 0; n--) {
          try {
            var old = touched[n], restore = sheet.getRange(old.row, 8, 1, 1);
            var current = restore.getValues()[0][0];
            if (restore.getFormulas()[0][0] || !restore.canEdit() || isProtectedCodeRange_(restore)) { restored = false; continue; }
            if (current === payload.code) restore.setValue(old.value);
            else if (current !== old.value) { restored = false; continue; }
            restore.setNumberFormat(old.format);
          } catch (ignored) { restored = false; }
        }
        try {
          SpreadsheetApp.flush();
          // Another editor may have changed an operator row we never reached.
          // Do not restore the old digest unless *every* operator value still
          // matches the snapshot, not just the cells we attempted to write.
          for (var k = 0; k < snapshots.length; k++) {
            var restoredCell = sheet.getRange(snapshots[k].row, 8, 1, 1);
            if (restoredCell.getFormulas()[0][0] || restoredCell.getValues()[0][0] !== snapshots[k].value) restored = false;
          }
          if (restored && JSON.stringify(operatorRoster_(sheet)) === JSON.stringify(roster)) {
            store.setProperty(key, oldHash);
            if ((store.getProperty(key) || '') !== oldHash) { restored = false; store.setProperty(key, ''); }
          }
        } catch (ignored) { restored = false; }
      }
      throw new Error('운영자 코드 저장을 완료하지 못했습니다. 시트를 확인하고 재설정하세요. 복구가 불확실하면 운영자 인증은 중단됩니다.');
    }
    PropertiesService.getUserProperties().deleteProperty(OPERATOR_CODE_DIALOG_PROPERTY);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function operatorRoster_(sheet) {
  return rows_(sheet, 4).map(function (row, index) {
    return { row: index + 2, buildingId: normalizeBuilding_(row[0]), unitType: normalizeUnitType_(row[1]),
      nickname: normalizeNickname_(row[2]), status: normalizeStatus_(row[3]) };
  }).filter(function (row) { return row.status === '운영자'; });
}

function operatorCodeDialogHtml_(target) {
  var data = JSON.stringify({ createdAt: target.createdAt, dialogId: target.dialogId }).replace(/</g, '\\u003c');
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><base target="_top">'
    + '<style>body{font:14px/1.6 sans-serif;margin:24px;color:#25313a}button,input{font:inherit}button{padding:8px 14px;margin:8px 4px 0 0}input{box-sizing:border-box;width:100%;padding:8px}small{display:block;color:#59656e}#message{min-height:42px}</style></head><body>'
    + '<h2>운영자 인증코드 설정</h2><small>모든 운영자 행의 H열에 동일한 코드 원문이 저장됩니다. 시트 조회자·댓글 작성자·편집자 모두 볼 수 있으며 운영자로 인증할 수 있습니다. 교체 후에도 버전 기록·백업에 남을 수 있으니 시트를 공유하지 마세요.</small>'
    + '<button type="button" id="generate">무작위 코드 생성</button><label>운영자 코드 (16~128자)<input id="code" type="password" maxlength="128" autocomplete="new-password" spellcheck="false"></label>'
    + '<button type="button" id="toggle">코드 보기</button><button type="button" id="save">설정 및 저장</button><p id="message" role="status"></p>'
    + '<section id="result" hidden><button type="button" id="copy">코드 복사</button><small>원문은 각 운영자 행의 H열에 저장됩니다. 공개 채팅·GitHub·공유 링크에 올리지 마세요.</small></section>'
    + '<button type="button" id="close">닫기</button><script>"use strict";var target=' + data + ',busy=false,finished=false;var $=function(id){return document.getElementById(id)};'
    + '$("generate").onclick=function(){if(!window.crypto||typeof window.crypto.getRandomValues!=="function"){$("message").textContent="안전한 자동 생성을 지원하지 않습니다. 다른 브라우저 또는 비밀번호 관리자를 사용하세요.";return;}var bytes=new Uint8Array(32);window.crypto.getRandomValues(bytes);var raw="";bytes.forEach(function(b){raw+=String.fromCharCode(b)});$("code").value=btoa(raw).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");$("message").textContent="무작위 코드가 입력됐습니다. 저장을 누르면 기존 코드가 교체됩니다.";};'
    + '$("toggle").onclick=function(){var f=$("code");f.type=f.type==="password"?"text":"password";$("toggle").textContent=f.type==="password"?"코드 보기":"코드 숨기기";};'
    + '$("save").onclick=function(){if(busy||finished)return;var code=$("code").value;if(!/^[\\x21-\\x7e]{16,128}$/.test(code)||code.charAt(0)==="="||code.charCodeAt(0)===39){$("message").textContent="공백이 없고 = 또는 작은따옴표로 시작하지 않는 무작위 16~128자 코드를 입력하세요.";return;}if(!confirm("모든 운영자 행 H열의 기존 코드를 교체합니다. Sheet 조회자·편집자 모두 운영자 인증이 가능합니다. 계속할까요?"))return;busy=true;$("generate").disabled=true;$("save").disabled=true;$("message").textContent="원문과 해시 저장을 확인 중입니다. 아직 코드를 사용하지 마세요.";'
    + 'google.script.run.withSuccessHandler(function(result){if(!result||result.ok!==true){failed();return;}finished=true;busy=false;$("code").readOnly=true;$("result").hidden=false;$("message").textContent="저장했습니다. 새 코드를 복사해 안전하게 보관하세요.";code="";}).withFailureHandler(failed).saveOperatorCode({createdAt:target.createdAt,dialogId:target.dialogId,code:code});};'
    + 'function failed(){busy=false;$("code").value="";$("message").textContent="저장 또는 복구 여부를 확인할 수 없습니다. 코드를 사용하지 말고 각 운영자 행과 설정 상태를 확인하세요. 인증이 중단될 수 있습니다.";}'
    + '$("copy").onclick=function(){var f=$("code");f.type="text";f.focus();f.select();if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(f.value).then(function(){$("message").textContent="복사했습니다. 비밀번호 관리자에 안전하게 보관하세요."},function(){$("message").textContent="직접 선택해 복사하세요."});};'
    + '$("close").onclick=function(){$("code").value="";google.script.host.close()};</script></body></html>';
}

function selectedMemberCodeRow_() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var expectedId = PropertiesService.getScriptProperties().getProperty('BUNFIRVIL_SPREADSHEET_ID');
  if (!book || !expectedId || book.getId() !== expectedId) throw new Error('원본 Google Sheet에서 실행해 주세요.');
  var range = book.getActiveRange();
  if (!range || range.getSheet().getName() !== VERIFICATION_SHEET_NAME || range.getRow() < 2 || range.getNumRows() !== 1) {
    throw new Error('인증명단에서 회원 한 행만 선택하세요.');
  }
  var sheet = range.getSheet();
  if (!sameValues_(sheet.getRange(1, 1, 1, 4).getDisplayValues()[0], VERIFICATION_HEADERS) || !memberCodeHeadersValid_(sheet)) {
    throw new Error('먼저 초기 설치 / 드롭다운 준비를 실행해 헤더를 확인하세요.');
  }
  var row = sheet.getRange(range.getRow(), 1, 1, 4).getDisplayValues()[0];
  var identity = { buildingId: normalizeBuilding_(row[0]), unitType: normalizeUnitType_(row[1]), nickname: normalizeNickname_(row[2]) };
  if (normalizeStatus_(row[3]) !== '인증됨' || !parseVerificationRequest_({ postData: { contents: JSON.stringify({
    schemaVersion: 1, action: 'verifyHousehold', buildingId: identity.buildingId, unitType: identity.unitType, nickname: identity.nickname,
  }) } }) || matchingOperatorRow_(sheet, identity.nickname) || memberStatus_(sheet, identity) !== '인증됨') {
    throw new Error('정상 인증됨 회원에게만 발급·폐기할 수 있습니다. 운영자·중지·요청 상태는 변경하지 않습니다.');
  }
  return { sheet: sheet, row: range.getRow(), identity: identity };
}
function sameMemberTarget_(left, right) {
  return left && right && left.row === right.row && left.identity && right.identity
    && left.identity.buildingId === right.identity.buildingId && left.identity.unitType === right.identity.unitType
    && left.identity.nickname === right.identity.nickname;
}
// '=' is a Sheets formula and a leading apostrophe is a Sheets text marker.
function validSheetStoredCode_(code) { return validMemberCode_(code) && code.charAt(0) !== '=' && code.charAt(0) !== "'"; }
// canEdit() is true for the owner even on protected cells. Respect protections
// regardless of who runs the menu; never alter a protected range silently.
function isProtectedCodeRange_(range) {
  var sheet = range.getSheet();
  if (sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) return true;
  return sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).some(function (protection) {
    var other = protection.getRange();
    return other.getRow() <= range.getLastRow() && range.getRow() <= other.getLastRow()
      && other.getColumn() <= range.getLastColumn() && range.getColumn() <= other.getLastColumn();
  });
}
function checkCodeColumnHeader_(sheet) {
  var cell = sheet.getRange(1, 8, 1, 1);
  var value = cell.getValues()[0][0];
  var header = value === '' || value == null ? '' : typeof value === 'string' ? value.trim() : null;
  if (cell.getFormulas()[0][0] || MEMBER_CODE_PLAINTEXT_HEADERS.indexOf(header) < 0) {
    throw new Error('인증명단 H1 헤더가 다른 용도로 사용 중입니다. 원본을 확인하고 변경 없이 중단했습니다.');
  }
}
function memberCodeRowSnapshot_(target) {
  checkCodeColumnHeader_(target.sheet);
  var range = target.sheet.getRange(target.row, 5, 1, 4);
  if (!range.canEdit() || isProtectedCodeRange_(range)) throw new Error('선택 행 E:H가 보호되어 변경하지 않았습니다.');
  var formulas = range.getFormulas()[0];
  if (formulas.some(function (value) { return !!value; })) throw new Error('선택 행 E:H에 수식이 있어 변경하지 않았습니다.');
  var values = range.getValues()[0];
  if (typeof values[1] === 'string' && values[1].charAt(0) === '=') {
    throw new Error('선택 행 발급일 내용이 수식과 혼동될 수 있어 변경하지 않았습니다.');
  }
  var oldHash = String(values[0] || ''), oldCode = values[3];
  if (oldCode !== '' && oldCode != null && (typeof oldCode !== 'string' || !validSheetStoredCode_(oldCode)
    || !oldHash || !constantEqual_(oldHash, memberCodeDigest_(oldCode, target.identity)))) {
    throw new Error('선택 행 H열 기존 내용이 현재 회원 해시와 일치하지 않아 변경하지 않았습니다. 운영자가 직접 확인해 주세요.');
  }
  return { values: values, fingerprint: digest_(JSON.stringify(values)) };
}
function issueSelectedMemberCode() {
  var target = selectedMemberCodeRow_();
  // UUID distinguishes editor dialogs only; member codes use browser Web Crypto.
  var descriptor = { row: target.row, identity: target.identity, createdAt: Date.now(), dialogId: Utilities.getUuid(),
    rowFingerprint: memberCodeRowSnapshot_(target).fingerprint };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('다른 처리가 진행 중입니다. 잠시 후 다시 시도하세요.');
  try { PropertiesService.getUserProperties().setProperty(MEMBER_CODE_DIALOG_PROPERTY, JSON.stringify(descriptor)); }
  finally { lock.releaseLock(); }
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(memberCodeDialogHtml_(descriptor)).setWidth(480).setHeight(520), '회원 코드 발급/재발급');
}
// HTML Service only: no public doPost action calls this function. Bound-sheet UI
// context + a short-lived per-editor target + current selected row are all required.
function saveSelectedMemberCode(payload) {
  var saved = PropertiesService.getUserProperties().getProperty(MEMBER_CODE_DIALOG_PROPERTY);
  var target;
  try { target = JSON.parse(saved || 'null'); } catch (_) { target = null; }
  if (!target || typeof target.createdAt !== 'number' || Date.now() - target.createdAt < 0 || Date.now() - target.createdAt > 300000
    || !sameMemberTarget_(target, payload) || target.createdAt !== payload.createdAt || target.dialogId !== payload.dialogId
    || !validSheetStoredCode_(payload.code)) throw new Error('발급 창을 닫고 회원 행을 다시 선택해 주세요. = 또는 작은따옴표로 시작하는 코드는 사용할 수 없습니다.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('다른 처리가 진행 중입니다. 창을 닫고 다시 발급하세요.');
  try {
    // A different tab may have opened a newer issuance dialog since this RPC
    // began. Never let the older dialog consume that newer editor context.
    if (PropertiesService.getUserProperties().getProperty(MEMBER_CODE_DIALOG_PROPERTY) !== saved) {
      throw new Error('발급 창을 닫고 회원 행을 다시 선택해 주세요.');
    }
    var selected = selectedMemberCodeRow_();
    if (!sameMemberTarget_(target, selected)) throw new Error('선택 회원이 바뀌었습니다. 다시 발급하세요.');
    if (memberCodeRowSnapshot_(selected).fingerprint !== target.rowFingerprint) throw new Error('선택 행 코드가 바뀌었습니다. 다시 발급하세요.');
    var hash = memberCodeDigest_(payload.code, selected.identity);
    if (rows_(selected.sheet, 7).some(function (row) { return constantEqual_(String(row[4] || ''), memberCodeDigest_(payload.code, {
      buildingId: row[0], unitType: row[1], nickname: row[2],
    })); })) {
      throw new Error('현재 저장된 코드는 다시 사용할 수 없습니다. 새로운 무작위 코드를 발급하세요.');
    }
    var issuedAt = new Date().toISOString();
    selected.sheet.getRange(selected.row, 5, 1, 4).setNumberFormat('@').setValues([[hash, issuedAt, '', payload.code]]);
    SpreadsheetApp.flush();
    var verifiedRange = selected.sheet.getRange(selected.row, 5, 1, 4);
    var written = verifiedRange.getValues()[0];
    if (verifiedRange.getFormulas()[0].some(function (v) { return !!v; }) || !constantEqual_(String(written[0] || ''), hash) || written[1] !== issuedAt || written[3] !== payload.code || verifiedRange.getDisplayValues()[0][3] !== payload.code || written[2] !== '') {
      throw new Error('코드 저장 상태를 확인하지 못했습니다. 해당 행을 점검한 뒤 다시 발급하세요.');
    }
    clearMemberCodeAttempts_(selected.identity);
    PropertiesService.getUserProperties().deleteProperty(MEMBER_CODE_DIALOG_PROPERTY);
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function revokeSelectedMemberCode() {
  var target = selectedMemberCodeRow_();
  var original = memberCodeRowSnapshot_(target);
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('선택 회원 코드 폐기', '선택 회원의 해시와 H열 원문을 지우고 코드를 폐기할까요? 다음 인증부터 사용할 수 없습니다. 이미 열린 탭은 즉시 종료되지 않습니다.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('다른 처리가 진행 중입니다. 잠시 후 다시 시도하세요.');
  try {
    var selected = selectedMemberCodeRow_();
    if (!sameMemberTarget_(target, selected)) throw new Error('선택 회원이 바뀌었습니다. 다시 선택하세요.');
    var current = memberCodeRowSnapshot_(selected);
    if (current.fingerprint !== original.fingerprint) throw new Error('선택 행 코드가 바뀌었습니다. 다시 선택하세요.');
    var revokedAt = new Date().toISOString();
    selected.sheet.getRange(selected.row, 7, 1, 1).setNumberFormat('@');
    selected.sheet.getRange(selected.row, 5, 1, 4).setValues([['', current.values[1], revokedAt, '']]);
    SpreadsheetApp.flush();
    var written = selected.sheet.getRange(selected.row, 5, 1, 4).getValues()[0];
    if (written[0] !== '' || written[3] !== '' || written[2] !== revokedAt) throw new Error('폐기 상태를 확인하지 못했습니다. 해당 행을 점검하세요.');
    PropertiesService.getUserProperties().deleteProperty(MEMBER_CODE_DIALOG_PROPERTY);
  } finally { lock.releaseLock(); }
  ui.alert('코드를 폐기했습니다. 상태·회원 정보는 그대로 유지합니다. 이미 열린 탭의 권한은 남을 수 있습니다.');
}
function memberCodeDialogHtml_(target) {
  // Escape script-terminating and HTML-significant characters in Sheet nicknames.
  var data = JSON.stringify({ row: target.row, identity: target.identity, createdAt: target.createdAt, dialogId: target.dialogId }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><base target="_top">'
    + '<style>body{font:14px/1.6 sans-serif;margin:24px;color:#25313a}button,input{font:inherit}button{padding:8px 14px;margin:8px 4px 0 0}input{box-sizing:border-box;width:100%;padding:8px}#message{min-height:48px}#result{margin-top:16px}small{display:block;color:#59656e}</style></head><body>'
    + '<h2>회원 코드 발급/재발급</h2><p id="member"></p><small>선택 회원의 원문이 인증명단 H열에 저장됩니다. Sheet 조회자·댓글 작성자·편집자 모두 볼 수 있고 폐기 후에도 버전 기록·백업에 남을 수 있습니다.</small>'
    + '<button id="generate" type="button">새 코드 발급</button><details><summary>비밀번호 관리자 코드 사용</summary>'
    + '<label>무작위 16~128자 코드<input id="manual" type="password" maxlength="128" autocomplete="off"></label><button id="manual-save" type="button">입력 코드 발급</button></details>'
    + '<p id="message" role="status"></p><section id="result" hidden><label>발급된 회원 코드<input id="code" readonly autocomplete="off" spellcheck="false"></label>'
    + '<button id="copy" type="button">코드 복사</button><small>원문은 비공개 시트 H열에 보관됩니다. 실제 회원에게 1:1로 전달하고 공개 채팅·공유 링크에는 넣지 마세요.</small></section>'
    + '<button type="button" id="close">닫기</button><script>"use strict";var target=' + data + ';'
    + 'var $=function(id){return document.getElementById(id)};var busy=false,finished=false;$("member").textContent=target.identity.buildingId+"동 · "+target.identity.unitType+" · "+target.identity.nickname;'
    + 'function submit(code){if(busy||finished)return;if(!/^[\\x21-\\x7e]{16,128}$/.test(code)||code.charAt(0)==="="||code.charCodeAt(0)===39){$("message").textContent="공백이 없고 = 또는 작은따옴표로 시작하지 않는 무작위 16~128자 코드를 입력하세요.";return;}if(!confirm("선택 회원의 H열에 코드 원문을 저장하고 기존 코드는 교체합니다. 시트 조회자·편집자 모두 볼 수 있습니다. 계속할까요?"))return;busy=true;$("generate").disabled=true;$("manual-save").disabled=true;$("message").textContent="해시와 H열 원문 저장을 확인하고 있습니다. 아직 코드를 전달하지 마세요.";'
    + 'google.script.run.withSuccessHandler(function(result){if(!result||result.ok!==true){failed();return;}finished=true;busy=false;$("manual").value="";$("manual").disabled=true;$("code").value=code;$("result").hidden=false;$("message").textContent="발급 완료. 원문을 복사해 실제 회원에게 1:1로 전달하세요.";code="";})'
    + '.withFailureHandler(failed).saveSelectedMemberCode({row:target.row,identity:target.identity,createdAt:target.createdAt,dialogId:target.dialogId,code:code});}'
    + 'function failed(){busy=false;$("manual").value="";$("message").textContent="저장 완료를 확인할 수 없습니다. 코드를 전달하지 말고 해당 행 E:H를 점검한 뒤 다시 발급하세요.";}'
    + '$("generate").onclick=function(){if(!window.crypto||typeof window.crypto.getRandomValues!=="function"){$("message").textContent="이 브라우저에서 안전한 자동 생성을 지원하지 않습니다. 비밀번호 관리자 코드 입력을 사용하세요.";return;}var bytes=new Uint8Array(32);window.crypto.getRandomValues(bytes);var raw="";bytes.forEach(function(b){raw+=String.fromCharCode(b)});submit(btoa(raw).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/, ""));};'
    + '$("manual-save").onclick=function(){submit($("manual").value)};$("copy").onclick=function(){var field=$("code");field.focus();field.select();if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(field.value).then(function(){$("message").textContent="복사했습니다. 실제 회원에게만 전달하세요."},function(){$("message").textContent="자동 복사가 제한되었습니다. 선택된 코드를 직접 복사하세요."});}};'
    + '$("close").onclick=function(){$("code").value="";$("manual").value="";google.script.host.close()};</script></body></html>';
}

function verificationBook_() {
  var id = PropertiesService.getScriptProperties().getProperty('BUNFIRVIL_SPREADSHEET_ID');
  if (!id) throw new Error('setup required');
  return SpreadsheetApp.openById(id);
}
function doGet() { return serviceError_('method_not_allowed'); }

function doPost(event) {
  try {
    var request = parseVerificationRequest_(event);
    if (!request) return serviceError_('invalid_request');
    var book = verificationBook_();
    var members = book.getSheetByName(PropertiesService.getScriptProperties().getProperty('BUNFIRVIL_VERIFICATION_SHEET') || VERIFICATION_SHEET_NAME);
    var requests = book.getSheetByName(REQUEST_SHEET_NAME);
    if (!members || !requests || !sameValues_(members.getRange(1, 1, 1, 4).getDisplayValues()[0], VERIFICATION_HEADERS) || !memberCodeHeadersValid_(members)
      || !sameValues_(requests.getRange(1, 1, 1, 8).getDisplayValues()[0], REQUEST_HEADERS)) return serviceError_('service_unavailable');
    return request.action === 'requestHouseholdVerification'
      ? requestVerification_(members, request, requests) : verifyRequest_(members, request, requests);
  } catch (_) {
    // Do not log request contents, nicknames, credentials, or sheet rows.
    return serviceError_('service_unavailable');
  }
}

function rows_(sheet, width) {
  return sheet && sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getDisplayValues() : [];
}
function matchingOperatorRow_(sheet, nickname) {
  return rows_(sheet, 4).filter(function (row) {
    return normalizeNickname_(row[2]) === nickname && normalizeStatus_(row[3]) === '운영자';
  })[0] || null;
}
function memberStatus_(sheet, request) {
  var matches = matchingMemberRows_(sheet, request);
  if (matches.some(function (row) { return normalizeStatus_(row[3]) === '중지'; })) return '중지';
  if (matches.some(function (row) { return normalizeStatus_(row[3]) === '인증됨'; })) return '인증됨';
  return '';
}
function matchingMemberRows_(sheet, request) {
  return rows_(sheet, 7).filter(function (row) {
    return normalizeBuilding_(row[0]) === request.buildingId && normalizeNickname_(row[2]) === request.nickname
      && (request.action === 'verifyShareViewer' || normalizeUnitType_(row[1]) === request.unitType);
  });
}

function withCredentialLock_(alreadyLocked, callback) {
  if (alreadyLocked) return callback();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return serviceError_('service_unavailable');
  try { return callback(); } finally { lock.releaseLock(); }
}
function operatorOutput_(request, alreadyLocked) {
  return withCredentialLock_(alreadyLocked, function () {
    // Read after acquiring the same lock as operator-code rotation so a request
    // queued before rotation cannot use a stale hash after rotation completes.
    var expected = PropertiesService.getScriptProperties().getProperty('BUNFIRVIL_OPERATOR_CODE_SHA256');
    if (!expected) return verificationOutput_('', request, 'operator_setup_required');
    var cache = CacheService.getScriptCache();
    var key = 'operator-attempt:' + digest_(request.nickname);
    var attempts = Number(cache.get(key) || 0);
    if (!request.operatorCode || attempts >= 6) return verificationOutput_('', request, 'operator_code_required');
    if (!constantEqual_(digest_(request.operatorCode), expected)) {
      cache.put(key, String(attempts + 1), 600);
      return verificationOutput_('', request, 'operator_code_required');
    }
    cache.remove(key);
    return verificationOutput_('운영자', request);
  });
}
function validMemberCode_(code) { return typeof code === 'string' && /^[\x21-\x7e]{16,128}$/.test(code); }
function memberCodeDigest_(code, identity) {
  // Identity binding makes copying a hash or editing A:C require reissuance.
  return digest_(['bunfirvil-member-code:v1', normalizeBuilding_(identity.buildingId), normalizeUnitType_(identity.unitType),
    normalizeNickname_(identity.nickname), code].join('\n'));
}
function clearMemberCodeAttempts_(identity) {
  var cache = CacheService.getScriptCache();
  [identity.unitType, ''].forEach(function (unitType) {
    cache.remove('member-attempt:' + digest_([identity.buildingId, unitType, identity.nickname].join('\n')));
  });
}
function memberOutput_(members, request, alreadyLocked) {
  if (!memberCodeHeadersValid_(members)) return serviceError_('service_unavailable');
  return withCredentialLock_(alreadyLocked, function () {
    // Re-read under the same lock as issuance/revocation. A registration request
    // must never become a credential-free shortcut for an existing member.
    var matches = matchingMemberRows_(members, request);
    if (matches.some(function (row) { return normalizeStatus_(row[3]) === '중지'; })) return verificationOutput_('중지', request);
    var approved = matches.filter(function (row) { return normalizeStatus_(row[3]) === '인증됨'; });
    var cache = CacheService.getScriptCache();
    var key = 'member-attempt:' + digest_([request.buildingId, request.unitType, request.nickname].join('\n'));
    var attempts = Number(cache.get(key) || 0);
    if (!request.memberCode || attempts >= 6) return verificationOutput_('', request, 'member_code_required');
    var accepted = approved.some(function (row) {
      return validMemberCode_(request.memberCode) && !String(row[6] || '').trim() && /^[a-f0-9]{64}$/.test(row[4] || '')
        && constantEqual_(memberCodeDigest_(request.memberCode, { buildingId: row[0], unitType: row[1], nickname: row[2] }), row[4]);
    });
    if (!accepted) {
      cache.put(key, String(attempts + 1), 600);
      return verificationOutput_('', request, 'member_code_required');
    }
    cache.remove(key);
    return verificationOutput_('인증됨', request, undefined, true);
  });
}

function verifyRequest_(members, request, requests) {
  if (matchingOperatorRow_(members, request.nickname)) return operatorOutput_(request);
  var status = memberStatus_(members, request);
  if (status) return status === '인증됨' ? memberOutput_(members, request) : verificationOutput_(status, request);
  var queued = matchingRequest_(requests, request);
  return verificationOutput_(queued ? (queued[5] === '반려' ? '반려' : '요청') : '', request);
}

function requestVerification_(members, request, requests) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return serviceError_('service_unavailable');
  try {
    if (matchingOperatorRow_(members, request.nickname)) return operatorOutput_(request, true);
    var status = memberStatus_(members, request);
    if (status) return status === '인증됨' ? memberOutput_(members, request, true) : verificationOutput_(status, request);
    var queued = matchingRequest_(requests, request);
    if (queued) return verificationOutput_(queued[5] === '반려' ? '반려' : '요청', request);
    if (!requests) return serviceError_('service_unavailable');
    var rows = rows_(requests, 8);
    if (rows.length >= REQUEST_MAX_ROWS || rows.filter(function (row) { return row[5] === '대기'; }).length >= REQUEST_MAX_PENDING) return serviceError_('request_capacity');
    var cache = CacheService.getScriptCache();
    var key = 'registration:' + digest_(request.nickname);
    if (cache.get(key)) return serviceError_('rate_limited');
    appendLiteralRow_(requests, [Utilities.getUuid(), new Date().toISOString(), request.buildingId, request.unitType, request.nickname, '대기', '', '']);
    SpreadsheetApp.flush();
    cache.put(key, '1', 60);
    return verificationOutput_('요청', request);
  } finally { lock.releaseLock(); }
}

function matchingRequest_(sheet, request) {
  return rows_(sheet, 8).filter(function (row) {
    return normalizeBuilding_(row[2]) === request.buildingId && normalizeNickname_(row[4]) === request.nickname
      && (request.action === 'verifyShareViewer' || normalizeUnitType_(row[3]) === request.unitType);
  })[0] || null;
}

function onRegistrationDecisionEdit(event) {
  if (!event || !event.range || event.range.getSheet().getName() !== REQUEST_SHEET_NAME
    || event.range.getColumn() > 6 || event.range.getLastColumn() < 6 || event.range.getLastRow() < 2) return;
  var book = verificationBook_();
  if (event.source.getId() !== book.getId()) return;
  var requests = book.getSheetByName(REQUEST_SHEET_NAME);
  for (var row = Math.max(2, event.range.getRow()); row <= event.range.getLastRow(); row++) {
    var result = requests.getRange(row, 7).getDisplayValues()[0][0];
    // Successful approval is immutable history. Revoke in the member sheet.
    if (result === '승인 완료') requests.getRange(row, 6).setValue('승인');
    else requests.getRange(row, 7, 1, 2).setValues([['', '']]);
  }
  processPendingDecisions();
}

function processPendingDecisions() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('다른 처리가 진행 중입니다. 잠시 후 재처리하세요.');
  try {
    var book = verificationBook_();
    var requests = book.getSheetByName(REQUEST_SHEET_NAME);
    var members = book.getSheetByName(VERIFICATION_SHEET_NAME);
    rows_(requests, 8).forEach(function (row, index) {
      if (['승인', '반려'].indexOf(row[5]) < 0 || row[6] === '승인 완료' || row[6] === row[5] + ' 완료') return;
      try {
        if (row[5] === '승인') approveRequest_(members, row);
        SpreadsheetApp.flush();
        requests.getRange(index + 2, 7, 1, 2).setValues([[row[5] + ' 완료', new Date().toISOString()]]);
      } catch (_) {
        requests.getRange(index + 2, 7).setValue('처리 실패: 요청 내용 또는 기존 회원 상태를 확인 후 재처리하세요.');
      }
    });
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}

function approveRequest_(members, row) {
  var request = parseVerificationRequest_({ postData: { contents: JSON.stringify({ schemaVersion: 1, action: 'verifyHousehold', buildingId: row[2], unitType: row[3], nickname: row[4] }) } });
  if (!row[0] || !request) throw new Error('invalid request row');
  // Approval cannot create/promote an operator or undo a suspension.
  if (matchingOperatorRow_(members, request.nickname)) throw new Error('reserved operator');
  var status = memberStatus_(members, request);
  if (status === '중지') throw new Error('suspended');
  if (status === '인증됨') return;
  appendLiteralRow_(members, [request.buildingId, request.unitType, request.nickname, '인증됨']);
}

function migrateLegacyRequests() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('기존 요청 분리', '인증명단을 백업한 뒤 상태가 요청인 행만 가입요청으로 옮깁니다. 인증됨·운영자·중지 행은 유지합니다. 계속할까요?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('다른 작업이 진행 중입니다.');
  try {
    var book = verificationBook_();
    var members = book.getSheetByName(VERIFICATION_SHEET_NAME);
    var requests = book.getSheetByName(REQUEST_SHEET_NAME);
    if (!requests) throw new Error('초기 설치를 먼저 실행하세요.');
    var pending = rows_(members, 4).map(function (row, index) { return { row: row, index: index + 2 }; })
      .filter(function (item) { return normalizeStatus_(item.row[3]) === '요청'; });
    if (!pending.length) return;
    pending.forEach(function (item) {
      if (!parseVerificationRequest_({ postData: { contents: JSON.stringify({ schemaVersion: 1, action: 'verifyHousehold', buildingId: item.row[0], unitType: item.row[1], nickname: item.row[2] }) } })) throw new Error('기존 요청 데이터에 오류가 있습니다. 이동하지 않았습니다.');
    });
    if (requests.getLastRow() - 1 + pending.length > REQUEST_MAX_ROWS) throw new Error('가입요청 보관 한도를 초과합니다. 먼저 백업·정리하세요.');
    members.copyTo(book).setName('인증백업-' + new Date().getTime());
    pending.reverse().forEach(function (item) {
      var request = { buildingId: normalizeBuilding_(item.row[0]), unitType: normalizeUnitType_(item.row[1]), nickname: normalizeNickname_(item.row[2]) };
      if (!matchingRequest_(requests, request)) appendLiteralRow_(requests, [Utilities.getUuid(), new Date().toISOString(), request.buildingId, request.unitType, request.nickname, '대기', '', '']);
      SpreadsheetApp.flush();
      // Delete only after durable destination write. Retrying cannot duplicate it.
      members.deleteRow(item.index);
    });
  } finally { lock.releaseLock(); }
}

function appendLiteralRow_(sheet, row) {
  // '=' is formula syntax in appendRow/setValues. Apostrophe forces literal text.
  var safe = row.map(function (value) { var text = String(value); return /^[=+\-@']/.test(text) ? "'" + text : text; });
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([safe]);
}

function parseVerificationRequest_(event) {
  if (!event || !event.postData || typeof event.postData.contents !== 'string' || event.postData.contents.length > 2048) return null;
  var payload;
  try { payload = JSON.parse(event.postData.contents); } catch (_) { return null; }
  if (!payload || payload.schemaVersion !== 1 || ['verifyHousehold', 'verifyShareViewer', 'requestHouseholdVerification'].indexOf(payload.action) < 0) return null;
  var buildingId = normalizeBuilding_(payload.buildingId);
  var unitType = normalizeUnitType_(payload.unitType);
  var nickname = normalizeNickname_(payload.nickname);
  if (!/^(10[1-9]|11[0-2])$/.test(buildingId) || (payload.action !== 'verifyShareViewer' && ['51A', '55A', '55B', '59A'].indexOf(unitType) < 0)
    || Array.from(nickname).length < 1 || Array.from(nickname).length > 20 || /[\u0000-\u001f\u007f]/.test(nickname)) return null;
  return { action: payload.action, buildingId: buildingId, unitType: payload.action === 'verifyShareViewer' ? '' : unitType,
    nickname: nickname, operatorCode: typeof payload.operatorCode === 'string' && payload.operatorCode.length <= 128 ? payload.operatorCode.trim() : '',
    memberCode: typeof payload.memberCode === 'string' && payload.memberCode.length <= 128 ? payload.memberCode.trim() : '' };
}

function normalizeUnicode_(value) { return String(value == null ? '' : value).normalize('NFKC'); }
function normalizeBuilding_(value) { return normalizeUnicode_(value).trim().replace(/\s*동\s*$/, '').replace(/^0+(?=\d)/, ''); }
function normalizeUnitType_(value) { return normalizeUnicode_(value).trim().replace(/\s+/g, '').toUpperCase(); }
function normalizeNickname_(value) { return normalizeUnicode_(value).trim(); }
function normalizeStatus_(value) {
  var status = normalizeUnicode_(value).trim();
  return VERIFICATION_STATUSES.concat(['요청', '반려']).indexOf(status) >= 0 ? status : '';
}
function matchesVerificationRow_(row, request) {
  return Boolean(row && request && normalizeNickname_(row[2])) && normalizeBuilding_(row[0]) === request.buildingId
    && normalizeUnitType_(row[1]) === request.unitType && normalizeNickname_(row[2]) === request.nickname;
}
function sameValues_(left, right) { return left.length === right.length && left.every(function (value, index) { return String(value).trim() === right[index]; }); }
function digest_(text) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8).map(function (n) { return ('0' + ((n + 256) % 256).toString(16)).slice(-2); }).join(''); }
function constantEqual_(left, right) {
  if (left.length !== right.length) return false;
  var diff = 0;
  for (var i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
function verificationOutput_(status, request, code, memberCodeVerified) {
  // Only the credential checker can produce an ordinary verified response.
  if (status === '인증됨' && memberCodeVerified !== true) { status = ''; code = 'member_code_required'; }
  return jsonOutput_({ schemaVersion: 1, authRevision: 2, ok: true,
    verified: status === '인증됨' || status === '운영자', operator: status === '운영자', operatorVerified: status === '운영자',
    memberCodeVerified: status === '인증됨' && memberCodeVerified === true, memberCodeRevision: MEMBER_CODE_REVISION,
    requested: status === '요청', scope: request && request.action === 'verifyShareViewer' ? 'share' : 'playground',
    status: status === '운영자' ? 'operator' : status === '인증됨' ? 'verified' : status === '요청' ? 'requested' : status === '반려' ? 'rejected' : 'not_found',
    code: code || (status === '중지' ? 'membership_suspended' : undefined) });
}
function serviceError_(code) { return jsonOutput_({ schemaVersion: 1, authRevision: 2, ok: false, verified: false, operator: false, status: 'not_found', code: code }); }
function jsonOutput_(body) { return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON); }
