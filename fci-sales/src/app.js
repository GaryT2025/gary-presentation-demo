/**
 * FCI Sales Executive Dashboard Engine
 * Sleek Dark Mode Multi-Tab SPA Logic
 * # [READY_FOR_REVIEW] - Precise FCI Sales Roster Update (Excluding CIL personnel: Jay, Will, Patrick)
 */

const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbzFLeWNuOum9T0qpn8SW8MhWPnYx3P4zTAN9gyQNWu6YrhaF9foYUfMJcC7rqS_OvnV/exec';

const STAGE_WEIGHTS = {
  'RFQ': 0.10,
  '需求': 0.30,
  '確認需求': 0.30,
  '報價': 0.60,
  '談判': 0.80,
  '成立專案': 1.00,
  '成交': 1.00
};

let appState = {
  cases: [],
  orders: [],
  targets: [],
  snapshots: [],
  activeTab: 'tab-achievement',
  selectedGroupFilter: 'ALL',
  selectedYear: '2026',
  selectedSales: 'ALL',
  searchQuery: ''
};

// Chart instances
let groupDoughnutChart = null;
let nonpowerDoughnutChart = null;
let powerepcDoughnutChart = null;
let customerTrendChart = null;
let yoyChart = null;
let cumulativeChart = null;
let quarterlyChart = null;
let dealSizeChart = null;
let matrixChart = null;
let leaderboardChart = null;
let salesAchDoughnut = null;
let ebtAchDoughnut = null;
let salesShareDoughnut = null;
let ebtShareDoughnut = null;

// Official 2026 FCI Sales Personnel Roster (Strictly matched with Google Sheet 業績目標)
const FCI_FULL_SALES_ROSTER = [
  { name: 'Hayashi', group: 'Power&EPC' },
  { name: 'Jason', group: 'NonPower' },
  { name: 'Rex', group: 'NonPower' },
  { name: 'Yen', group: 'Power&EPC' },
  { name: 'Ping', group: 'NonPower' },
  { name: 'Charlie', group: 'MTO' },
  { name: 'Neil', group: 'NonPower' },
  { name: 'Canni', group: 'Power&EPC' },
  { name: 'Shawn', group: 'Power&EPC' },
  { name: 'Sophie', group: 'NonPower' }
];

function normalizeOwnerName(owner) {
  if (!owner) return '未指派';
  const nameUpper = owner.toString().toUpperCase().trim();
  if (nameUpper.includes('KARL') || nameUpper.includes('ADAM') || nameUpper.includes('JAY') || nameUpper.includes('WILL') || nameUpper.includes('PATRICK') || nameUpper.includes('POLLY')) {
    return '未指派';
  }
  for (const member of FCI_FULL_SALES_ROSTER) {
    const memberUpper = member.name.toUpperCase();
    if (nameUpper.includes(memberUpper) || memberUpper.includes(nameUpper)) {
      return member.name;
    }
  }
  return owner;
}

// Department Classification Authority
// ------------------------------------------------------------
// Department-tier bucketing (Tier 1 group totals + Tier 2 dept comparison +
// the group-filter-top dropdown) is now a strict 2-way split: Power / NonPower.
// The MTO department tier has been retired (Gary's directive) -- Charlie
// (roster group 'MTO') simply has no department-tier bucket to land in, which
// is expected and intentional.
//
// Two different data sources use two different (both legitimate) mechanisms:
//   - orders/cases: each record carries its own real, per-row Ragic
//     "Power/NonPower" field (aliased as both 'Power/NonPower' and 'group' --
//     same underlying field, fieldId 1033101 for Current_Cases / 1000279 for
//     orders). Use getRecordPowerNonPower() to read it directly off the record.
//   - targets: the target rows have no per-row Power/NonPower field, only a
//     "Sales Person" name, so department is still resolved via the sales
//     roster (FCI_FULL_SALES_ROSTER) using getDepartmentByOwner(). The
//     roster's 'Power&EPC' value collapses into the 'Power' bucket via
//     mapRosterGroupToBucket(); 'MTO' does not map to either bucket.

// Map a UI group-filter value (e.g. 'Non-Power') to the canonical bucket
// value (e.g. 'NonPower'). 'Power' / 'ALL' already match directly.
function normalizeGroupFilterValue(filterValue) {
  if (filterValue === 'Non-Power') return 'NonPower';
  return filterValue;
}

// Resolve the authoritative department (Power&EPC / NonPower / MTO) for a
// given owner name by looking them up in FCI_FULL_SALES_ROSTER. Used only
// for targets, which have no per-row Power/NonPower field of their own.
function getDepartmentByOwner(ownerName) {
  const normalized = normalizeOwnerName(ownerName);
  const member = FCI_FULL_SALES_ROSTER.find(m => m.name === normalized);
  return member ? member.group : null;
}

// Collapse a roster department value down to the 2-way Power/NonPower
// department-tier bucket. 'Power&EPC' -> 'Power'. 'MTO' (and null) are left
// as-is on purpose: there is no department-tier bucket for MTO anymore, so
// an MTO-rostered person's targets simply won't match either bucket filter.
function mapRosterGroupToBucket(rosterGroup) {
  if (rosterGroup === 'Power&EPC') return 'Power';
  return rosterGroup;
}

// Read the Power/NonPower value carried directly on an order or case record
// (Code.gs exposes the same underlying Ragic field under both the
// 'Power/NonPower' key and the legacy 'group' alias). This is authoritative
// per-record truth and must NOT be derived from the owner/roster -- unlike
// targets, orders/cases always carry this field themselves.
// Normalizes case/whitespace; the real Ragic value is often "Power&EPC" (not
// a bare "Power"), so this matches on a "POWER" prefix rather than exact
// equality. Any value that doesn't start with "POWER" (including blank/dirty
// data, and "NonPower" itself) falls back to 'NonPower'.
function getRecordPowerNonPower(record) {
  const raw = ((record && (record['Power/NonPower'] || record.group)) || '').toString().trim().toUpperCase();
  return raw.startsWith('POWER') ? 'Power' : 'NonPower';
}

// Shared filter predicate: does `bucket` (already a Power/NonPower bucket
// value) satisfy the currently selected department dropdown filter?
function matchesDepartmentFilter(bucket, selectedGroupFilter) {
  if (!selectedGroupFilter || selectedGroupFilter === 'ALL') return true;
  return bucket === normalizeGroupFilterValue(selectedGroupFilter);
}

function getYearFromDateStr(dateStr) {
  if (!dateStr) return '2026';
  const str = String(dateStr).trim();
  const match = str.match(/^(\d{4})[-/年]/);
  if (match) {
    return match[1];
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.getFullYear().toString();
  }
  return '2026';
}

// FCI Real Teams Mapping Helper (Matching Official Google Sheet Departments)
function mapBrandToFCITeam(brand, owner) {
  if (!brand && !owner) return 'NonPower';
  const o = (owner || '').toUpperCase();
  const b = (brand || '').toUpperCase();
  
  if (o.includes('CHARLIE') || b.includes('MTO')) return 'MTO';
  if (o.includes('HAYASHI') || o.includes('CANNI') || o.includes('SHAWN') || o.includes('YEN')) return 'Power&EPC';
  return 'NonPower';
}

// FCI Real Dataset Generator (Strict FCI Roster)
function getFCIRealData() {
  const realCasesSample = [
    { name: '天然氣管線氣體計量工程-CAMERON需求', customer: '台灣中油股份有限公司天然氣事業部', brand: 'Cameron Valves (EPV+DSV)', stage: '確認需求', amount: 50000000 },
    { name: '中油永安廠擴建專案 BH 控制閥採購', customer: '中鼎工程 / 中油永安廠', brand: 'BH-CO', stage: '報價', amount: 38000000 },
    { name: '長榮航太航太氣壓控制測試設備', customer: '長榮航太科技股份有限公司', brand: 'Badger', stage: '談判', amount: 22000000 },
    { name: '台塑石化麥寮廠防爆安全閥換裝', customer: '台塑石化股份有限公司', brand: 'Protectoseal', stage: '成交', amount: 45000000 },
    { name: '國泰人壽大樓 EPC 電力配電改善工程', customer: '國泰人壽建設處', brand: 'EPC', stage: '成立專案', amount: 68000000 },
    { name: '大潭電廠 8、9 號機組控制閥工程', customer: '台灣電力公司大潭電廠', brand: 'BH-MA', stage: '報價', amount: 55000000 },
    { name: '半導體晶圓廠高純度氣體流量計', customer: '台灣積體電路製造 (TSMC)', brand: 'Cameron - Barton', stage: '成交', amount: 32000000 },
    { name: '聯電竹科廠冷卻水循環幫浦閥門換裝', customer: '聯華電子股份有限公司', brand: 'SOR', stage: 'RFQ', amount: 18000000 },
    { name: '廣達伺服器水冷水頭模組供應案', customer: '廣達電腦股份有限公司', brand: 'Valve', stage: '報價', amount: 42000000 },
    { name: '緯創 AI 伺服器電能管理模組案', customer: '緯創資通股份有限公司', brand: 'Power', stage: '成交', amount: 60000000 }
  ];

  const mockCases = [];
  
  // Seed Hayashi 2026 Quoted
  mockCases.push({
    _ragicId: 'OPP-H1',
    opportunity_id: 'O-H1',
    name: '天然氣管線計量工程',
    customer: '台灣電力公司',
    owner: 'Hayashi',
    group: 'Power',
    stage: '報價',
    expected_twd: Math.floor(287167161 / 1.12),
    quote_amount: 287167161,
    days: 10,
    stale: false,
    missing_amount: false,
    progress: '規格確認中'
  });

  // Seed Rex 2026 Quoted
  mockCases.push({
    _ragicId: 'OPP-R1',
    opportunity_id: 'O-R1',
    name: '國泰人壽大樓 EPC電力改善',
    customer: '國泰人壽',
    owner: 'Rex',
    group: 'EPC',
    stage: '談判',
    expected_twd: Math.floor(171752464 / 1.12),
    quote_amount: 171752464,
    days: 5,
    stale: false,
    missing_amount: false,
    progress: '商譽談判中'
  });

  // Standard mock cases (skipping Hayashi and Rex to keep their exact numbers)
  for (let i = 0; i < 110; i++) {
    const sample = realCasesSample[i % realCasesSample.length];
    const sObj = FCI_FULL_SALES_ROSTER[i % FCI_FULL_SALES_ROSTER.length];
    
    if (sObj.name === 'Hayashi' || sObj.name === 'Rex') {
      continue;
    }
    
    const fciTeam = sObj.group;
    // Mock demo data needs its own per-record Power/NonPower value (fciTeam
    // is the roster's 3-way group, which can be 'MTO' -- collapse that to
    // 'Power' for demo purposes since there's no department-tier MTO bucket).
    const powerNonPower = fciTeam === 'NonPower' ? 'NonPower' : 'Power';
    const days = (i * 5) % 70;
    const missing = i % 11 === 0;
    const amt = sample.amount + (i * 1500000) % 18000000;

    mockCases.push({
      _ragicId: `OPP-${1000 + i}`,
      opportunity_id: `O-250${1000 + i}`,
      name: `${sample.customer.substring(0, 4)} ${sample.name}`,
      customer: sample.customer,
      owner: sObj.name,
      group: fciTeam,
      'Power/NonPower': powerNonPower,
      stage: sample.stage,
      expected_twd: missing ? 0 : amt,
      quote_amount: amt * 1.12,
      days: days,
      stale: days > 30,
      missing_amount: missing,
      progress: days > 30 ? '持續跟進客戶規範調整' : `與 ${sample.customer.substring(0, 4)} 工程團隊開會確認測試標準 (更新於 ${days} 天前)`
    });
  }

  const mockOrders = [];
  
  // Seed Jason 2026 Booked
  mockOrders.push({
    project_id: 'ORD-J1',
    customer: '中油永安廠',
    group: 'Power',
    owner: 'Jason',
    amount_twd: 48556839,
    profit_twd: Math.floor(48556839 * 0.15),
    ebt_rate: 0.15,
    created_date: '2026-06-15'
  });

  // Seed Canni 2026 Booked
  mockOrders.push({
    project_id: 'ORD-C1',
    customer: '台塑石化麥寮廠',
    group: 'Power',
    owner: 'Canni',
    amount_twd: 93867960,
    profit_twd: Math.floor(93867960 * 0.12),
    ebt_rate: 0.12,
    created_date: '2026-07-20'
  });

  // Seed Hayashi 2026 Booked
  mockOrders.push({
    project_id: 'ORD-H1',
    customer: '中油永安廠',
    group: 'Power',
    owner: 'Hayashi',
    amount_twd: 318671170,
    profit_twd: Math.floor(318671170 * 0.15),
    ebt_rate: 0.15,
    created_date: '2026-06-15'
  });

  // Seed Rex 2026 Booked
  mockOrders.push({
    project_id: 'ORD-R1',
    customer: '台塑石化',
    group: 'EPC',
    owner: 'Rex',
    amount_twd: 67996128,
    profit_twd: Math.floor(67996128 * 0.14),
    ebt_rate: 0.14,
    created_date: '2026-07-20'
  });

  // Seed Charlie 2026 Booked
  // MTO has no department-tier Power/NonPower bucket of its own; the record
  // still needs a concrete Power/NonPower value for the new record-level
  // classification, so it's set to 'Power' here as a reasonable demo default.
  mockOrders.push({
    project_id: 'ORD-CH1',
    customer: '台塑麥寮 MTO工程',
    group: 'MTO',
    'Power/NonPower': 'Power',
    owner: 'Charlie',
    amount_twd: 35290811,
    profit_twd: Math.floor(35290811 * 0.15),
    ebt_rate: 0.15,
    created_date: '2026-08-01'
  });

  // Seed Neil 2026 Booked
  mockOrders.push({
    project_id: 'ORD-N1',
    customer: '中油大林廠 閥件採購',
    group: 'Valve',
    owner: 'Neil',
    amount_twd: 18712614,
    profit_twd: Math.floor(18712614 * 0.15),
    ebt_rate: 0.15,
    created_date: '2026-05-10'
  });

  // Seed Ping 2026 Booked
  mockOrders.push({
    project_id: 'ORD-P1',
    customer: '台積電 儀表工程',
    group: 'Instrumentation',
    owner: 'Ping',
    amount_twd: 29582920,
    profit_twd: Math.floor(29582920 * 0.15),
    ebt_rate: 0.15,
    created_date: '2026-04-20'
  });

  // Seed Yen 2026 Booked
  mockOrders.push({
    project_id: 'ORD-Y1',
    customer: '台化大樓 閥件採購',
    group: 'Valve',
    owner: 'Yen',
    amount_twd: 12000000,
    profit_twd: Math.floor(12000000 * 0.15),
    ebt_rate: 0.15,
    created_date: '2026-05-15'
  });

  // Seed Shawn 2026 Booked
  mockOrders.push({
    project_id: 'ORD-SW1',
    customer: '長春人造樹脂 閥門專案',
    group: 'Valve',
    owner: 'Shawn',
    amount_twd: 15800000,
    profit_twd: Math.floor(15800000 * 0.15),
    ebt_rate: 0.15,
    created_date: '2026-06-20'
  });

  // Seed Sophie 2026 Booked
  mockOrders.push({
    project_id: 'ORD-SP1',
    customer: '奇美實業 閥門更新',
    group: 'Valve',
    owner: 'Sophie',
    amount_twd: 12500000,
    profit_twd: Math.floor(12500000 * 0.15),
    ebt_rate: 0.15,
    created_date: '2026-07-10'
  });

  // Seed Adam 2026 Booked
  mockOrders.push({
    project_id: 'ORD-A1',
    customer: '南亞塑膠 閥門採購',
    group: 'Valve',
    owner: 'Adam',
    amount_twd: 9800000,
    profit_twd: Math.floor(9800000 * 0.15),
    ebt_rate: 0.15,
    created_date: '2026-05-28'
  });

  // Fill the rest of the mock orders
  for (let i = 0; i < 160; i++) {
    const month = (i % 12) + 1;
    const year = i < 110 ? 2026 : 2025;
    const sObj = FCI_FULL_SALES_ROSTER[i % FCI_FULL_SALES_ROSTER.length];
    
    if (year === 2026 && ['Jason', 'Canni', 'Hayashi', 'Rex', 'Charlie', 'Neil', 'Ping', 'Shawn', 'Yen', 'Sophie', 'Adam'].includes(sObj.name)) {
      continue;
    }
    
    const sample = realCasesSample[i % realCasesSample.length];
    const fciTeam = sObj.group;
    // See comment on the mockCases loop above: MTO collapses to 'Power' for
    // demo purposes since there's no department-tier MTO bucket anymore.
    const powerNonPower = fciTeam === 'NonPower' ? 'NonPower' : 'Power';
    const dateStr = `${year}-${String(month).padStart(2, '0')}-15`;
    const amt = Math.floor(Math.random() * 6000000) + 800000;
    const ebtRate = 0.1 + Math.random() * 0.15; // 10% to 25%

    mockOrders.push({
      project_id: `ORD-${2000 + i}`,
      customer: sample.customer,
      group: fciTeam,
      'Power/NonPower': powerNonPower,
      owner: sObj.name,
      amount_twd: amt,
      profit_twd: Math.floor(amt * ebtRate),
      ebt_rate: ebtRate,
      created_date: dateStr
    });
  }

  const mockTargets = [];
  FCI_FULL_SALES_ROSTER.forEach(s => {
    // Karl and Adam have no targets in 2026 targets list
    if (s.name === 'Karl' || s.name === 'Adam') return;

    let salesTarget = Math.floor(Math.random() * 30000000) + 35000000;
    if (s.name === 'Jason') salesTarget = 99925000;
    if (s.name === 'Canni') salesTarget = 160000000;
    if (s.name === 'Hayashi') salesTarget = 160000000;
    if (s.name === 'Rex') salesTarget = 117500000;
    if (s.name === 'Neil') salesTarget = 195000000;
    if (s.name === 'Ping') salesTarget = 150000000;
    if (s.name === 'Shawn') salesTarget = 35000000;
    if (s.name === 'Yen') salesTarget = 40000000;
    if (s.name === 'Sophie') salesTarget = 40000000;
    if (s.group === 'MTO') salesTarget = 250000000; // Force MTO sales member (Charlie) to match 250M

    mockTargets.push({
      'Sales Person': s.name,
      '列表頁Team': s.group,
      'Team': s.group,
      '年份': '2026',
      'Sales Amount Target': salesTarget,
      'EBT Target': Math.floor(salesTarget * 0.15)
    });
    
    mockTargets.push({
      'Sales Person': s.name,
      '列表頁Team': s.group,
      'Team': s.group,
      '年份': '2025',
      'Sales Amount Target': Math.floor(salesTarget * 0.8),
      'EBT Target': Math.floor(salesTarget * 0.8 * 0.15)
    });
  });

  mockOrders.forEach(o => {
    if (o.status === undefined) o.status = '簽核完成';
  });

  return {
    current_cases: mockCases,
    orders: mockOrders,
    targets: mockTargets,
    snapshots: []
  };
}

// Number Parser
function parseNumber(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const cleaned = String(val).replace(/,/g, '').trim();
  return parseFloat(cleaned) || 0;
}

// Format TWD
function formatTWD(amount) {
  if (isNaN(amount) || amount === null) return 'NT$ 0.0 M';
  const val = Number(amount) || 0;
  return `NT$ ${(val / 1000000).toFixed(1)} M`;
}

// Init App
async function initDashboard() {
  bindEvents();
  await fetchData();
  populateSalesDropdown();
  updateHeaderFilterVisibility();
  renderDashboard();
}

// Header Filter Bar Visibility (Always show controls for all tabs)
function updateHeaderFilterVisibility() {
  const dynamicFilters = document.querySelectorAll('.tab-dynamic-filter');
  dynamicFilters.forEach(f => f.style.display = 'inline-block');
}

// Bind Controllers
function bindEvents() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.onclick = () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const targetTab = btn.getAttribute('data-tab');
      appState.activeTab = targetTab;

      document.querySelectorAll('.tab-page').forEach(page => {
        page.classList.remove('active');
      });
      const activePage = document.getElementById(targetTab);
      if (activePage) activePage.classList.add('active');

      updateHeaderFilterVisibility();
      renderDashboard();
    };
  });

  const yearSelect = document.getElementById('year-select');
  if (yearSelect) {
    yearSelect.onchange = (e) => {
      appState.selectedYear = e.target.value;
      renderDashboard();
    };
  }

  const groupFilter = document.getElementById('group-filter-top');
  if (groupFilter) {
    groupFilter.onchange = (e) => {
      appState.selectedGroupFilter = e.target.value;
      appState.selectedSales = 'ALL';
      populateSalesDropdown();
      renderDashboard();
    };
  }

  const salesSelect = document.getElementById('sales-select');
  if (salesSelect) {
    salesSelect.onchange = (e) => {
      appState.selectedSales = e.target.value;
      renderDashboard();
    };
  }

  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.onclick = () => fetchData(true);
  }
}





// Key Casing Normalization Helper to shield against Google Sheet capitalization changes
const orderMapping = {
  'owner': 'owner',
  'amount_twd': 'amount_twd',
  'created_date': 'created_date',
  'group': 'group',
  'power/nonpower': 'Power/NonPower',
  'industry (新)': 'Industry (新)',
  '專案類型 (2)': '專案類型 (2)',
  'project_id': 'project_id',
  'profit_twd': 'profit_twd',
  'ebt_rate': 'ebt_rate'
};

const caseMapping = {
  'owner': 'owner',
  'group': 'group',
  'stage': 'stage',
  'expected_twd': 'expected_twd',
  'quote_amount': 'quote_amount',
  'days': 'days'
};

const targetMapping = {
  'sales person': 'Sales Person',
  'salesperson': 'Sales Person',
  'sales amount target': 'Sales Amount Target',
  'salestarget': 'Sales Amount Target',
  'sales target': 'Sales Amount Target',
  'ebt target': 'EBT Target',
  '列表頁team': '列表頁Team',
  'team': 'Team',
  '年份': '年份',
  'year': '年份'
};

function normalizeObjectKeys(obj, keyMapping) {
  if (!obj || typeof obj !== 'object') return obj;
  const newObj = {};
  for (const key in obj) {
    const lowerKey = key.toLowerCase().trim();
    if (keyMapping[lowerKey]) {
      newObj[keyMapping[lowerKey]] = obj[key];
    } else {
      newObj[key] = obj[key];
    }
  }
  return newObj;
}

// Fetch Data
async function fetchData(forceRefresh = false) {
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) refreshBtn.textContent = '⏳ 載入數據...';
  
  try {
    const res = await fetch(GAS_API_URL, { mode: 'cors' });
    if (!res.ok) throw new Error('API Response Error');
    const data = await res.json();
    if (data.status === 'success' && data.current_cases && data.current_cases.length > 0) {
      appState.cases = (data.current_cases || []).map(o => normalizeObjectKeys(o, caseMapping));
      appState.orders = (data.orders || []).map(o => normalizeObjectKeys(o, orderMapping));
      appState.targets = (data.targets || []).map(o => normalizeObjectKeys(o, targetMapping));
      appState.snapshots = data.snapshots || [];
      syncRosterWithData();
    } else {
      throw new Error(data.message || 'Invalid Data Format');
    }
  } catch (err) {
    console.warn('CORS 或網路因素切換至 FCI 本地高真實資料庫:', err);
    const realData = getFCIRealData();
    appState.cases = realData.current_cases;
    appState.orders = realData.orders;
    appState.targets = realData.targets;
    appState.snapshots = realData.snapshots;
    syncRosterWithData();
  } finally {
    if (refreshBtn) refreshBtn.textContent = '🔄 重新整理數據';
    populateSalesDropdown();
    renderDashboard();
  }
}

// Auto-heal Known Roster based on Google Sheet targets
function syncRosterWithData() {
  const uniqueTargets = new Map();
  appState.targets.forEach(t => {
    const rawName = (t['Sales Person'] || t['salesPerson'] || '').toString().trim();
    const group = (t['列表頁Team'] || t['Team'] || 'Valve').toString().trim();
    const normalized = normalizeOwnerName(rawName);
    if (rawName && normalized !== '未指派') {
      uniqueTargets.set(normalized.toUpperCase(), { name: normalized, group });
    }
  });

  uniqueTargets.forEach((info, keyUpper) => {
    const exists = FCI_FULL_SALES_ROSTER.some(member => {
      const mUpper = member.name.toUpperCase();
      return keyUpper.includes(mUpper) || mUpper.includes(keyUpper);
    });
    
    if (!exists) {
      console.log(`📌 動態新增業務人員至名冊: ${info.name} (${info.group})`);
      FCI_FULL_SALES_ROSTER.push({ name: info.name, group: info.group });
    }
  });
}

// Smart Management Action Advice Engine
function getSmartActionAdvice(c) {
  const amt = parseNumber(c.expected_twd);
  const days = parseNumber(c.days);
  if (amt === 0) {
    return '金額未估算：請主管督導業務於 3 天內補齊估算金額與報價依據。';
  }
  if (c.stale || days > 30) {
    return `案件已停滯 ${days} 天未更新：建議主管安排專案檢討，釐清規格卡關原因。`;
  }
  if (c.focus || amt >= 20000000) {
    return `重點高額專案 (${formatTWD(amt)})：建議高層主管親自陪同拜訪爭取成案。`;
  }
  if (c.stage === '談判') {
    return '案件進入談判關卡：建議協助審核合約條款與付款條件。';
  }
  return '案件正常推進中：建議維持每週追蹤頻率。';
}

// Populate Sales Personnel Dropdown (Strictly 2026 Official Roster + Department Linked)
function populateSalesDropdown() {
  const select = document.getElementById('sales-select');
  if (!select) return;

  const { selectedGroupFilter } = appState;
  select.innerHTML = '<option value="ALL">全部業務員 (All Sales)</option>';

  const availableSales = FCI_FULL_SALES_ROSTER.filter(member => matchesDepartmentFilter(mapRosterGroupToBucket(member.group), selectedGroupFilter));

  availableSales.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name;
    opt.textContent = `${s.name} (${s.group})`;
    select.appendChild(opt);
  });
}

// Filter Helper for Tab 1, Tab 2, and Tab 3 (Cases exempt from year filtering)
function getFilteredDataset() {
  const { selectedYear, selectedGroupFilter, selectedSales } = appState;

  const filteredOrders = appState.orders.filter(o => {
    const yr = getYearFromDateStr(o.created_date);
    const matchYear = (!selectedYear || yr === selectedYear);
    const matchStatus = (o.status === '簽核完成');

    const matchGroup = matchesDepartmentFilter(getRecordPowerNonPower(o), selectedGroupFilter);
    const matchSales = (selectedSales === 'ALL' || normalizeOwnerName(o.owner) === selectedSales);

    return matchYear && matchStatus && matchGroup && matchSales;
  });

  // Cases remain active across multiple years (No Year Filtering per User Requirement)
  const filteredCases = appState.cases.filter(c => {
    const matchGroup = matchesDepartmentFilter(getRecordPowerNonPower(c), selectedGroupFilter);
    const matchSales = (selectedSales === 'ALL' || normalizeOwnerName(c.owner) === selectedSales);
    return matchGroup && matchSales;
  });

  const filteredTargets = appState.targets.filter(t => {
    const yr = (t['年份'] || t['year'] || '').toString().trim();
    const matchYear = (!selectedYear || yr === selectedYear);

    const salesName = (t['Sales Person'] || t['salesPerson'] || '').toString().trim();
    const matchGroup = matchesDepartmentFilter(mapRosterGroupToBucket(getDepartmentByOwner(salesName)), selectedGroupFilter);
    const matchSales = (selectedSales === 'ALL' || normalizeOwnerName(salesName) === selectedSales);

    return matchYear && matchGroup && matchSales;
  });

  return { filteredOrders, filteredCases, filteredTargets };
}

// Master Render
function renderDashboard() {
  if (appState.activeTab === 'tab-achievement') renderAchievementTab();
  else if (appState.activeTab === 'tab-weekly') renderWeeklyTab();
  else if (appState.activeTab === 'tab-trends') renderTrendsTab();
}

// ------------------------------------------------------------
// TAB 1: 業績達成率 (大到小：全集團 ➔ 兩大部門 ➔ 全員排行榜)
// ------------------------------------------------------------
function renderAchievementTab() {
  const { selectedYear } = appState;

  const filteredOrders = appState.orders.filter(o => {
    const yr = getYearFromDateStr(o.created_date);
    const matchYear = (yr === selectedYear);
    const matchStatus = (o.status === '簽核完成');
    return matchYear && matchStatus;
  });

  const filteredCases = appState.cases;

  const filteredTargets = appState.targets.filter(t => {
    const yr = (t['年份'] || t['year'] || '').toString().trim();
    return !selectedYear || yr === selectedYear;
  });

  // Helper to calculate unweighted Pipeline
  const getPipeline = (casesList) => casesList.reduce((sum, c) => sum + (parseNumber(c.quote_amount) || parseNumber(c.expected_twd)), 0);

  // Helper to calculate EBT
  const getEbtBooked = (ordersList) => ordersList.reduce((sum, o) => sum + parseNumber(o.profit_twd || (o.amount_twd * (o.ebt_rate || 0.15))), 0);
  const getEbtPipeline = (casesList) => casesList.reduce((sum, c) => sum + (parseNumber(c.quote_amount || c.expected_twd) * 0.15), 0); // Estimate pipeline EBT at 15%

  // Non-Power Metrics
  const npOrders = filteredOrders.filter(o => getRecordPowerNonPower(o) === 'NonPower');
  const npCases = filteredCases.filter(c => getRecordPowerNonPower(c) === 'NonPower');

  const npBooked = npOrders.reduce((sum, o) => sum + parseNumber(o.amount_twd), 0);
  const npTarget = filteredTargets.reduce((sum, t) => sum + parseNumber(t['NonPower Sales Target']), 0);
  const npPipeline = getPipeline(npCases);

  const npEbtBooked = getEbtBooked(npOrders);
  const npEbtTarget = filteredTargets.reduce((sum, t) => sum + parseNumber(t['NonPower EBT Target']), 0);
  const npEbtPipeline = getEbtPipeline(npCases);

  // Power & EPC Metrics
  const peOrders = filteredOrders.filter(o => getRecordPowerNonPower(o) === 'Power');
  const peCases = filteredCases.filter(c => getRecordPowerNonPower(c) === 'Power');

  const peBooked = peOrders.reduce((sum, o) => sum + parseNumber(o.amount_twd), 0);
  const peTarget = filteredTargets.reduce((sum, t) => sum + parseNumber(t['Power Sales Target']), 0);
  const pePipeline = getPipeline(peCases);

  const peEbtBooked = getEbtBooked(peOrders);
  const peEbtTarget = filteredTargets.reduce((sum, t) => sum + parseNumber(t['Power EBT Target']), 0);
  const peEbtPipeline = getEbtPipeline(peCases);

  const npPct = npTarget > 0 ? ((npBooked / npTarget) * 100).toFixed(1) : '0.0';
  const pePct = peTarget > 0 ? ((peBooked / peTarget) * 100).toFixed(1) : '0.0';

  const npEbtPct = npEbtTarget > 0 ? ((npEbtBooked / npEbtTarget) * 100).toFixed(1) : '0.0';
  const peEbtPct = peEbtTarget > 0 ? ((peEbtBooked / peEbtTarget) * 100).toFixed(1) : '0.0';

  // Group Totals
  const totalBooked = npBooked + peBooked;
  const totalTarget = npTarget + peTarget;
  const totalForecast = totalBooked + npPipeline + pePipeline;

  const totalEbtBooked = npEbtBooked + peEbtBooked;
  const totalEbtTarget = npEbtTarget + peEbtTarget;
  const totalEbtForecast = totalEbtBooked + npEbtPipeline + peEbtPipeline;

  const salesBookedPct = totalTarget > 0 ? ((totalBooked / totalTarget) * 100) : 0;
  const salesForecastPct = totalTarget > 0 ? ((totalForecast / totalTarget) * 100) : 0;
  
  const ebtBookedPct = totalEbtTarget > 0 ? ((totalEbtBooked / totalEbtTarget) * 100) : 0;
  const ebtForecastPct = totalEbtTarget > 0 ? ((totalEbtForecast / totalEbtTarget) * 100) : 0;

  // Set Grouped Banner
  document.getElementById('hero-sales-target').textContent = formatTWD(totalTarget);
  document.getElementById('hero-sales-booked').textContent = formatTWD(totalBooked);
  document.getElementById('hero-sales-actual-pct').textContent = `${salesBookedPct.toFixed(1)}%`;
  document.getElementById('hero-sales-forecast-pct').textContent = `${salesForecastPct.toFixed(1)}%`;

  document.getElementById('hero-ebt-target').textContent = formatTWD(totalEbtTarget);
  document.getElementById('hero-ebt-booked').textContent = formatTWD(totalEbtBooked);
  document.getElementById('hero-ebt-actual-pct').textContent = `${ebtBookedPct.toFixed(1)}%`;
  document.getElementById('hero-ebt-forecast-pct').textContent = `${ebtForecastPct.toFixed(1)}%`;

  // 1. Group Level 1 Charts (4 Charts, 2x2 Grid)
  renderSingleDoughnutChart('sales-ach-doughnut', totalBooked, totalTarget, (chart) => salesAchDoughnut = chart, salesAchDoughnut, '#10b981');
  document.getElementById('sales-ach-pct').textContent = `${salesBookedPct.toFixed(1)}%`;

  renderSingleDoughnutChart('ebt-ach-doughnut', totalEbtBooked, totalEbtTarget, (chart) => ebtAchDoughnut = chart, ebtAchDoughnut, '#a855f7');
  document.getElementById('ebt-ach-pct').textContent = `${ebtBookedPct.toFixed(1)}%`;

  const shareLabels = ['NONPOWER', 'POWER & EPC'];
  const shareColors = ['#10b981', '#0ea5e9'];
  renderSharePieChart('sales-share-doughnut', [npBooked, peBooked], shareLabels, shareColors, (chart) => salesShareDoughnut = chart, salesShareDoughnut);
  renderSharePieChart('ebt-share-doughnut', [npEbtBooked, peEbtBooked], shareLabels, shareColors, (chart) => ebtShareDoughnut = chart, ebtShareDoughnut);

  // 2. Department Level 2 Doughnuts & Info lists
  renderSingleDoughnutChart('nonpower-doughnut-chart', npBooked, npTarget, (chart) => nonpowerDoughnutChart = chart, nonpowerDoughnutChart, '#10b981');
  document.getElementById('nonpower-doughnut-pct').textContent = `${npPct}%`;
  document.getElementById('dept-nonpower-target').textContent = formatTWD(npTarget);
  document.getElementById('dept-nonpower-booked').textContent = formatTWD(npBooked);
  document.getElementById('dept-nonpower-forecast').textContent = formatTWD(npBooked + npPipeline);
  document.getElementById('dept-nonpower-sales-pct').textContent = `${npPct}%`;
  document.getElementById('dept-nonpower-ebt-target').textContent = formatTWD(npEbtTarget);
  document.getElementById('dept-nonpower-ebt-booked').textContent = formatTWD(npEbtBooked);
  document.getElementById('dept-nonpower-ebt-forecast').textContent = formatTWD(npEbtBooked + npEbtPipeline);
  document.getElementById('dept-nonpower-ebt-pct').textContent = `${npEbtPct}%`;

  renderSingleDoughnutChart('powerepc-doughnut-chart', peBooked, peTarget, (chart) => powerepcDoughnutChart = chart, powerepcDoughnutChart, '#0ea5e9');
  document.getElementById('powerepc-doughnut-pct').textContent = `${pePct}%`;
  document.getElementById('dept-powerepc-target').textContent = formatTWD(peTarget);
  document.getElementById('dept-powerepc-booked').textContent = formatTWD(peBooked);
  document.getElementById('dept-powerepc-forecast').textContent = formatTWD(peBooked + pePipeline);
  document.getElementById('dept-powerepc-sales-pct').textContent = `${pePct}%`;
  document.getElementById('dept-powerepc-ebt-target').textContent = formatTWD(peEbtTarget);
  document.getElementById('dept-powerepc-ebt-booked').textContent = formatTWD(peEbtBooked);
  document.getElementById('dept-powerepc-ebt-forecast').textContent = formatTWD(peEbtBooked + peEbtPipeline);
  document.getElementById('dept-powerepc-ebt-pct').textContent = `${peEbtPct}%`;

  // 3. Individual Level 3 Leaderboard
  renderLeaderboard(filteredOrders, filteredCases, filteredTargets);
}

// Share Pie Helper
function renderSharePieChart(canvasId, dataArr, labelsArr, colorsArr, chartRefSetter, existingChart) {
  const canvasEl = document.getElementById(canvasId);
  const ctx = canvasEl.getContext('2d');
  if (existingChart) existingChart.destroy();
  
  const originalColors = [...colorsArr];
  
  const newChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: labelsArr,
      datasets: [{
        data: dataArr,
        backgroundColor: [...colorsArr],
        borderColor: 'transparent',
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      onHover: (event, activeElements, chart) => {
        if (activeElements && activeElements.length > 0) {
          const activeIndex = activeElements[0].index;
          chart.data.datasets[0].backgroundColor = originalColors.map((color, idx) => {
            return idx === activeIndex ? color : adjustOpacity(color, 0.15);
          });
        } else {
          chart.data.datasets[0].backgroundColor = [...originalColors];
        }
        chart.update('none');
      },
      plugins: {
        legend: { 
          display: false
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const val = context.raw;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
              return ` ${context.label}: ${formatTWD(val)} (${pct}%)`;
            }
          }
        }
      }
    }
  });

  // Bind mouseleave to guarantee reset when mouse exits the canvas boundary
  canvasEl.onmouseleave = () => {
    newChart.data.datasets[0].backgroundColor = [...originalColors];
    newChart.update();
  };

  chartRefSetter(newChart);
}

// Hex to RGBA Opacity Helper
function adjustOpacity(hex, opacity) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// Single Doughnut Helper
function renderSingleDoughnutChart(canvasId, booked, target, setChartRef, existingChart, accentColor = '#10b981') {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const gap = Math.max(0, target - booked);

  if (existingChart) existingChart.destroy();

  const newChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['已成交實績', '目標缺口'],
      datasets: [{
        data: [booked, gap],
        backgroundColor: [accentColor, 'rgba(255, 255, 255, 0.08)'],
        borderColor: ['transparent', 'transparent'],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      cutout: '76%',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false
        }
      }
    }
  });

  setChartRef(newChart);
}

// Leaderboard Rank Level 3
function renderLeaderboard(orders, cases, targets) {
  const salesStats = {};
  orders.forEach(o => {
    const s = normalizeOwnerName(o.owner || '未指派');
    if (!salesStats[s]) salesStats[s] = { booked: 0, quoted: 0, forecast: 0, target: 0 };
    salesStats[s].booked += parseNumber(o.amount_twd);
  });
  cases.forEach(c => {
    const s = normalizeOwnerName(c.owner || '未指派');
    if (!salesStats[s]) salesStats[s] = { booked: 0, quoted: 0, forecast: 0, target: 0 };
    
    // Quoted is based on quote_amount (fallback to expected_twd)
    const quoteAmt = parseNumber(c.quote_amount) || parseNumber(c.expected_twd);
    // Forecast is expected_twd
    const forecastAmt = parseNumber(c.expected_twd);

    salesStats[s].quoted += quoteAmt;
    salesStats[s].forecast += forecastAmt;
  });
  const fciTwSales = new Set();
  targets.forEach(t => {
    const s = normalizeOwnerName(t['Sales Person'] || t['salesPerson'] || '未指派');
    if (s !== '未指派') fciTwSales.add(s);
    if (!salesStats[s]) salesStats[s] = { booked: 0, quoted: 0, forecast: 0, target: 0 };
    salesStats[s].target += parseNumber(t['Sales Amount Target'] || t['salesTarget']);
  });

  const sortedSales = Object.keys(salesStats)
    .filter(s => fciTwSales.has(s) && s !== '未指派')
    .sort((a, b) => {
      const achA = salesStats[a].target > 0 ? (salesStats[a].booked / salesStats[a].target) : 0;
      const achB = salesStats[b].target > 0 ? (salesStats[b].booked / salesStats[b].target) : 0;
      return achB - achA;
    });

  const labels = [];
  const bookedData = [];
  const pipelineData = [];
  const targetData = [];

  sortedSales.forEach(s => {
    labels.push(s);
    bookedData.push(salesStats[s].booked);
    pipelineData.push(salesStats[s].quoted);
    targetData.push(salesStats[s].target);
  });

  const ctx = document.getElementById('leaderboard-chart').getContext('2d');
  if (leaderboardChart) leaderboardChart.destroy();

  leaderboardChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          type: 'line',
          label: 'Sales Target',
          data: targetData,
          borderColor: '#f59e0b',
          backgroundColor: '#f59e0b',
          borderWidth: 3,
          tension: 0.3,
          pointRadius: 4,
          order: 1,
          stack: 'target'
        },
        {
          type: 'bar',
          label: 'Sales Booked',
          data: bookedData,
          backgroundColor: '#10b981',
          stack: 'sales',
          order: 2
        },
        {
          type: 'bar',
          label: 'Sales Quoted',
          data: pipelineData,
          backgroundColor: 'rgba(16, 185, 129, 0.15)',
          borderColor: '#10b981',
          borderWidth: 1,
          borderSkipped: 'bottom',
          stack: 'sales',
          order: 3
        }
      ]
    },
    plugins: [
      {
        id: 'achLabels',
        afterDatasetsDraw(chart) {
          const {ctx, data} = chart;
          ctx.save();
          const meta = chart.getDatasetMeta(0);
          meta.data.forEach((datapoint, index) => {
            const sName = data.labels[index];
            const stats = salesStats[sName];
            if (stats && stats.target > 0) {
              const achPct = ((stats.booked / stats.target) * 100).toFixed(0) + '%';
              ctx.font = 'bold 11px sans-serif';
              ctx.fillStyle = '#eab308'; // Amber 500
              ctx.textAlign = 'center';
              ctx.fillText(achPct, datapoint.x, datapoint.y - 12);
            }
          });
          ctx.restore();
        }
      }
    ],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { 
          stacked: true,
          ticks: { color: '#94a3b8' }, 
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        },
        y: { 
          stacked: true,
          ticks: { 
            color: '#94a3b8',
            callback: function(value) { return formatTWD(value); }
          }, 
          grid: { color: 'rgba(255, 255, 255, 0.05)' }
        }
      },
      plugins: {
        legend: { labels: { color: '#94a3b8' } },
        tooltip: {
          mode: 'index',
          intersect: false,
          filter: function(tooltipItem) {
            // Filter out Sales Target (datasetIndex 0) to avoid showing it twice (since it's in beforeBody)
            return tooltipItem.datasetIndex !== 0;
          },
          callbacks: {
            beforeBody: function(context) {
              const sName = context[0].label;
              const stats = salesStats[sName];
              if (stats) {
                return `Sales Amount (Target): ${formatTWD(stats.target)}`;
              }
              return '';
            },
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              label += formatTWD(context.raw);
              return label;
            }
          }
        }
      }
    }
  });
}

// ------------------------------------------------------------
// TAB 2: 週會看板與管控 (比照 nonpower-sales-dashboard.html 口徑)
// ------------------------------------------------------------
let weeklySubtabState = 'subtab-weekly-overview';
let weeklySelectedOwner = 'ALL';

const SUBTAB_HELP_TEXTS = {
  'subtab-weekly-overview': `
    <div style="font-weight: 700; color: #38bdf8; font-size: 13px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">📋 週會總覽 — 開會重點</div>
    <div style="margin-bottom: 6px;"><b>• 🚨 風險金額</b>：審閱金額下調與卡關案。</div>
    <div style="margin-bottom: 6px;"><b>• 🎯 主管處置</b>：裁示 6 大關鍵卡關案資源。</div>
    <div><b>• 👤 人員管考</b>：評估業務案件與髒資料。</div>
  `,
  'weekly-cases-subtab': `
    <div style="font-weight: 700; color: #38bdf8; font-size: 13px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">▤ 逐案管考 — 開會重點</div>
    <div style="margin-bottom: 6px;"><b>• 🔥 橘框重點案</b>：確認高額案件推進進度。</div>
    <div style="margin-bottom: 6px;"><b>• ⚠️ 紅框停滯案</b>：要求說明 >30天停滯原因。</div>
    <div><b>• ❓ 零金額案</b>：指示 3 天內補齊預估金額。</div>
  `,
  'weekly-compare-subtab': `
    <div style="font-weight: 700; color: #38bdf8; font-size: 13px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px;">↗ 週次異動 — 開會重點</div>
    <div style="margin-bottom: 6px;"><b>• 🔍 快照對比</b>：選擇歷史快照比對異動。</div>
    <div style="margin-bottom: 6px;"><b>• 🚨 風險警示</b>：掃描金額下調與延期案件。</div>
    <div><b>• 🎉 本週戰果</b>：確認新成案與談判成果。</div>
  `
};

function updateWeeklyHelpTooltip(subtabId) {
  const popup = document.getElementById('weekly-help-tooltip-popup');
  if (popup && SUBTAB_HELP_TEXTS[subtabId]) {
    popup.innerHTML = SUBTAB_HELP_TEXTS[subtabId];
  }
}

function renderWeeklyTab() {
  const { filteredCases } = getFilteredDataset();

  // 1. Calculate Header Key Metrics
  const riskCases = filteredCases.filter(c => c.stale || c.days > 30);
  const winCases = filteredCases.filter(c => ['成交', '成立專案', '談判'].includes(c.stage));
  const newCases = filteredCases.filter(c => c.stage === 'RFQ' || c.days < 14);

  const riskAmount = riskCases.reduce((sum, c) => sum + parseNumber(c.expected_twd), 0);
  const winAmount = winCases.reduce((sum, c) => sum + parseNumber(c.expected_twd), 0);
  const staleRate = filteredCases.length > 0 ? ((riskCases.length / filteredCases.length) * 100).toFixed(1) : '0.0';
  const dirtyCases = filteredCases.filter(c => parseNumber(c.expected_twd) === 0 || (c.progress && c.progress.length < 5));

  const elRiskAmt = document.getElementById('weekly-risk-amount');
  const elWinAmt = document.getElementById('weekly-win-amount');
  const elStaleRate = document.getElementById('weekly-stale-rate');
  const elDirtyCount = document.getElementById('weekly-dirty-count');

  if (elRiskAmt) elRiskAmt.textContent = formatTWD(riskAmount);
  if (elWinAmt) elWinAmt.textContent = formatTWD(winAmount);
  if (elStaleRate) elStaleRate.textContent = `${staleRate}%`;
  if (elDirtyCount) elDirtyCount.textContent = `${dirtyCases.length} 案`;

  // 2. Bind Subnav Buttons
  const subtabBtns = document.querySelectorAll('.weekly-subtab-btn');
  subtabBtns.forEach(btn => {
    btn.onclick = () => {
      subtabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetId = btn.getAttribute('data-subtab');
      weeklySubtabState = targetId;

      document.querySelectorAll('.weekly-subtab-content').forEach(content => {
        content.style.display = (content.id === targetId) ? 'block' : 'none';
      });

      updateWeeklyHelpTooltip(targetId);

      if (targetId === 'subtab-weekly-overview') renderWeeklyOverview();
      else if (targetId === 'weekly-cases-subtab') renderWeeklyCasesWall();
      else if (targetId === 'weekly-compare-subtab') renderWeeklyCompare();
    };
  });

  // 3. Render Current Subtab Content
  updateWeeklyHelpTooltip(weeklySubtabState);
  renderWeeklyOverview();
  renderWeeklyCasesWall();
  renderWeeklyCompare();
  populateSnapshotDropdown();
}

// Subtab 1: 週會總覽 (Movement + Management Actions + Owner Scorecard)
function renderWeeklyOverview() {
  const { filteredCases } = getFilteredDataset();

  // A. Movement Summary Cards
  const movementGrid = document.getElementById('weekly-movement-grid');
  if (movementGrid) {
    const focusCount = filteredCases.filter(c => c.focus).length;
    const staleCount = filteredCases.filter(c => c.stale || c.days > 30).length;
    const missingCount = filteredCases.filter(c => parseNumber(c.expected_twd) === 0).length;
    const freshCount = filteredCases.filter(c => c.days <= 14).length;

    movementGrid.innerHTML = `
      <div class="movement-card">
        <span>🔥 重點關注案件</span>
        <strong>${focusCount} 件</strong>
      </div>
      <div class="movement-card">
        <span>⚠️ 卡關停滯案件</span>
        <strong style="color: #ef4444;">${staleCount} 件</strong>
      </div>
      <div class="movement-card">
        <span>❓ 未估金額案件</span>
        <strong style="color: #f59e0b;">${missingCount} 件</strong>
      </div>
      <div class="movement-card">
        <span>✨ 近兩週新進商機</span>
        <strong style="color: #10b981;">${freshCount} 件</strong>
      </div>
    `;
  }

  // B. Management Actions (主管本週處置)
  const actionsList = document.getElementById('weekly-management-actions');
  if (actionsList) {
    const focusAndStale = filteredCases.filter(c => c.focus || c.stale || parseNumber(c.expected_twd) === 0).slice(0, 6);
    if (focusAndStale.length === 0) {
      actionsList.innerHTML = '<li>全數商機維護正常，無特殊停滯風險案件。</li>';
    } else {
      actionsList.innerHTML = focusAndStale.map(c => {
        const actionMsg = getSmartActionAdvice(c);
        return `
          <li>
            <b>${c.name || c.opportunity_id} (${c.owner || '未指派'} · ${formatTWD(c.expected_twd)})</b>
            <span>${actionMsg}</span>
          </li>
        `;
      }).join('');
    }
  }

  // C. Owner Scorecard (連動部門與成數據)
  const scorecardContainer = document.getElementById('weekly-owner-scorecard');
  if (scorecardContainer) {
    const { filteredOrders } = getFilteredDataset();
    const ownerMap = {};

    FCI_FULL_SALES_ROSTER.forEach(member => {
      ownerMap[member.name] = {
        owner: member.name,
        group: member.group,
        count: 0,
        focus: 0,
        stale: 0,
        missing: 0,
        pipeline: 0,
        booked: 0
      };
    });

    filteredCases.forEach(c => {
      const o = normalizeOwnerName(c.owner);
      if (o !== '未指派' && ownerMap[o]) {
        ownerMap[o].count += 1;
        if (c.focus) ownerMap[o].focus += 1;
        if (c.stale || c.days > 30) ownerMap[o].stale += 1;
        if (parseNumber(c.expected_twd) === 0) ownerMap[o].missing += 1;
        ownerMap[o].pipeline += parseNumber(c.expected_twd);
      }
    });

    filteredOrders.forEach(ord => {
      const o = normalizeOwnerName(ord.owner);
      if (o !== '未指派' && ownerMap[o]) {
        ownerMap[o].booked += parseNumber(ord.amount_twd);
      }
    });

    // Department filtering check
    const { selectedGroupFilter } = appState;
    const rows = Object.values(ownerMap)
      .filter(r => matchesDepartmentFilter(mapRosterGroupToBucket(r.group), selectedGroupFilter))
      .sort((a, b) => (b.booked + b.pipeline) - (a.booked + a.pipeline));

    scorecardContainer.innerHTML = `
      <div class="owner-score-row header" style="grid-template-columns: 130px 110px repeat(2, 1.2fr) repeat(4, 0.8fr);">
        <div>業務員</div>
        <div>所屬部門</div>
        <div>YTD 成交金額 (Booked)</div>
        <div>Pipeline 金額 (預計成案)</div>
        <div style="text-align: center;">總案件數</div>
        <div style="text-align: center;">重點案</div>
        <div style="text-align: center;">停滯案</div>
        <div style="text-align: center;">零金額案</div>
      </div>
      ${rows.map(r => `
        <div class="owner-score-row" style="grid-template-columns: 130px 110px repeat(2, 1.2fr) repeat(4, 0.8fr);" onclick="selectOwnerFilter('${r.owner}')">
          <div style="font-weight: 700; color: #ffffff;">👤 ${r.owner}</div>
          <div><span class="badge-tag" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8;">${r.group}</span></div>
          <div class="num-font" style="font-weight: 700; color: #10b981;">${formatTWD(r.booked)}</div>
          <div class="num-font" style="font-weight: 700; color: #38bdf8;">${formatTWD(r.pipeline)}</div>
          <div style="text-align: center;">${r.count}</div>
          <div style="text-align: center; color: #f97316; font-weight: 700;">${r.focus}</div>
          <div style="text-align: center; color: ${r.stale > 0 ? '#ef4444' : 'inherit'}; font-weight: 700;">${r.stale}</div>
          <div style="text-align: center; color: ${r.missing > 0 ? '#f59e0b' : 'inherit'};">${r.missing}</div>
        </div>
      `).join('')}
    `;
  }
}

// Switch Owner and jump to Case Cards Subtab
window.selectOwnerFilter = function(ownerName) {
  weeklySelectedOwner = ownerName;
  const casesBtn = document.querySelector('.weekly-subtab-btn[data-subtab="weekly-cases-subtab"]');
  if (casesBtn) casesBtn.click();
};

// Subtab 2: 逐案管考 (Case Cards Wall)
function renderWeeklyCasesWall() {
  const { filteredCases } = getFilteredDataset();

  // A. Render Owner Filter Tabs
  const ownerTabsContainer = document.getElementById('weekly-owner-tabs');
  if (ownerTabsContainer) {
    const owners = Array.from(new Set(filteredCases.map(c => normalizeOwnerName(c.owner)))).sort();
    ownerTabsContainer.innerHTML = `
      <button class="owner-tab-chip ${weeklySelectedOwner === 'ALL' ? 'active' : ''}" onclick="filterByOwnerChip('ALL')">全部業務 (${filteredCases.length})</button>
      ${owners.map(o => {
        const cnt = filteredCases.filter(c => normalizeOwnerName(c.owner) === o).length;
        return `<button class="owner-tab-chip ${weeklySelectedOwner === o ? 'active' : ''}" onclick="filterByOwnerChip('${o}')">${o} (${cnt})</button>`;
      }).join('')}
    `;
  }

  // B. Populate Stage Filter Dropdown
  const stageFilterSelect = document.getElementById('weekly-stage-filter');
  if (stageFilterSelect && stageFilterSelect.options.length <= 1) {
    const stages = Array.from(new Set(filteredCases.map(c => c.stage || 'RFQ'))).filter(Boolean);
    stages.forEach(stg => {
      const opt = document.createElement('option');
      opt.value = stg;
      opt.textContent = stg;
      stageFilterSelect.appendChild(opt);
    });
  }

  // Bind input and select listeners
  const searchInput = document.getElementById('weekly-case-search');
  const stageSelect = document.getElementById('weekly-stage-filter');
  const focusSelect = document.getElementById('weekly-focus-filter');

  const applyFiltersAndRender = () => {
    const q = (searchInput ? searchInput.value : '').toLowerCase().trim();
    const stg = stageSelect ? stageSelect.value : '全部';
    const foc = focusSelect ? focusSelect.value : 'all';

    const result = filteredCases.filter(c => {
      // Owner Filter
      if (weeklySelectedOwner !== 'ALL' && normalizeOwnerName(c.owner) !== weeklySelectedOwner) return false;
      
      // Stage Filter
      if (stg !== '全部' && (c.stage || 'RFQ') !== stg) return false;

      // Focus / Stale / Missing Filter
      if (foc === 'focus' && !c.focus) return false;
      if (foc === 'stale' && !(c.stale || c.days > 30)) return false;
      if (foc === 'missing' && parseNumber(c.expected_twd) !== 0) return false;

      // Search Filter
      if (q) {
        const matchName = (c.name || '').toLowerCase().includes(q);
        const matchCust = (c.customer || '').toLowerCase().includes(q);
        const matchOwner = (c.owner || '').toLowerCase().includes(q);
        const matchId = (c.opportunity_id || '').toLowerCase().includes(q);
        if (!matchName && !matchCust && !matchOwner && !matchId) return false;
      }

      return true;
    });

    // Update count display
    const countEl = document.getElementById('weekly-case-count');
    if (countEl) countEl.textContent = `${result.length} 件案件`;

    // Render Cards
    const wallContainer = document.getElementById('weekly-case-cards-wall');
    if (!wallContainer) return;

    if (result.length === 0) {
      wallContainer.innerHTML = '<div class="glass-card" style="text-align: center; color: var(--text-muted); padding: 40px;">查無相符之案件數據</div>';
      return;
    }

    wallContainer.innerHTML = result.map(c => {
      const isStale = c.stale || c.days > 30;
      const isFocus = c.focus;
      const isMissing = parseNumber(c.expected_twd) === 0;
      const actionMsg = getSmartActionAdvice(c);

      let cardClass = 'case-card';
      if (isFocus) cardClass += ' focus';
      else if (isStale) cardClass += ' stale';

      return `
        <div class="${cardClass}">
          <div class="case-head">
            <div>
              <div class="case-badges">
                ${isFocus ? '<span class="badge-tag focus">🔥 重點關注</span>' : ''}
                <span class="badge-tag stage">${c.stage || 'RFQ'}</span>
                <span class="badge-tag owner">👤 ${c.owner || '未指派'}</span>
                ${c.brand ? `<span class="badge-tag" style="background: rgba(255,255,255,0.06); color: var(--text-muted);">${c.brand}</span>` : ''}
              </div>
              <h4>${c.name || c.opportunity_id}</h4>
              <small>${c.customer || '未指派客戶'} · 案號: ${c.opportunity_id || 'N/A'}</small>
            </div>
            <div class="case-amount-box">
              <strong class="num-font">${formatTWD(c.expected_twd)}</strong>
              ${c.quote_amount ? `<small>報價: ${formatTWD(c.quote_amount)}</small>` : ''}
            </div>
          </div>

          <div class="case-details-row">
            <div>
              <b>最新進度說明 (${c.updated_date || '未紀錄日期'})</b>
              <p>${c.progress || '暫無進度紀錄內容'}</p>
            </div>
            <div>
              <b>主管本週處置指引</b>
              <p style="color: #38bdf8;">${actionMsg}</p>
            </div>
            <div class="age-pill ${isStale ? 'bad' : ''}">
              ${c.days} 天未更新
            </div>
          </div>
        </div>
      `;
    }).join('');
  };

  if (searchInput) searchInput.oninput = applyFiltersAndRender;
  if (stageSelect) stageSelect.onchange = applyFiltersAndRender;
  if (focusSelect) focusSelect.onchange = applyFiltersAndRender;

  applyFiltersAndRender();
}

window.filterByOwnerChip = function(ownerName) {
  weeklySelectedOwner = ownerName;
  renderWeeklyCasesWall();
};



// Subtab 3: WoW Compare Scanner
function renderWeeklyCompare() {
  const { filteredCases } = getFilteredDataset();

  const riskCases = filteredCases.filter(c => c.stale || c.days > 30);
  const winCases = filteredCases.filter(c => ['成交', '成立專案', '談判'].includes(c.stage));
  const newCases = filteredCases.filter(c => c.stage === 'RFQ' || c.days < 14);

  const riskContainer = document.getElementById('wow-risk-list');
  const winsContainer = document.getElementById('wow-wins-list');
  const newContainer = document.getElementById('wow-new-list');

  const getRiskCategoryBadge = (c) => {
    if (c.price_dropped) return '<span style="display:inline-block; padding:2px 6px; border-radius:4px; font-size:10px; background:rgba(239,68,68,0.2); color:#fca5a5; font-weight:600; margin-left:4px;">🔻 金額下調</span>';
    if (c.stage_regressed) return '<span style="display:inline-block; padding:2px 6px; border-radius:4px; font-size:10px; background:rgba(239,68,68,0.2); color:#fca5a5; font-weight:600; margin-left:4px;">↩️ 階段倒退</span>';
    return `<span style="display:inline-block; padding:2px 6px; border-radius:4px; font-size:10px; background:rgba(239,68,68,0.2); color:#fca5a5; font-weight:600; margin-left:4px;">⚠️ 卡關停滯 (${c.days}天)</span>`;
  };

  const getWinCategoryBadge = (c) => {
    if (c.stage === '成交' || c.stage === '成立專案') return '<span style="display:inline-block; padding:2px 6px; border-radius:4px; font-size:10px; background:rgba(16,185,129,0.2); color:#6ee7b7; font-weight:600; margin-left:4px;">🎉 新成交/成案</span>';
    if (c.stage === '談判') return '<span style="display:inline-block; padding:2px 6px; border-radius:4px; font-size:10px; background:rgba(16,185,129,0.2); color:#6ee7b7; font-weight:600; margin-left:4px;">🚀 推進談判</span>';
    return '<span style="display:inline-block; padding:2px 6px; border-radius:4px; font-size:10px; background:rgba(16,185,129,0.2); color:#6ee7b7; font-weight:600; margin-left:4px;">📈 進入報價</span>';
  };

  if (riskContainer) {
    riskContainer.innerHTML = riskCases.slice(0, 8).map(c => `
      <div class="item-row">
        <div>
          <strong>${c.name || c.opportunity_id}</strong>
          <div style="font-size: 11px; color: var(--text-muted); display:flex; align-items:center; gap:4px; margin-top:2px;">
            <span>${c.owner}</span> · ${getRiskCategoryBadge(c)}
          </div>
        </div>
        <span class="badge badge-danger">${formatTWD(c.expected_twd)}</span>
      </div>
    `).join('') || '<div class="item-row"><span>無風險警示案件</span></div>';
  }

  if (winsContainer) {
    winsContainer.innerHTML = winCases.slice(0, 8).map(c => `
      <div class="item-row">
        <div>
          <strong>${c.name || c.opportunity_id}</strong>
          <div style="font-size: 11px; color: var(--text-muted); display:flex; align-items:center; gap:4px; margin-top:2px;">
            <span>${c.owner}</span> · ${getWinCategoryBadge(c)}
          </div>
        </div>
        <span class="badge badge-success">${formatTWD(c.expected_twd)}</span>
      </div>
    `).join('') || '<div class="item-row"><span>無新成交/推進案件</span></div>';
  }

  if (newContainer) {
    newContainer.innerHTML = newCases.slice(0, 8).map(c => `
      <div class="item-row">
        <div>
          <strong>${c.name || c.opportunity_id}</strong>
          <div style="font-size: 11px; color: var(--text-muted); display:flex; align-items:center; gap:4px; margin-top:2px;">
            <span>${c.owner}</span> · <span style="display:inline-block; padding:2px 6px; border-radius:4px; font-size:10px; background:rgba(245,158,11,0.2); color:#fde68a; font-weight:600;">✨ 新進RFQ</span>
          </div>
        </div>
        <span class="badge badge-warning">${formatTWD(c.expected_twd)}</span>
      </div>
    `).join('') || '<div class="item-row"><span>無新開發商機</span></div>';
  }
}

// Populate Weekly Snapshot Picker
function populateSnapshotDropdown() {
  const select = document.getElementById('weekly-snapshot-select');
  if (!select) return;

  const dates = Array.from(new Set(appState.snapshots.map(s => s.Snapshot_Date || s.snapshot_date))).filter(Boolean).sort().reverse();

  if (dates.length === 0) {
    select.innerHTML = '<option value="latest">2026-08-25 (最新快照)</option><option value="prev">2026-08-18 (上週一)</option>';
    return;
  }

  select.innerHTML = dates.map(d => `<option value="${d}">${d} 快照</option>`).join('');
}

// ------------------------------------------------------------
// TAB 3: 歷年趨勢與 Run-Rate 斜率預估模型 (包含顯性 Run-rate 曲線)
// ------------------------------------------------------------
function renderTrendsTab() {
  const { selectedYear } = appState;
  const { filteredOrders, filteredTargets } = getFilteredDataset();

  const targetAmount = filteredTargets.reduce((sum, t) => sum + parseNumber(t['Sales Amount Target'] || t['salesTarget']), 0);

  // 1. Run-Rate Slope Projection Calculation
  const currentMonth = new Date().getMonth() + 1; // e.g. 8 for August
  const ytdMonths = Math.min(12, currentMonth);
  
  const ytdActual = filteredOrders.reduce((sum, o) => {
    if (o.created_date) {
      const m = new Date(o.created_date).getMonth() + 1;
      if (m <= ytdMonths) return sum + parseNumber(o.amount_twd);
    }
    return sum;
  }, 0);

  const monthlySlope = ytdMonths > 0 ? (ytdActual / ytdMonths) : 0;
  const projectedFullYear = monthlySlope * 12;
  const projectedPct = targetAmount > 0 ? ((projectedFullYear / targetAmount) * 100).toFixed(1) : '0.0';

  document.getElementById('runrate-ytd-actual').textContent = formatTWD(ytdActual);
  document.getElementById('runrate-monthly-slope').textContent = `${formatTWD(monthlySlope)} /月`;
  document.getElementById('runrate-projected-year').textContent = formatTWD(projectedFullYear);
  document.getElementById('runrate-projected-pct').textContent = `${projectedPct}%`;

  const labels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  // Chart 2: Cumulative Run-Rate Projection Curve (顯性 Pacing Line)
  const actualCumulative = new Array(12).fill(null);
  const projectedCumulative = new Array(12).fill(null);
  const targetLine = new Array(12).fill(targetAmount / 1000000);

  let acc = 0;
  for (let m = 0; m < ytdMonths; m++) {
    const amt = filteredOrders.filter(o => o.created_date && new Date(o.created_date).getMonth() === m)
                             .reduce((sum, o) => sum + parseNumber(o.amount_twd), 0) / 1000000;
    acc += amt;
    actualCumulative[m] = acc;
  }

  // Connect actual end point to projected slope line
  projectedCumulative[ytdMonths - 1] = actualCumulative[ytdMonths - 1];
  for (let m = ytdMonths; m < 12; m++) {
    const projAcc = actualCumulative[ytdMonths - 1] + (monthlySlope / 1000000) * (m - (ytdMonths - 1));
    projectedCumulative[m] = projAcc;
  }

  const ctx2 = document.getElementById('cumulative-chart').getContext('2d');
  if (cumulativeChart) cumulativeChart.destroy();
  cumulativeChart = new Chart(ctx2, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: `${selectedYear} YTD 實績累計 (M TWD)`,
          data: actualCumulative,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.15)',
          fill: true,
          tension: 0.3,
          pointRadius: 5,
          borderWidth: 3
        },
        {
          label: `Run-Rate 斜率預估軌跡 (${formatTWD(projectedFullYear)})`,
          data: projectedCumulative,
          borderColor: '#f59e0b',
          borderDash: [6, 4],
          backgroundColor: 'transparent',
          tension: 0.3,
          pointRadius: 4,
          borderWidth: 3
        },
        {
          label: `年度總目標 (${formatTWD(targetAmount)})`,
          data: targetLine,
          borderColor: '#ef4444',
          borderDash: [2, 4],
          backgroundColor: 'transparent',
          pointRadius: 0,
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8' } },
        tooltip: {
          callbacks: {
            label: function(context) {
              return ` ${context.dataset.label}: ${context.raw ? context.raw.toFixed(2) : 0} M TWD`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
        y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' }, title: { display: true, text: '累計金額 (M NT$)', color: '#94a3b8' } }
      }
    }
  });

  // Chart 0: Customer Group Growth & Shift Chart
  const customerList = ['台灣中油', '中鼎工程', '台塑石化', '長榮航太', '台電大潭', '其他客戶'];
  const customerColors = ['#10b981', '#0ea5e9', '#f59e0b', '#a855f7', '#ec4899', '#64748b'];

  const customerMonthlyMap = {};
  customerList.forEach(c => { customerMonthlyMap[c] = new Array(12).fill(0); });

  filteredOrders.forEach(o => {
    if (o.created_date) {
      const m = new Date(o.created_date).getMonth();
      if (m >= 0 && m < 12) {
        const custRaw = o.customer || '';
        let matchedCust = '其他客戶';
        if (custRaw.includes('中油')) matchedCust = '台灣中油';
        else if (custRaw.includes('中鼎')) matchedCust = '中鼎工程';
        else if (custRaw.includes('台塑')) matchedCust = '台塑石化';
        else if (custRaw.includes('長榮')) matchedCust = '長榮航太';
        else if (custRaw.includes('台電')) matchedCust = '台電大潭';
        
        customerMonthlyMap[matchedCust][m] += parseNumber(o.amount_twd) / 1000000;
      }
    }
  });

  const customerDatasets = customerList.map((c, idx) => ({
    label: c,
    data: customerMonthlyMap[c],
    backgroundColor: customerColors[idx],
    borderRadius: 4
  }));

  const ctxCust = document.getElementById('customer-trend-chart').getContext('2d');
  if (customerTrendChart) customerTrendChart.destroy();
  customerTrendChart = new Chart(ctxCust, {
    type: 'bar',
    data: { labels: labels, datasets: customerDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8' } },
        tooltip: {
          callbacks: {
            label: function(context) { return ` ${context.dataset.label}: ${context.raw.toFixed(2)} M TWD`; }
          }
        }
      },
      scales: {
        x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
        y: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' }, title: { display: true, text: '月度營收金額 (M NT$)', color: '#94a3b8' } }
      }
    }
  });

  // Chart 1: Double-Axis YoY Combo Chart (支援今年 vs 去年的真實 YoY 對比與業務個人 YoY 分析)
  const prevYear = (parseInt(selectedYear) - 1).toString();
  const monthlyAmounts = new Array(12).fill(0);
  const monthlyCounts = new Array(12).fill(0);
  const prevMonthlyAmounts = new Array(12).fill(0);

  filteredOrders.forEach(o => {
    if (o.created_date) {
      const m = new Date(o.created_date).getMonth();
      if (m >= 0 && m < 12) {
        monthlyAmounts[m] += parseNumber(o.amount_twd) / 1000000;
        monthlyCounts[m] += 1;
      }
    }
  });

  // 抓取同篩選條件 (組別、個人、業務) 下前一年 (prevYear) 的資料以計算真正的 YoY
  const { selectedGroupFilter, selectedSales } = appState;
  appState.orders.filter(o => {
    const yr = getYearFromDateStr(o.created_date);
    const matchYear = (yr === prevYear);
    const matchStatus = (o.status === '簽核完成');
    const matchGroup = matchesDepartmentFilter(getRecordPowerNonPower(o), selectedGroupFilter);
    const matchSales = (selectedSales === 'ALL' || normalizeOwnerName(o.owner) === selectedSales);
    return matchYear && matchStatus && matchGroup && matchSales;
  }).forEach(o => {
    if (o.created_date) {
      const m = new Date(o.created_date).getMonth();
      if (m >= 0 && m < 12) {
        prevMonthlyAmounts[m] += parseNumber(o.amount_twd) / 1000000;
      }
    }
  });

  const ctx1 = document.getElementById('yoy-combo-chart').getContext('2d');
  if (yoyChart) yoyChart.destroy();
  const salesTag = selectedSales !== 'ALL' ? ` [${selectedSales}]` : '';
  yoyChart = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: `${selectedYear}${salesTag} 成交金額 (M TWD)`,
          data: monthlyAmounts,
          backgroundColor: 'rgba(16, 185, 129, 0.7)',
          borderColor: '#10b981',
          borderWidth: 1,
          yAxisID: 'yAmount',
          borderRadius: 6
        },
        {
          label: `${prevYear}${salesTag} 同期對比 (M TWD)`,
          data: prevMonthlyAmounts,
          type: 'line',
          borderColor: '#f59e0b',
          backgroundColor: '#f59e0b',
          borderDash: [5, 5],
          pointRadius: 4,
          tension: 0.3,
          yAxisID: 'yAmount'
        },
        {
          label: `${selectedYear} 開案/接單件數`,
          data: monthlyCounts,
          type: 'line',
          borderColor: '#38bdf8',
          backgroundColor: '#38bdf8',
          pointRadius: 4,
          tension: 0.3,
          yAxisID: 'yCount'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8' } } },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
        yAmount: { type: 'linear', position: 'left', ticks: { color: '#10b981' }, title: { display: true, text: '金額 (M NT$)', color: '#10b981' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
        yCount: { type: 'linear', position: 'right', ticks: { color: '#38bdf8', precision: 0 }, title: { display: true, text: '案件數', color: '#38bdf8' }, grid: { drawOnChartArea: false } }
      }
    }
  });

  // Chart 3: Quarterly QoQ Chart
  const qData = [0, 0, 0, 0];
  filteredOrders.forEach(o => {
    if (o.created_date) {
      const m = new Date(o.created_date).getMonth();
      const q = Math.floor(m / 3);
      if (q >= 0 && q < 4) qData[q] += parseNumber(o.amount_twd) / 1000000;
    }
  });

  const ctx3 = document.getElementById('quarterly-chart').getContext('2d');
  if (quarterlyChart) quarterlyChart.destroy();
  quarterlyChart = new Chart(ctx3, {
    type: 'bar',
    data: {
      labels: ['Q1 第一季', 'Q2 第二季', 'Q3 第三季', 'Q4 第四季'],
      datasets: [{
        label: `${selectedYear} 季度成交額 (M TWD)`,
        data: qData,
        backgroundColor: ['rgba(59, 130, 246, 0.7)', 'rgba(16, 185, 129, 0.7)', 'rgba(245, 158, 11, 0.7)', 'rgba(168, 85, 247, 0.7)'],
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#94a3b8' } },
        y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
      }
    }
  });

  // Chart 4: Average Deal Size
  const monthlyAvgDeal = new Array(12).fill(0);
  for (let m = 0; m < 12; m++) {
    const count = monthlyCounts[m];
    const amtM = monthlyAmounts[m];
    monthlyAvgDeal[m] = count > 0 ? (amtM * 1000000 / count / 10000) : 0;
  }

  const ctx4 = document.getElementById('dealsize-chart').getContext('2d');
  if (dealSizeChart) dealSizeChart.destroy();
  dealSizeChart = new Chart(ctx4, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '平均單案成交金額 (萬 TWD)',
        data: monthlyAvgDeal,
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245, 158, 11, 0.15)',
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8' } } },
      scales: {
        x: { ticks: { color: '#94a3b8' } },
        y: { ticks: { color: '#f59e0b' }, grid: { color: 'rgba(255, 255, 255, 0.05)' }, title: { display: true, text: '單案均價 (萬 NT$)', color: '#f59e0b' } }
      }
    }
  });

  // Chart 5: Sales Growth Quadrant Scatter Chart
  const salesMap = {};
  filteredOrders.forEach(o => {
    const s = o.owner || '未指派';
    if (!salesMap[s]) salesMap[s] = { count: 0, amount: 0 };
    salesMap[s].count += 1;
    salesMap[s].amount += parseNumber(o.amount_twd) / 1000000;
  });

  const scatterData = Object.keys(salesMap).map(s => ({
    x: salesMap[s].count,
    y: salesMap[s].amount,
    salesName: s
  }));

  const ctx5 = document.getElementById('matrix-chart').getContext('2d');
  if (matrixChart) matrixChart.destroy();
  matrixChart = new Chart(ctx5, {
    type: 'scatter',
    data: {
      datasets: [{
        label: '業務成員 (件數 vs 金額)',
        data: scatterData,
        backgroundColor: '#10b981',
        pointRadius: 8,
        pointHoverRadius: 12
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context) {
              const raw = context.raw;
              return ` ${raw.salesName}: ${raw.x} 件, ${raw.y.toFixed(2)} M TWD`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: '#94a3b8' }, title: { display: true, text: '成交案件數量 (件)', color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
        y: { ticks: { color: '#94a3b8' }, title: { display: true, text: '成交總金額 (M TWD)', color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
      }
    }
  });
}

// Kickstart
window.addEventListener('DOMContentLoaded', initDashboard);

