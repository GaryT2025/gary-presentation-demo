/**
 * ============================================================
 * 工作獎金看板 — Google Apps Script 後端 (Google OAuth 版)
 * ============================================================
 * 認證方式：Google OAuth（部署為 Web App）
 *   - 執行身分：我（部署者）
 *   - 誰可以存取：任何擁有 Google 帳號的人
 * GAS 直接讀 Session.getActiveUser().getEmail()
 * 比對 users sheet，不需要登入表單或 token。
 *
 * 全域函式（供 google.script.run 直接呼叫）：
 *   getUserInfo()        → { email, display_name, team, role }
 *   getData(payload)     → 完整看板資料結構
 *
 * HTTP Entry Points（外部 API 消費者用）：
 *   doGet(e)   → 提供 index.html，或回傳無權限頁面
 *   doPost(e)  → 路由 getData / getUserInfo
 *
 * Spreadsheet ID: 1rl3QHV5gJpXiAJLQmZjrXC6hHlxWFxm-jqYtWlu1Bwo
 * 8 張 Ragic 資料表 + 1 張 users 表
 * ============================================================
 */

// ──────────────────────────────────────────────
// CONSTANTS
// ──────────────────────────────────────────────
const SPREADSHEET_ID = '1rl3QHV5gJpXiAJLQmZjrXC6hHlxWFxm-jqYtWlu1Bwo';

// ──────────────────────────────────────────────
// HTTP ENTRY POINTS
// ──────────────────────────────────────────────

/**
 * doGet — 僅負責回傳 index.html。認證與身分驗證交由前端與 GAS google.script.run 處理。
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('CIL 工作獎金看板')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * doPost — 路由到各 action（供外部 API 消費者使用）
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action  = payload.action;

    let result;
    switch (action) {
      case 'getData':
        result = getData(payload);
        break;
      case 'getUserInfo':
        result = getUserInfo();
        break;
      default:
        result = { error: '未知的 action: ' + action };
    }

    return _jsonResponse(result);

  } catch (err) {
    return _jsonResponse({ error: err.message });
  }
}

// ──────────────────────────────────────────────
// GLOBAL FUNCTIONS（供 google.script.run 呼叫）
// ──────────────────────────────────────────────

/**
 * loginUser — 登入
 */
function loginUser(email, password) {
  if (!email || !password) return { error: '請輸入信箱與密碼' };
  email = String(email).trim().toLowerCase();
  password = String(password).trim();
  
  const user = _getUserFromSheet(email);
  if (!user) return { error: '帳號不存在，請先註冊' };
  if (user.password !== password) return { error: '密碼錯誤' };
  if (user.status !== 'active') return { error: '申請審核中，請待管理員開通 (status 需為 active)' };
  
  // 為了安全，回傳前移除 password
  let safeUser = { ...user };
  delete safeUser.password;
  return { success: true, user: safeUser };
}

/**
 * registerUser — 註冊並寫入 pending
 */
function registerUser(email, displayName, password) {
  email = String(email).trim().toLowerCase();
  displayName = String(displayName).trim();
  password = String(password).trim();
  
  if (!email || !displayName || !password) return { error: '欄位不得為空' };

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('users');
    
    // 確保留有密碼欄位
    var headersRange = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1));
    var headers = headersRange.getValues()[0].map(function(h) { return String(h).trim(); });
    
    if (headers.indexOf('password') === -1) {
      sheet.getRange(1, headers.length + 1).setValue('password');
      headers.push('password');
    }

    const existing = _getUserFromSheet(email);
    if (existing) return { error: '此 Email 已被註冊' };

    var newRow = new Array(headers.length);
    for (var i = 0; i < headers.length; i++) newRow[i] = '';
    
    var emailIdx = headers.indexOf('email');
    if (emailIdx === -1) { emailIdx = headers.length; sheet.getRange(1, emailIdx+1).setValue('email'); headers.push('email'); }
    var nameIdx = headers.indexOf('display_name');
    if (nameIdx === -1) { nameIdx = headers.length; sheet.getRange(1, nameIdx+1).setValue('display_name'); headers.push('display_name'); }
    var statusIdx = headers.indexOf('status');
    if (statusIdx === -1) { statusIdx = headers.length; sheet.getRange(1, statusIdx+1).setValue('status'); headers.push('status'); }
    var pwdIdx = headers.indexOf('password');
    
    newRow[emailIdx] = email;
    newRow[nameIdx]  = displayName;
    newRow[statusIdx] = 'pending';
    newRow[pwdIdx]    = password;
    
    sheet.appendRow(newRow);
    return { success: true };
  } catch (err) {
    return { error: '系統錯誤：' + err.message };
  }
}

/**
 * getUserInfo — 回傳目前登入使用者資訊
 */
function getUserInfo(email, password) {
  try {
    email = String(email || '').trim().toLowerCase();
    password = String(password || '').trim();
    const user = _getUserFromSheet(email);
    if (!user || user.password !== password || user.status !== 'active') return { error: 'unauthorized' };
    let safeUser = { ...user };
    delete safeUser.password;
    return safeUser;
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * getData — 在 GAS server-side 完整計算工作獎金所有指標，回傳前端可直接呈現的結構。
 * @param {{ year: string|number, quarter: string, team: string|null }} payload
 * @returns {{ year_quarter, team_exec, members[] } | { error }}
 *
 * team_exec: { COS:{完工,開發票,total}, CVS:{...}, SAS:{...} }  ← per-team，不受 teamFilter 影響
 *
 * members[] 每筆包含：
 *   name, team, role,
 *   personal_credit{主辦,協辦,組長,leader,派工,total},
 *   personal_target_y, personal_target_q, team_target_q,
 *   personal_achieve, team_achieve, overall_achieve,
 *   incentive,
 *   deductions{報告,加班,調班,回報,異常,total_deduct},
 *   work_index, bonus
 */
function getData(payload) {
  try {
    const email = String(payload.email || '').trim().toLowerCase();
    const password = String(payload.password || '').trim();
    const user  = _getUserFromSheet(email);
    
    if (!user || user.password !== password || user.status !== 'active') {
      return { error: 'unauthorized' };
    }

    const year       = String(payload.year    || '');
    const quarter    = String(payload.quarter || '');
    const teamFilter = payload.team || null;
    const yq         = year + '-' + quarter;          // "2026-Q1"
    const qNum       = quarter.charAt(1);              // "1"
    const qKey       = year + 'Q' + qNum;             // "2026Q1"
    const dispCCol   = 'C-派工(Name+Year+Q' + qNum + ')'; // "C-派工(Name+Year+Q1)"

    // ── 0. 讀取快取機制 (加速) ─────────────────────────────────────────
    const cache = CacheService.getScriptCache();
    const cacheKey = 'DASH_' + yq; // e.g. DASH_2026-Q1
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      try {
        const cachedResult = JSON.parse(cachedData);
        if (teamFilter) {
          cachedResult.members = cachedResult.members.filter(function(m) { return m.team === teamFilter; });
        }
        return cachedResult;
      } catch (e) {
        // 如果錯誤就算了，繼續往下重算
      }
    }

    // ── 1. Load all sheets ────────────────────────────────────────────
    const workOrderRows  = _getSheetData('維修工單')
      .filter(function(r) { return r['_year_quarter'] === yq; });
    const allDispatchRows = _getSheetData('派工總管');  // 全量，用 C-column 判斷季度
    const dispatchQRows  = allDispatchRows              // 只用於扣分項（仍用 _year_quarter）
      .filter(function(r) { return r['_year_quarter'] === yq; });
    const hoursRows      = _getSheetData('工時報表')
      .filter(function(r) { return r['_year_quarter'] === yq; });
    const logRows        = _getSheetData('工時登錄')
      .filter(function(r) { return r['_year_quarter'] === yq; });
    const anomalyRows    = _getSheetData('異常單')
      .filter(function(r) { return r['_year_quarter'] === yq; });
    const targetRows     = _getSheetData('團員年度目標')
      .filter(function(r) { return String(r['年份']) === year; });
    const completionRows = _getSheetData('完工通知單')
      .filter(function(r) {
        return r['_year_quarter'] === yq && String(r['簽核狀態'] || '').trim() === '簽核完成';
      });
    const invoiceRows    = _getSheetData('開發票')
      .filter(function(r) { return r['_year_quarter'] === yq; });

    // ── 2. team_exec per team（不受 teamFilter 影響，前端頂部永遠顯示三組） ──
    const TEAMS = ['COS', 'CVS', 'SAS'];
    const teamExec = {};
    TEAMS.forEach(function(t) {
      const cn = completionRows
        .filter(function(r) { return String(r['技服組別 (1)'] || '').trim() === t; })
        .reduce(function(s, r) { return s + (Number(r['台幣完工金額 (1)']) || 0); }, 0);
      const inv = invoiceRows
        .filter(function(r) { return String(r['技服組別'] || '').trim() === t; })
        .reduce(function(s, r) { return s + (Number(r['台幣未稅金額']) || 0); }, 0);
      teamExec[t] = { '完工': _r4(cn), '開發票': _r4(inv), 'total': _r4(cn + inv) };
    });

    // ── 3. Build credit accumulator (name → credits) ──────────────────
    const creditAcc = {};

    function _ensureCredit(name) {
      if (!name) return;
      if (!creditAcc[name]) {
        creditAcc[name] = { 主辦: 0, 協辦: 0, 組長: 0, leader: 0, 派工: 0 };
      }
    }

    // 維修工單 credit：依 結算季度+結算年份 (_year_quarter) 歸季，正確
    workOrderRows.forEach(function(r) {
      const responsible = String(r['工單負責人'] || '').trim();
      const assist1     = String(r['協辦人員1']   || '').trim();
      const assist2     = String(r['協辦人員2']   || '').trim();
      const groupLeader = String(r['組長']        || '').trim();
      const tl          = String(r['Team Leader'] || '').trim();

      const mainCredit   = Number(r['工單主辦-Credit']) || 0;
      const assistCredit = Number(r['工單協辦-Credit']) || 0;
      const leaderCredit = Number(r['組長-Credit'])     || 0;
      const tlCredit     = Number(r['Leader-Credit'])   || 0;

      if (responsible) { _ensureCredit(responsible); creditAcc[responsible].主辦   += mainCredit;   }
      if (assist1)     { _ensureCredit(assist1);     creditAcc[assist1].協辦        += assistCredit; }
      if (assist2)     { _ensureCredit(assist2);     creditAcc[assist2].協辦        += assistCredit; }
      if (groupLeader) { _ensureCredit(groupLeader); creditAcc[groupLeader].組長    += leaderCredit; }
      if (tl)          { _ensureCredit(tl);          creditAcc[tl].leader           += tlCredit;     }
    });

    // 派工 credit：用 C-派工(Name+Year+QN) 欄位決定歸屬季度（可能跨季）
    allDispatchRows.forEach(function(r) {
      const cVal = String(r[dispCCol] || '').trim();
      if (!cVal) return;
      const name = cVal.replace(qKey, '').trim();
      if (!name) return;
      _ensureCredit(name);
      creditAcc[name].派工 += Number(r['主辦Credit SUM']) || 0;
    });

    // ── 4. Build deduction accumulator (name → deductions) ────────────
    const deductAcc = {};

    function _ensureDeduct(name) {
      if (!name) return;
      if (!deductAcc[name]) {
        deductAcc[name] = { 報告: 0, 加班: 0, 調班: 0, 回報: 0, 異常: 0 };
      }
    }

    dispatchQRows.forEach(function(r) {  // 扣分仍用 _year_quarter 篩選
      const name = String(r['主辦工程師'] || '').trim();
      if (!name) return;
      _ensureDeduct(name);
      deductAcc[name].報告 +=
        (Number(r['減分項-報告完成']) || 0) +
        (Number(r['減分項-報告審核']) || 0);
    });

    hoursRows.forEach(function(r) {
      const name = String(r['施作人員'] || '').trim();
      if (!name) return;
      _ensureDeduct(name);
      deductAcc[name].加班 += Number(r['減分項-加班申請指標']) || 0;
      deductAcc[name].調班 += Number(r['減分項-未調班指標'])   || 0;
    });

    logRows.forEach(function(r) {
      const name = String(r['回報人員'] || '').trim();
      if (!name) return;
      _ensureDeduct(name);
      deductAcc[name].回報 += Number(r['工作回報指標-扣分%數']) || 0;
    });

    anomalyRows.forEach(function(r) {
      const name = String(r['主辦人員'] || '').trim();
      if (!name) return;
      _ensureDeduct(name);
      deductAcc[name].異常 += (Number(r['分數']) || 0) / 0.5 * 0.05;
    });

    // ── 5. Assemble members from 團員年度目標 ──────────────────────────
    let members = targetRows
      .filter(function(r) {
        const name = String(r['姓名'] || '').trim();
        return name && name.indexOf('@') === -1;  // 跳過 email 格式的列
      })
      .map(function(r) {
        const name = String(r['姓名'] || '').trim();
        const team = String(r['組別'] || '').trim();

        // 職能：先讀 sheet，空白則 hardcode 對照
        const roleFromSheet = String(r['職能'] || '').trim();
        const role = roleFromSheet || _inferRole(name);

        // 個人目標
        const personalAnnual  = Number(r['個人年度目標'])     || 0;
        const personalQRaw    = Number(r['個人季度目標'])     || 0;
        const personalTargetQ = (personalQRaw > 0) ? personalQRaw : personalAnnual / 4;

        // 團隊目標（修正欄位名稱）
        const teamAnnual  = Number(r['團隊(年)度執行目標']) || 0;
        const teamQRaw    = Number(r['團隊(季)度執行目標']) || 0;
        const teamTargetQ = (teamQRaw > 0) ? teamQRaw : teamAnnual / 4;

        // 個人執行金額（credit 累計）
        const cr = creditAcc[name] || { 主辦: 0, 協辦: 0, 組長: 0, leader: 0, 派工: 0 };
        const personalCredit = {
          '主辦':   _r4(cr.主辦),
          '協辦':   _r4(cr.協辦),
          '組長':   _r4(cr.組長),
          'leader': _r4(cr.leader),
          '派工':   _r4(cr.派工),
          'total':  _r4(cr.主辦 + cr.協辦 + cr.組長 + cr.leader + cr.派工),
        };

        // 達成率：team_achieve 用 member 自己所屬 team 的 exec
        const personalExec    = personalCredit.total;
        const personalAchieve = (personalTargetQ > 0)
          ? _r4(personalExec / personalTargetQ) : 0;

        const teamExecTotal = (teamExec[team] || { total: 0 }).total;
        const teamAchieve   = (teamTargetQ > 0)
          ? _r4(teamExecTotal / teamTargetQ) : 0;

        const weights        = _getRoleWeights(role);
        const overallAchieve = _r4(personalAchieve * weights.P + teamAchieve * weights.T);
        const incentive      = _getIncentive(overallAchieve);

        // 扣分
        const dd = deductAcc[name] || { 報告: 0, 加班: 0, 調班: 0, 回報: 0, 異常: 0 };
        const totalDeduct = _r4(dd.報告 + dd.加班 + dd.調班 + dd.回報);
        const deductions  = {
          '報告':         _r4(dd.報告),
          '加班':         _r4(dd.加班),
          '調班':         _r4(dd.調班),
          '回報':         _r4(dd.回報),
          '異常':         _r4(dd.異常),
          'total_deduct': totalDeduct,
        };

        const workIndex = _r4(1 - totalDeduct + dd.異常);
        const bonus     = _r4(overallAchieve * incentive * workIndex);

        return {
          name:              name,
          team:              team,
          role:              role,
          personal_credit:   personalCredit,
          personal_target_y: _r4(personalAnnual),   // 年度目標（側邊面板用）
          personal_target_q: _r4(personalTargetQ),
          team_target_q:     _r4(teamTargetQ),
          personal_achieve:  personalAchieve,
          team_achieve:      teamAchieve,
          overall_achieve:   overallAchieve,
          incentive:         incentive,
          deductions:        deductions,
          work_index:        workIndex,
          bonus:             bonus,
        };
      });

    const resultToCache = {
      year_quarter: yq,
      team_exec:    teamExec,   // { COS:{...}, CVS:{...}, SAS:{...} }
      members:      members,
    };

    // 寫入快取 (保存 5 分鐘 / 300 秒)
    try {
      cache.put(cacheKey, JSON.stringify(resultToCache), 300);
    } catch(e) {}

    if (teamFilter) {
      resultToCache.members = resultToCache.members.filter(function(m) { return m.team === teamFilter; });
    }

    return resultToCache;


  } catch (err) {
    return { error: err.message };
  }
}

// ──────────────────────────────────────────────
// PRIVATE HELPERS（getData 專用）
// ──────────────────────────────────────────────

/**
 * _r4 — 四捨五入到小數點後 4 位
 */
function _r4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

/**
 * _inferRole — 讀不到職能欄時依姓名推斷（與 fillJobRole 邏輯一致）
 */
function _inferRole(name) {
  const 主管 = ['Karl', 'Nick', 'Ellis', 'Jack', 'Jimmy'];
  const 組長 = ['Rex', 'Arthur', 'Michael', 'Steven', 'Evan', 'Patrick', 'Will'];
  if (主管.some(function(k) { return name.indexOf(k) !== -1; })) return '部門主管';
  if (組長.some(function(k) { return name.indexOf(k) !== -1; })) return '組長';
  return '維護工程師';
}

/**
 * _getRoleWeights — 依職能回傳 P% / T% 權重
 * 部門主管: P=0.3, T=0.7
 * 組長:     P=0.6, T=0.4
 * 維護工程師: P=0.8, T=0.2（預設）
 */
function _getRoleWeights(role) {
  if (role === '部門主管')   return { P: 0.3, T: 0.7 };
  if (role === '組長')       return { P: 0.6, T: 0.4 };
  if (role === '資深工程師') return { P: 0.6, T: 0.4 };
  return { P: 0.8, T: 0.2 };
}

/**
 * _getIncentive — 依綜合達成率回傳激勵加成倍數
 * ≥120% → 1.5, ≥100% → 1.2, ≥90% → 1.0,
 * ≥80% → 0.8, ≥60% → 0.6, ≥40% → 0.3, <40% → 0
 */
function _getIncentive(overallAchieve) {
  if (overallAchieve >= 1.2) return 1.5;
  if (overallAchieve >= 1.0) return 1.2;
  if (overallAchieve >= 0.9) return 1.0;
  if (overallAchieve >= 0.8) return 0.8;
  if (overallAchieve >= 0.6) return 0.6;
  if (overallAchieve >= 0.4) return 0.3;
  return 0;
}

// ──────────────────────────────────────────────
// HELPER FUNCTIONS
// ──────────────────────────────────────────────

/**
 * _getSheetData — 讀整張 sheet，回傳 [{col:val,...},...] array
 * 第 1 列視為標題列，之後每列轉成以標題為 key 的物件
 */
function _getSheetData(sheetName) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到工作表：' + sheetName);

  var values  = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0].map(function(h) { return String(h).trim(); });
  var result  = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var obj = {};
    headers.forEach(function(h, idx) {
      obj[h] = row[idx];
    });
    result.push(obj);
  }

  return result;
}

/**
 * _getUserFromSheet — 查 users sheet，回傳完整 user object（含 status）或 null
 * users sheet 欄位：email | display_name | team | role | status
 * 注意：不過濾 status，由呼叫端自行判斷
 */
function _getUserFromSheet(email) {
  if (!email) return null;

  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('users');
  if (!sheet) return null;

  var values  = sheet.getDataRange().getValues();
  var headers = values[0].map(function(h) { return String(h).trim(); });

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var obj = {};
    headers.forEach(function(h, idx) { obj[h] = row[idx]; });

    if (String(obj['email']).trim().toLowerCase() === email.toLowerCase()) {
      return {
        email:        String(obj['email']).trim(),
        display_name: String(obj['display_name'] || ''),
        team:         String(obj['team']          || ''),
        role:         String(obj['role']          || ''),
        status:       String(obj['status']        || '').trim(),
        password:     String(obj['password']      || '').trim(),
      };
    }
  }

  return null;
}

/**
 * _jsonResponse — 回傳 JSON ContentService 物件
 */
function _jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// signed: Cool | 2026-04-19 09:45:00 UTC | task-20260419-getdata-server-side-calc

// ──────────────────────────────────────────────
// ONE-TIME UTILITY（執行後可刪除）
// ──────────────────────────────────────────────

/**
 * fillJobRole — 一次性執行函式，執行後可刪除。
 *
 * 讀取「團員年度目標」工作表，依據姓名關鍵字批次填入「職能」欄位。
 * 對照規則：
 *   部門主管 → Karl / Nick / Ellis / Jack / Jimmy
 *   組長     → Rex / Arthur / Michael / Steven / Evan / Patrick / Will
 *   其他     → 維護工程師
 * 姓名為空或含 @ （email 格式）→ 跳過不填
 */
function fillJobRole() {
  const 部門主管 = ['Karl', 'Nick', 'Ellis', 'Jack', 'Jimmy'];
  const 組長    = ['Rex', 'Arthur', 'Michael', 'Steven', 'Evan', 'Patrick', 'Will'];

  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('團員年度目標');
  if (!sheet) {
    Logger.log('找不到工作表：團員年度目標');
    return;
  }

  const values  = sheet.getDataRange().getValues();
  if (values.length < 2) {
    Logger.log('工作表無資料列');
    return;
  }

  // 找標題列中「姓名」與「職能」的欄索引（0-based）
  const headers     = values[0].map(function(h) { return String(h).trim(); });
  const nameColIdx  = headers.indexOf('姓名');
  const roleColIdx  = headers.indexOf('職能');

  if (nameColIdx === -1) { Logger.log('找不到「姓名」欄'); return; }
  if (roleColIdx === -1) { Logger.log('找不到「職能」欄'); return; }

  let updatedCount = 0;

  for (let i = 1; i < values.length; i++) {
    const name = String(values[i][nameColIdx] || '').trim();

    // 跳過空白或 email 格式的列
    if (!name || name.indexOf('@') !== -1) continue;

    let roleValue = '維護工程師';

    if (部門主管.some(function(kw) { return name.indexOf(kw) !== -1; })) {
      roleValue = '部門主管';
    } else if (組長.some(function(kw) { return name.indexOf(kw) !== -1; })) {
      roleValue = '組長';
    }

    // sheet.getRange 用 1-based row/col
    sheet.getRange(i + 1, roleColIdx + 1).setValue(roleValue);
    updatedCount++;
  }

  Logger.log('完成，共更新 ' + updatedCount + ' 行（資料列 2 ~ ' + values.length + '）');
}

// signed: Cool | 2026-04-19 10:00:00 UTC | task-20260419-fill-job-role
