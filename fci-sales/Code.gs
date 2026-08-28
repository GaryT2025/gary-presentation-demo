/**
 * ============================================================
 * FCI Sales Dashboard - Ragic to Google Sheets 同步腳本
 * ============================================================
 * 
 * 本腳本包含三大資料源的同步：
 * 1. Current_Cases (商機進行中案件 - crm2/1)
 * 2. 接單 (FCI 已成交專案 - ragicsales-order-management/5)
 * 3. 業績目標 (歷年年度/季度目標與子表格展開 - forms24/21)
 * 4. 歷史快照 (Snapshot_History)
 * 
 * 敏感資訊 (RAGIC_API_KEY, SPREADSHEET_ID) 建議存放於 Google Apps Script 的指令碼屬性中。
 */

// 讀取屬性服務中的 API 金鑰與 Sheet ID (請於 GAS 專案設定中建立 RAGIC_API_KEY 與 SPREADSHEET_ID)
const R_API_KEY = PropertiesService.getScriptProperties().getProperty("RAGIC_API_KEY");
const R_SS_ID   = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");

const SYNC_CONFIG = {
  "Current_Cases": {
    url: "https://ap7.ragic.com/FCIGroup/crm2/1",
    filterId: "106", // 進行中篩選器
    cols: [
      "_ragicId", "opportunity_id", "stage", "rfq", "name", "customer", "brand",
      "owner", "updated_date", "progress", "currency", "quote_amount",
      "expected_amount", "expected_twd", "status", "quarter", "focus", "action",
      "group", "Power/NonPower", "bu", "days", "stale", "missing_amount"
    ],
    fieldIds: {
      "opportunity_id": "1032519",
      "stage": "1032520",
      "rfq": "1032566",
      "name": "1032555",
      "customer": "1032556",
      "brand": "1032568",
      "owner": "1033103",
      "updated_date": "1034289", // 最後更新日期
      "progress": "1111111216",  // 最新進度更新內容
      "currency": "1032572",
      "quote_amount": "1111111217", // 最新報價金額
      "expected_amount": "1048050",  // 預計成案金額
      "expected_twd": "1048833",     // 預計成案金額 (台幣)
      "status": "1041584",           // 案件狀態
      "quarter": "1048048",          // 預計成案季度
      "focus": "1048374",            // 重點關注
      "action": "1037899",           // Management 主管本週處置
      "group": "1033101",            // 業務組別
      "Power/NonPower": "1033101",   // 同一欄位 (業務組別) 的別名，供前端直接使用
      "bu": "1032872"                // BU
    }
  },
  "接單": {
    url: "https://ap7.ragic.com/FCIGroup/ragicsales-order-management/5",
    // filterId: "103", // 若要改為僅同步當季簽核文件，請取消此行註解
    cols: [
      "_ragicId", "project_id", "group", "Power/NonPower", "owner", "customer", "顧客簡稱", "amount_twd",
      "profit_twd", "ebt_rate", "status", "cust_order_id", "created_date",
      "Industry (新)", "專案類型 (2)"
    ],
    fieldIds: {
      "project_id": "1003974",
      "group": "1000279",   // 業務組別
      "Power/NonPower": "1039535", // Power/NonPower 獨立欄位
      "owner": "3000643",   // 責任業務
      "customer": "3000647", // 顧客名稱
      "顧客簡稱": "1002868",  // 顧客簡稱
      "amount_twd": "1000278", // 專案金額 (台幣)
      "profit_twd": "1000281",
      "ebt_rate": "1000282",
      "status": "1032022",
      "cust_order_id": "1003932",
      "created_date": "1000294", // 建檔日期
      "Industry (新)": "1042207",
      "專案類型 (2)": "1044216"
    }
  },
  "業績目標": {
    url: "https://ap7.ragic.com/FCIGroup/forms24/21",
    subtable: "_subtable_1022832"
  }
};

/**
 * 一鍵同步所有 Ragic 資料表
 */
function sync_所有資料() {
  console.log("=== 開始同步所有 Ragic 資料表 ===");
  syncRagicToSheet();
  syncOrders();
  syncPerformanceTargetWithSubtable();
  console.log("=== 所有 Ragic 資料表同步完成 ===");
}

/**
 * 1. 同步 CRM 進行中案件 (Current_Cases)
 */
function syncRagicToSheet() {
  const tableName = "Current_Cases";
  const config = SYNC_CONFIG[tableName];
  console.log(`[${tableName}] 開始同步...`);
  
  const ss = SpreadsheetApp.openById(R_SS_ID);
  let sheet = ss.getSheetByName(tableName);
  if (!sheet) sheet = ss.insertSheet(tableName);
  
  // 初始化標題與動態追加欄位
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, config.cols.length).setValues([config.cols]);
  }
  
  let headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0].map(h => h.toString().trim());
  let headerChanged = false;
  config.cols.forEach(col => {
    if (headers.indexOf(col) === -1) {
      headers.push(col);
      headerChanged = true;
    }
  });
  if (headerChanged) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  
  const ragicIdIdx = headers.indexOf("_ragicId");
  if (ragicIdIdx === -1) throw new Error("標題列缺少 _ragicId 欄位");
  
  // 讀取現有 ID 映射
  let idMap = {};
  if (sheet.getLastRow() > 1) {
    const existingIds = sheet.getRange(2, ragicIdIdx + 1, sheet.getLastRow() - 1, 1).getValues();
    existingIds.forEach((row, idx) => {
      if (row[0] !== null && row[0] !== undefined && row[0] !== "") {
        idMap[row[0].toString()] = idx + 2;
      }
    });
  }
  
  const limit = 200;
  let offset = 0;
  let hasMore = true;
  let count = 0;
  const today = new Date();
  
  while (hasMore) {
    let apiUrl = `${config.url}?v=3&api&limit=${limit}&offset=${offset}&naming=EID`;
    if (config.filterId) apiUrl += `&filterId=${config.filterId}`;
    
    const response = UrlFetchApp.fetch(encodeURI(apiUrl), {
      headers: { "Authorization": "Basic " + R_API_KEY },
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      throw new Error(`Ragic API 請求失敗 code=${response.getResponseCode()}: ${response.getContentText()}`);
    }
    
    const data = JSON.parse(response.getContentText());
    const entries = Object.entries(data)
      .filter(([key, val]) => typeof val === 'object')
      .map(([key, val]) => {
        val["_ragicId"] = key;
        return val;
      });
      
    if (entries.length === 0) {
      hasMore = false;
    } else {
      const updateRows = [];
      const newRows = [];
      
      entries.forEach(entry => {
        const rowDataMap = { ...entry };
        
        // 欄位對應與計算邏輯
        headers.forEach(h => {
          if (rowDataMap[h] === undefined && config.fieldIds[h] !== undefined) {
            rowDataMap[h] = entry[config.fieldIds[h]];
          }
        });
        
        // 計算老化天數 (days) 與老化狀態 (stale)
        let days = 9999;
        let stale = false;
        const updateDateStr = rowDataMap["updated_date"] || "";
        if (updateDateStr) {
          const updateDate = new Date(updateDateStr);
          if (!isNaN(updateDate.getTime())) {
            const diffTime = Math.abs(today - updateDate);
            days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            if (days > 30) stale = true;
          }
        }
        rowDataMap["days"] = days;
        rowDataMap["stale"] = stale;
        
        // 金額未估判斷 (expected_amount)
        const expAmount = parseFloat(rowDataMap["expected_amount"]) || 0;
        rowDataMap["missing_amount"] = (expAmount === 0);
        
        // 確保 expected_twd 與其他數值有數值型別
        rowDataMap["expected_amount"] = expAmount;
        rowDataMap["expected_twd"] = parseFloat(rowDataMap["expected_twd"]) || 0;
        rowDataMap["quote_amount"] = parseFloat(rowDataMap["quote_amount"]) || 0;
        
        // 根據 headers 順序填入陣列
        const rowValues = headers.map(h => rowDataMap[h] !== undefined ? rowDataMap[h] : "");
        const rid = entry["_ragicId"] ? entry["_ragicId"].toString() : null;
        
        if (rid && idMap[rid]) {
          updateRows.push({ rowNum: idMap[rid], values: rowValues });
        } else {
          newRows.push({ rid, values: rowValues });
        }
      });
      
      // 批次更新
      updateRows.forEach(r => {
        sheet.getRange(r.rowNum, 1, 1, headers.length).setValues([r.values]);
      });
      
      // 批次寫入新資料
      if (newRows.length > 0) {
        const startRowNum = sheet.getLastRow() + 1;
        sheet.getRange(startRowNum, 1, newRows.length, headers.length)
             .setValues(newRows.map(r => r.values));
        newRows.forEach((r, i) => {
          if (r.rid) idMap[r.rid] = startRowNum + i;
        });
      }
      
      count += entries.length;
      offset += entries.length;
      if (entries.length < limit) hasMore = false;
    }
  }
  console.log(`[${tableName}] 同步完成，共 ${count} 筆。`);
}

/**
 * 2. 同步 FCI 已成交專案 (接單)
 */
function syncOrders() {
  const tableName = "接單";
  const config = SYNC_CONFIG[tableName];
  console.log(`[${tableName}] 開始同步...`);
  
  const ss = SpreadsheetApp.openById(R_SS_ID);
  let sheet = ss.getSheetByName(tableName);
  if (!sheet) sheet = ss.insertSheet(tableName);
  
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, config.cols.length).setValues([config.cols]);
  }
  
  let headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0].map(h => h.toString().trim());
  let headerChanged = false;
  config.cols.forEach(col => {
    if (headers.indexOf(col) === -1) {
      headers.push(col);
      headerChanged = true;
    }
  });
  if (headerChanged) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  
  const ragicIdIdx = headers.indexOf("_ragicId");
  if (ragicIdIdx === -1) throw new Error("標題列缺少 _ragicId 欄位");
  
  const isFullSync = !config.filterId;
  const allRows = [];
  let idMap = {};
  
  // 增量模式時讀取既有 ID 映射
  if (!isFullSync && sheet.getLastRow() > 1) {
    const existingIds = sheet.getRange(2, ragicIdIdx + 1, sheet.getLastRow() - 1, 1).getValues();
    existingIds.forEach((row, idx) => {
      if (row[0] !== null && row[0] !== undefined && row[0] !== "") {
        idMap[row[0].toString()] = idx + 2;
      }
    });
  }
  
  const limit = 200;
  let offset = 0;
  let hasMore = true;
  let count = 0;
  
  while (hasMore) {
    let apiUrl = `${config.url}?v=3&api&listing=true&limit=${limit}&offset=${offset}&naming=EID`;
    if (config.filterId) apiUrl += `&filterId=${config.filterId}`;
    const response = UrlFetchApp.fetch(encodeURI(apiUrl), {
      headers: { "Authorization": "Basic " + R_API_KEY },
      muteHttpExceptions: true
    });
    
    if (response.getResponseCode() !== 200) {
      throw new Error(`Ragic API 請求失敗 code=${response.getResponseCode()}`);
    }
    
    const data = JSON.parse(response.getContentText());
    const entries = Object.entries(data)
      .filter(([key, val]) => typeof val === 'object')
      .map(([key, val]) => {
        val["_ragicId"] = key;
        return val;
      });
      
    if (entries.length === 0) {
      hasMore = false;
    } else {
      const updateRows = [];
      const newRows = [];
      
      const fieldIdByHeaderCasing = {};
      headers.forEach(h => {
        const lowerH = h.toLowerCase();
        for (const fKey in config.fieldIds) {
          if (fKey.toLowerCase() === lowerH) {
            fieldIdByHeaderCasing[h] = config.fieldIds[fKey];
            break;
          }
        }
      });
      
      const amountTwdKey = headers.find(h => h.toLowerCase() === "amount_twd") || "amount_twd";
      const profitTwdKey = headers.find(h => h.toLowerCase() === "profit_twd") || "profit_twd";
      const ebtRateKey = headers.find(h => h.toLowerCase() === "ebt_rate") || "ebt_rate";
      
      entries.forEach(entry => {
        const rowDataMap = { ...entry };
        
        headers.forEach(h => {
          if (rowDataMap[h] === undefined && fieldIdByHeaderCasing[h] !== undefined) {
            rowDataMap[h] = entry[fieldIdByHeaderCasing[h]];
          }
        });
        
        // 數值與費率清理與轉換
        const cleanVal = (v) => {
          if (v === undefined || v === null) return 0;
          if (typeof v === 'number') return v;
          const cleaned = String(v).replace(/[^0-9.-]/g, '').trim();
          return parseFloat(cleaned) || 0;
        };
        rowDataMap[amountTwdKey] = cleanVal(rowDataMap[amountTwdKey]);
        rowDataMap[profitTwdKey] = cleanVal(rowDataMap[profitTwdKey]);
        rowDataMap[ebtRateKey] = cleanVal(rowDataMap[ebtRateKey]);
        
        const rowValues = headers.map(h => rowDataMap[h] !== undefined ? rowDataMap[h] : "");
        const rid = entry["_ragicId"] ? entry["_ragicId"].toString() : null;
        
        if (isFullSync) {
          allRows.push(rowValues);
        } else {
          if (rid && idMap[rid]) {
            updateRows.push({ rowNum: idMap[rid], values: rowValues });
          } else {
            newRows.push({ rid, values: rowValues });
          }
        }
      });
      
      if (!isFullSync) {
        updateRows.forEach(r => {
          sheet.getRange(r.rowNum, 1, 1, headers.length).setValues([r.values]);
        });
        
        if (newRows.length > 0) {
          const startRowNum = sheet.getLastRow() + 1;
          sheet.getRange(startRowNum, 1, newRows.length, headers.length)
               .setValues(newRows.map(r => r.values));
          newRows.forEach((r, i) => {
            if (r.rid) idMap[r.rid] = startRowNum + i;
          });
        }
      }
      
      count += entries.length;
      offset += entries.length;
      if (entries.length < limit) hasMore = false;
    }
  }
  
  // 全量同步時一次清空並寫入全量資料，防止舊資料殘留
  if (isFullSync && allRows.length > 0) {
    const prevLastRow = sheet.getLastRow();
    sheet.getRange(2, 1, allRows.length, headers.length).setValues(allRows);
    if (prevLastRow > allRows.length + 1) {
      const surplus = prevLastRow - (allRows.length + 1);
      const blankRows = Array.from({ length: surplus }, () => new Array(headers.length).fill(""));
      sheet.getRange(2 + allRows.length, 1, surplus, headers.length).setValues(blankRows);
    }
  }
  
  console.log(`[${tableName}] 同步完成，共 ${count} 筆 (${isFullSync ? '全量覆蓋' : '增量更新'})。`);
}

/**
 * 3. 同步業績目標並開展子表格 (業績目標)
 */
function syncPerformanceTargetWithSubtable() {
  const tableName = "業績目標";
  const config = SYNC_CONFIG[tableName];
  const SUBTABLE = config.subtable;
  console.log(`[${tableName}] 開始子表展開同步...`);
  
  // 主記錄與子表格的欄位對照 (EID)
  const M = {
    salesPerson: "1021318", listTeam: "1041613", team: "1021326", bu: "1021580",
    // 2026-08-27 新增：部門層級目標欄位 (掛在主記錄上，非子表格；不隨年份變動)
    powerSalesTarget: "1048648", nonPowerSalesTarget: "1048649",
    powerEbtTarget: "1048650", nonPowerEbtTarget: "1048651",
    execTargetP: "1048666", execTargetNP: "1048667"
  };
  const S = { year: "1022829", salesTarget: "1022830", execTarget: "1031790", ebtTarget: "1022831" };

  const headers = ["_row_key", "_ragicId", "Sales Person", "列表頁Team", "Team", "BU", "年份",
                   "Sales Amount Target", "Execution Target", "EBT Target", "_year_quarter",
                   "Power Sales Target", "NonPower Sales Target", "Power EBT Target",
                   "NonPower EBT Target", "Execution Target (P)", "Execution Target (NP)"];
                   
  const apiUrl = `${config.url}?v=3&api&naming=EID&limit=1000`;
  const response = UrlFetchApp.fetch(encodeURI(apiUrl), {
    headers: { "Authorization": "Basic " + R_API_KEY },
    muteHttpExceptions: true
  });
  
  if (response.getResponseCode() !== 200) {
    console.error(`[業績目標] API 抓取失敗 code=${response.getResponseCode()}`);
    return;
  }
  
  const data = JSON.parse(response.getContentText());
  const rows = [];
  
  Object.entries(data)
    .filter(([key, val]) => val && typeof val === "object")
    .forEach(([mid, m]) => {
      // 篩選 BU=FCI-TW (FCI 團隊目標)
      const buVal = m[M.bu] || "";
      if (buVal !== "FCI-TW") return;
      
      // 部門層級目標欄位：掛在主記錄上、不隨年份變動。保守做法：只要任一欄位非空就視為
      // 「這筆記錄帶有部門目標資訊」，該主記錄展開出的每一列年度資料都重複帶上同一組值。
      // 數值清理比照 syncOrders() 的 cleanVal：Ragic 大金額常回傳帶逗號字串 (如 "243,500,000")，
      // 直接 parseFloat 會在逗號處截斷 (變成 243)，故先去除非數字字元再轉換。
      const cleanAmount = (v) => {
        if (v === undefined || v === null || v === "") return 0;
        if (typeof v === 'number') return v;
        const cleaned = String(v).replace(/[^0-9.-]/g, '').trim();
        return parseFloat(cleaned) || 0;
      };
      const powerSalesTarget = cleanAmount(m[M.powerSalesTarget]);
      const nonPowerSalesTarget = cleanAmount(m[M.nonPowerSalesTarget]);
      const powerEbtTarget = cleanAmount(m[M.powerEbtTarget]);
      const nonPowerEbtTarget = cleanAmount(m[M.nonPowerEbtTarget]);
      const execTargetP = cleanAmount(m[M.execTargetP]);
      const execTargetNP = cleanAmount(m[M.execTargetNP]);

      const sub = m[SUBTABLE] || {};
      Object.keys(sub).forEach(sk => {
        const s = sub[sk];
        const yr = s[S.year] ? String(s[S.year]).trim() : "";
        if (!yr) return; // 無年份跳過

        rows.push([
          mid + "-" + yr,
          mid,
          m[M.salesPerson] || "",
          m[M.listTeam] || "",
          m[M.team] || "",
          buVal,
          yr,
          parseFloat(s[S.salesTarget]) || 0,
          parseFloat(s[S.execTarget]) || 0,
          parseFloat(s[S.ebtTarget]) || 0,
          yr,
          powerSalesTarget,
          nonPowerSalesTarget,
          powerEbtTarget,
          nonPowerEbtTarget,
          execTargetP,
          execTargetNP
        ]);
      });
    });
    
  // 排序
  rows.sort((a, b) => (Number(a[1]) - Number(b[1])) || String(a[6]).localeCompare(String(b[6])));
  
  const ss = SpreadsheetApp.openById(R_SS_ID);
  let sheet = ss.getSheetByName(tableName);
  if (!sheet) sheet = ss.insertSheet(tableName);
  
  const prevLastRow = sheet.getLastRow();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  
  // 清理尾部多餘資料
  const prevDataRows = Math.max(0, prevLastRow - 1);
  if (prevDataRows > rows.length) {
    const surplus = prevDataRows - rows.length;
    const blankRow = new Array(headers.length).fill("");
    sheet.getRange(2 + rows.length, 1, surplus, headers.length)
         .setValues(Array.from({ length: surplus }, () => blankRow.slice()));
  }
  
  console.log(`[業績目標] 子表展開完成：主記錄 ${Object.keys(data).length} ➔ 展開 ${rows.length} 列。`);
}

/**
 * 4. 每週一 6:00 建立週快照，並運算統計 KPI (summary)
 */
function createWeeklySnapshot() {
  console.log("=== 開始建立週快照與彙總統計 ===");
  
  // 1. 同步最新資料
  sync_所有資料();
  
  const ss = SpreadsheetApp.openById(R_SS_ID);
  const currentCasesSheet = ss.getSheetByName("Current_Cases");
  const ordersSheet = ss.getSheetByName("接單");
  const targetsSheet = ss.getSheetByName("業績目標");
  
  let historySheet = ss.getSheetByName("Snapshot_History");
  if (!historySheet) historySheet = ss.insertSheet("Snapshot_History");
  
  const today = new Date();
  // 取得快照日期 YYYY-MM-DD
  const snapshotDateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const currentYearStr = String(today.getFullYear());
  const currentMonthStr = String(today.getMonth() + 1).padStart(2, "0"); // "08" 等
  
  // 2. 讀取目前的 Current_Cases 資料
  const casesLastRow = currentCasesSheet.getLastRow();
  if (casesLastRow <= 1) {
    console.warn("當前無任何商機資料，快照中止。");
    return;
  }
  
  const casesHeaders = currentCasesSheet.getRange(1, 1, 1, currentCasesSheet.getLastColumn()).getValues()[0];
  const casesData = currentCasesSheet.getRange(2, 1, casesLastRow - 1, currentCasesSheet.getLastColumn()).getValues();
  
  const ownerIdx = casesHeaders.indexOf("owner");
  const expTwdIdx = casesHeaders.indexOf("expected_twd");
  const focusIdx = casesHeaders.indexOf("focus");
  const staleIdx = casesHeaders.indexOf("stale");
  const missingIdx = casesHeaders.indexOf("missing_amount");
  const groupIdx = casesHeaders.indexOf("group");
  
  // 3. 讀取已成交「接單」資料
  const ordersData = ordersSheet.getLastRow() > 1 
    ? ordersSheet.getRange(2, 1, ordersSheet.getLastRow() - 1, ordersSheet.getLastColumn()).getValues()
    : [];
  const ordersHeaders = ordersSheet.getRange(1, 1, 1, ordersSheet.getLastColumn()).getValues()[0];
  
  const orderYearIdx = ordersHeaders.indexOf("专案年份"); // 如果是數字則以 created_date 分解
  const orderDateIdx = ordersHeaders.indexOf("created_date");
  const orderAmtIdx = ordersHeaders.indexOf("amount_twd");
  const orderGroupIdx = ordersHeaders.indexOf("group");
  
  // 4. 讀取「業績目標」資料
  const targetsData = targetsSheet.getLastRow() > 1
    ? targetsSheet.getRange(2, 1, targetsSheet.getLastRow() - 1, targetsSheet.getLastColumn()).getValues()
    : [];
  const targetsHeaders = targetsSheet.getRange(1, 1, 1, targetsSheet.getLastColumn()).getValues()[0];
  
  const targetYearIdx = targetsHeaders.indexOf("年份");
  const targetSalesIdx = targetsHeaders.indexOf("Sales Amount Target");
  const targetGroupIdx = targetsHeaders.indexOf("列表頁Team"); // 儲存組別 (COS/CVS/SAS/PAS 等)
  
  // 5. 計算 summary 指標（進行中、成交、目標）
  // 為了支持切換組別，此處快照將寫入全量 cases。在 Dashboard JSON 層面可動態加總。
  // 在快照表中，我們需要存儲每一列的快照資訊：
  // 結構：[快照日期, ...Current_Cases 的欄位]
  const historyHeaders = ["Snapshot_Date"].concat(casesHeaders);
  if (historySheet.getLastRow() === 0) {
    historySheet.getRange(1, 1, 1, historyHeaders.length).setValues([historyHeaders]);
  }
  
  // 檢查是否已存在同日期快照，如存在則先刪除，防止重複
  const histLastRow = historySheet.getLastRow();
  if (histLastRow > 1) {
    const dates = historySheet.getRange(2, 1, histLastRow - 1, 1).getValues();
    // 從後往前刪除，避免行號偏移
    for (let i = dates.length - 1; i >= 0; i--) {
      const dVal = dates[i][0];
      let dStr = "";
      if (dVal instanceof Date) {
        dStr = `${dVal.getFullYear()}-${String(dVal.getMonth() + 1).padStart(2, "0")}-${String(dVal.getDate()).padStart(2, "0")}`;
      } else {
        dStr = String(dVal).trim();
      }
      if (dStr === snapshotDateStr) {
        historySheet.deleteRow(i + 2);
      }
    }
  }
  
  // 寫入快照列
  const snapshotRows = casesData.map(row => [snapshotDateStr].concat(row));
  historySheet.getRange(historySheet.getLastRow() + 1, 1, snapshotRows.length, historyHeaders.length).setValues(snapshotRows);
  
  console.log(`[Snapshot] 成功寫入 ${snapshotDateStr} 快照，共 ${snapshotRows.length} 筆資料。`);
}

/**
 * 5. Web App JSON 端點 (doGet)
 * # [READY_FOR_REVIEW] - Phase 1 Backend API Endpoint
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.openById(R_SS_ID);
    
    const getSheetData = (sheetName) => {
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet || sheet.getLastRow() < 2) return [];
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
      const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
      return rows.map(row => {
        const obj = {};
        headers.forEach((h, idx) => {
          let val = row[idx];
          if (val instanceof Date) {
            val = val.toISOString().split('T')[0];
          }
          obj[h] = val;
        });
        return obj;
      });
    };

    const payload = {
      status: "success",
      timestamp: new Date().toISOString(),
      current_cases: getSheetData("Current_Cases"),
      orders: getSheetData("接單"),
      targets: getSheetData("業績目標"),
      snapshots: getSheetData("Snapshot_History")
    };

    const output = ContentService.createTextOutput(JSON.stringify(payload));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  } catch (err) {
    const errorPayload = {
      status: "error",
      message: err.toString(),
      timestamp: new Date().toISOString()
    };
    const output = ContentService.createTextOutput(JSON.stringify(errorPayload));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }
}

/**
 * 輔助方法：清除試算表設定屬性
 */
function clearAllProperties() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  console.log("所有 Script Properties 已清除。");
}

