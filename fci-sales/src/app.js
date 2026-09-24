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
  searchQuery: '',
  // 階層 4 報表狀態
  reportMode: 'monthly', // 'monthly' | 'ytd'
  reportMonth: '9',      // 預設 9 月 (對齊 sample 09 月)
  reportDept: 'ALL',     // 部門過濾
  reportSearch: ''       // 關鍵字搜尋
};

// ============================================================
// 富迪斯集團品牌標準色 (PANTONE & HEX Palette)
// ============================================================
const BRAND_COLORS = {
  green: '#009D88',        // Pantone 2402C: 富迪斯主色
  greenLight: '#00c4aa',  // 發光強調色
  greenDark: '#007d6d',   // 深色微調
  yellow: '#f7b012',       // Pantone 137C: 警示 / 基準
  red: '#f094ae',          // Pantone 190C: 風險 / 柔和紅
  redAlert: '#e11d48',    // 高對比警示紅
  lightGreen: '#8dc556',   // Pantone 7488C: 達成 / 成長
  blue: '#2f8ccc',         // Pantone 2144C: 企業湛藍
  darkGray: '#3e3a39'      // Pantone Black 7C: 深炭灰
};

function getThemeConfig() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const isLight = currentTheme === 'light';
  return {
    isLight,
    theme: currentTheme,
    textColor: isLight ? '#3e3a39' : '#94a3b8',
    textMain: isLight ? '#1e293b' : '#f8fafc',
    gridColor: isLight ? 'rgba(62, 58, 57, 0.08)' : 'rgba(255, 255, 255, 0.05)',
    trackColor: isLight ? 'rgba(62, 58, 57, 0.08)' : 'rgba(255, 255, 255, 0.08)',
    cardBg: isLight ? '#ffffff' : '#0e161c'
  };
}

function initTheme() {
  const savedTheme = localStorage.getItem('fci-theme') || 
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  applyTheme(savedTheme, false);
}

function applyTheme(theme, shouldRerender = true) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('fci-theme', theme);
  
  const themeModeText = document.getElementById('theme-mode-text');
  if (themeModeText) {
    themeModeText.textContent = theme === 'light' ? '淺色' : '深色';
  }

  const logoImg = document.getElementById('fci-brand-logo');
  if (logoImg) {
    logoImg.src = theme === 'light' ? './src/assets/logo-light.png' : './src/assets/logo-dark.png';
  }

  // Update Chart.js Global defaults
  if (typeof Chart !== 'undefined') {
    const isLight = theme === 'light';
    Chart.defaults.color = isLight ? '#3e3a39' : '#94a3b8';
    Chart.defaults.borderColor = isLight ? 'rgba(62, 58, 57, 0.08)' : 'rgba(255, 255, 255, 0.05)';
  }

  if (shouldRerender) {
    renderDashboard();
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme, true);
}

// Chart instances
let groupDoughnutChart = null;
let nonpowerDoughnutChart = null;
let powerepcDoughnutChart = null;
let customerTrendChart = null;
let salesMultiYearChart = null;
let industryTrendChart = null;
let monthlyAmountChart = null;
let monthlyCountChart = null;
let quarterlyDealSizeChart = null;
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

// FCI 業務人員全名 (英中對照，對齊 Sample PDF 報表格式)
const FCI_SALES_FULL_NAMES = {
  'Charlie': 'Charlie Lin 林昌黎',
  'Jason': 'Jason Chen 陳盈傑',
  'Ping': 'Ping Soong 宋賢斌',
  'Neil': 'Neil Wu 吳宏恩',
  'Rex': 'Rex Huang 黃蔚岷',
  'Sophie': 'Sophie Chen 陳俞蓁',
  'Canni': 'Canni Chang 張凱寧',
  'Hayashi': 'Hayashi Lin 林惠美',
  'Shawn': 'Shawn Hsu 徐舜偉',
  'Yen': 'Yen Wu 吳雙延'
};

function getSalesFullName(name) {
  const norm = normalizeOwnerName(name);
  return FCI_SALES_FULL_NAMES[norm] || norm;
}

// 格式化數字為千分位
function formatNumberWithCommas(num, decimals = 0) {
  if (isNaN(num) || num === null || num === undefined) return '0';
  const val = Number(num);
  return val.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

// 格式化百分比
function formatPercent(num, decimals = 1) {
  if (isNaN(num) || num === null || num === undefined) return '0.0%';
  return `${Number(num).toFixed(decimals)}%`;
}

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
  
  // Sample 09 月實際資料 (完全對齊 sample/FCI Sales Monthly Report.pdf)
  mockOrders.push({
    project_id: 'ORD-20260901',
    customer: '台塑石化 (FCFC 台化)',
    customer_short: 'FCFC 台化',
    group: 'NonPower',
    'Power/NonPower': 'NonPower',
    owner: 'Jason',
    currency: 'NTD',
    amount_orig: 180000,
    amount_twd: 180000,
    profit_twd: 27541,
    ebt_rate: 0.153,
    status: '簽核完成',
    created_date: '2026-09-07'
  });
  mockOrders.push({
    project_id: 'ORD-20260902',
    customer: '台灣賽孚思化學',
    customer_short: '台灣賽孚思',
    group: 'NonPower',
    'Power/NonPower': 'NonPower',
    owner: 'Jason',
    currency: 'NTD',
    amount_orig: 293400,
    amount_twd: 293400,
    profit_twd: 86928,
    ebt_rate: 0.2963,
    status: '簽核完成',
    created_date: '2026-09-08'
  });
  mockOrders.push({
    project_id: 'ORD-20260903',
    customer: '中華紙漿股份有限公司 - 花蓮廠',
    customer_short: '中華紙漿 - 花蓮',
    group: 'NonPower',
    'Power/NonPower': 'NonPower',
    owner: 'Rex',
    currency: 'NTD',
    amount_orig: 5506000,
    amount_twd: 5506000,
    profit_twd: 205144,
    ebt_rate: 0.0373,
    status: '簽核完成',
    created_date: '2026-09-09'
  });
  mockOrders.push({
    project_id: 'ORD-20260904',
    customer: '聚熱實業股份有限公司',
    customer_short: '聚熱',
    group: 'NonPower',
    'Power/NonPower': 'NonPower',
    owner: 'Rex',
    currency: 'NTD',
    amount_orig: 477600,
    amount_twd: 477600,
    profit_twd: 61179,
    ebt_rate: 0.1281,
    status: '簽核完成',
    created_date: '2026-09-09'
  });

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

  // Seed Charlie 2026 Booked - Power&EPC (對齊 sample: 30,897,811)
  mockOrders.push({
    project_id: 'ORD-CH-P1',
    customer: '台塑麥寮 MTO工程',
    customer_short: '台塑麥寮',
    group: 'MTO',
    'Power/NonPower': 'Power',
    owner: 'Charlie',
    amount_twd: 30897811,
    profit_twd: 5866426,
    ebt_rate: 0.19,
    status: '簽核完成',
    created_date: '2026-08-01'
  });

  // Seed Charlie 2026 Booked - Non Power (對齊 sample: 4,393,000)
  mockOrders.push({
    project_id: 'ORD-CH-NP1',
    customer: '遠東新世紀化學',
    customer_short: '遠東新',
    group: 'NonPower',
    'Power/NonPower': 'NonPower',
    owner: 'Charlie',
    amount_twd: 4393000,
    profit_twd: 864989,
    ebt_rate: 0.20,
    status: '簽核完成',
    created_date: '2026-07-15'
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
  initTheme();
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
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  if (themeToggleBtn) {
    themeToggleBtn.onclick = () => {
      toggleTheme();
    };
  }

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

  // 掛載階層 4 控制器事件
  setupHierarchyLevel4Events();
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
  'ebt_rate': 'ebt_rate',
  'customer': 'customer',
  '顧客簡稱': 'customer_short',
  'customer_short': 'customer_short',
  '專案幣別': 'currency',
  'currency': 'currency',
  '專案金額 (原幣)': 'amount_orig',
  'amount_orig': 'amount_orig'
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
  renderSingleDoughnutChart('sales-ach-doughnut', totalBooked, totalTarget, (chart) => salesAchDoughnut = chart, salesAchDoughnut, BRAND_COLORS.green);
  document.getElementById('sales-ach-pct').textContent = `${salesBookedPct.toFixed(1)}%`;

  renderSingleDoughnutChart('ebt-ach-doughnut', totalEbtBooked, totalEbtTarget, (chart) => ebtAchDoughnut = chart, ebtAchDoughnut, BRAND_COLORS.blue);
  document.getElementById('ebt-ach-pct').textContent = `${ebtBookedPct.toFixed(1)}%`;

  const shareLabels = ['NONPOWER', 'POWER & EPC'];
  const shareColors = [BRAND_COLORS.lightGreen, BRAND_COLORS.blue];
  renderSharePieChart('sales-share-doughnut', [npBooked, peBooked], shareLabels, shareColors, (chart) => salesShareDoughnut = chart, salesShareDoughnut);
  renderSharePieChart('ebt-share-doughnut', [npEbtBooked, peEbtBooked], shareLabels, shareColors, (chart) => ebtShareDoughnut = chart, ebtShareDoughnut);

  // 2. Department Level 2 Doughnuts & Info lists
  renderSingleDoughnutChart('nonpower-doughnut-chart', npBooked, npTarget, (chart) => nonpowerDoughnutChart = chart, nonpowerDoughnutChart, BRAND_COLORS.lightGreen);
  document.getElementById('nonpower-doughnut-pct').textContent = `${npPct}%`;
  document.getElementById('dept-nonpower-target').textContent = formatTWD(npTarget);
  document.getElementById('dept-nonpower-booked').textContent = formatTWD(npBooked);
  document.getElementById('dept-nonpower-forecast').textContent = formatTWD(npBooked + npPipeline);
  document.getElementById('dept-nonpower-sales-pct').textContent = `${npPct}%`;
  document.getElementById('dept-nonpower-ebt-target').textContent = formatTWD(npEbtTarget);
  document.getElementById('dept-nonpower-ebt-booked').textContent = formatTWD(npEbtBooked);
  document.getElementById('dept-nonpower-ebt-forecast').textContent = formatTWD(npEbtBooked + npEbtPipeline);
  document.getElementById('dept-nonpower-ebt-pct').textContent = `${npEbtPct}%`;

  renderSingleDoughnutChart('powerepc-doughnut-chart', peBooked, peTarget, (chart) => powerepcDoughnutChart = chart, powerepcDoughnutChart, BRAND_COLORS.blue);
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
function renderSingleDoughnutChart(canvasId, booked, target, setChartRef, existingChart, accentColor = BRAND_COLORS.green) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const gap = Math.max(0, target - booked);
  const trackColor = getThemeConfig().trackColor;

  if (existingChart) existingChart.destroy();

  const newChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['已成交實績', '目標缺口'],
      datasets: [{
        data: [booked, gap],
        backgroundColor: [accentColor, trackColor],
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
          borderColor: BRAND_COLORS.yellow,
          backgroundColor: BRAND_COLORS.yellow,
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
          backgroundColor: BRAND_COLORS.green,
          stack: 'sales',
          order: 2
        },
        {
          type: 'bar',
          label: 'Sales Quoted',
          data: pipelineData,
          backgroundColor: adjustOpacity(BRAND_COLORS.green, 0.2),
          borderColor: BRAND_COLORS.green,
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
              ctx.fillStyle = BRAND_COLORS.yellow;
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
          ticks: { color: getThemeConfig().textColor }, 
          grid: { color: getThemeConfig().gridColor }
        },
        y: { 
          stacked: true,
          ticks: { 
            color: getThemeConfig().textColor,
            callback: function(value) { return formatTWD(value); }
          }, 
          grid: { color: getThemeConfig().gridColor }
        }
      },
      plugins: {
        legend: { labels: { color: getThemeConfig().textColor } },
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

  // 渲染階層 4：接單業績分析報表
  renderHierarchyLevel4();
}

// ============================================================
// 階層 4：接單業績分析報表 (Hierarchy 4 Reports Engine)
// ============================================================

function getMonthFromDateStr(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
  const parts = str.split(/[-/]/);
  if (parts.length >= 2) {
    return parseInt(parts[1], 10);
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.getMonth() + 1;
}

function setupHierarchyLevel4Events() {
  const btnMonthly = document.getElementById('btn-report-monthly');
  const btnYtd = document.getElementById('btn-report-ytd');
  const monthFilterWrap = document.getElementById('report-month-filter-wrap');
  const monthSelect = document.getElementById('report-month-select');
  const deptSelect = document.getElementById('report-dept-select');
  const exportBtn = document.getElementById('report-export-btn');
  const subtitle = document.getElementById('hierarchy4-subtitle');
  const metaTag = document.getElementById('report-meta-tag');

  if (btnMonthly && btnYtd) {
    btnMonthly.onclick = () => {
      appState.reportMode = 'monthly';
      btnMonthly.classList.add('active');
      btnYtd.classList.remove('active');
      if (monthFilterWrap) monthFilterWrap.style.display = 'flex';
      if (subtitle) subtitle.textContent = '依部門與業務人員展開當月接單專案明細 (對齊 FCI Sales Monthly Report)';
      if (metaTag) metaTag.textContent = '資料來源: Yearly Report Data - TW | Approval: F';
      renderHierarchyLevel4();
    };

    btnYtd.onclick = () => {
      appState.reportMode = 'ytd';
      btnYtd.classList.add('active');
      btnMonthly.classList.remove('active');
      if (monthFilterWrap) monthFilterWrap.style.display = 'none';
      if (subtitle) subtitle.textContent = '全公司業務人員年度累計接單、EBT 利潤與達成率匯總 (對齊 Sales Report Summary - FCI TW)';
      if (metaTag) metaTag.textContent = `幣別: NTD | 統計區間: ${appState.selectedYear}/1/1 - ${appState.selectedYear}/12/31`;
      renderHierarchyLevel4();
    };
  }

  if (monthSelect) {
    monthSelect.value = String(parseInt(appState.reportMonth, 10));
    monthSelect.onchange = (e) => {
      appState.reportMonth = e.target.value;
      renderHierarchyLevel4();
    };
  }

  if (deptSelect) {
    deptSelect.onchange = (e) => {
      appState.reportDept = e.target.value;
      renderHierarchyLevel4();
    };
  }

  if (exportBtn) {
    exportBtn.onclick = () => exportHierarchy4Table();
  }
}

function renderHierarchyLevel4() {
  const container = document.getElementById('report-table-container');
  const kpiContainer = document.getElementById('report-kpi-summary');
  if (!container || !kpiContainer) return;

  if (appState.reportMode === 'monthly') {
    renderMonthlyBookedReport(container, kpiContainer);
  } else {
    renderYtdSummaryReport(container, kpiContainer);
  }
}

// ------------------------------------------------------------
// 視圖 1: 當月份接單業績 (對齊 FCI Sales Monthly Report.pdf)
// ------------------------------------------------------------
function renderMonthlyBookedReport(container, kpiContainer) {
  const selectedYear = appState.selectedYear || '2026';
  const targetMonth = parseInt(appState.reportMonth, 10);

  // 篩選當月份訂單
  const monthlyOrders = appState.orders.filter(o => {
    const yr = getYearFromDateStr(o.created_date);
    const m = getMonthFromDateStr(o.created_date);
    if (yr !== selectedYear || m !== targetMonth) return false;

    // 部門篩選
    if (appState.reportDept !== 'ALL') {
      const dept = getRecordPowerNonPower(o);
      if (dept !== appState.reportDept) return false;
    }

    return true;
  });

  // 計算 KPI
  const totalOrders = monthlyOrders.length;
  const totalSalesAmt = monthlyOrders.reduce((sum, o) => sum + parseNumber(o.amount_twd), 0);
  const totalEbtProfit = monthlyOrders.reduce((sum, o) => sum + parseNumber(o.profit_twd || (parseNumber(o.amount_twd) * parseNumber(o.ebt_rate || 0.15))), 0);
  const avgEbtRate = totalSalesAmt > 0 ? (totalEbtProfit / totalSalesAmt * 100) : 0;

  kpiContainer.innerHTML = `
    <div class="report-kpi-card">
      <span class="report-kpi-title">📅 本月接單總額 (Sales Amount)</span>
      <span class="report-kpi-val num-font">NT$ ${formatNumberWithCommas(totalSalesAmt)}</span>
      <span class="report-kpi-sub">${selectedYear} 年 ${String(targetMonth).padStart(2, '0')} 月份訂單</span>
    </div>
    <div class="report-kpi-card">
      <span class="report-kpi-title">📈 本月預估利潤 (EBT Profit)</span>
      <span class="report-kpi-val num-font" style="color: #34d399;">NT$ ${formatNumberWithCommas(totalEbtProfit)}</span>
      <span class="report-kpi-sub">預估總獲利金額</span>
    </div>
    <div class="report-kpi-card">
      <span class="report-kpi-title">💎 平均利潤率 (Avg. EBT Rate)</span>
      <span class="report-kpi-val num-font" style="color: #38bdf8;">${formatPercent(avgEbtRate, 2)}</span>
      <span class="report-kpi-sub">利潤 / 營收比 (加權平均)</span>
    </div>
    <div class="report-kpi-card">
      <span class="report-kpi-title">📦 本月接單筆數 (Order Q'ty)</span>
      <span class="report-kpi-val num-font">${totalOrders} 筆</span>
      <span class="report-kpi-sub">已成交專案數</span>
    </div>
  `;

  if (totalOrders === 0) {
    container.innerHTML = `
      <div style="padding: 40px; text-align: center; color: var(--text-muted);">
        <p style="font-size: 16px; margin-bottom: 8px;">📭 查無 ${selectedYear} 年 ${String(targetMonth).padStart(2, '0')} 月份之接單資料</p>
        <p style="font-size: 13px;">請嘗試切換上方月份選單或調整搜尋條件。</p>
      </div>
    `;
    return;
  }

  // 組織兩層樹狀結構：部門 -> 業務人員 -> 訂單
  const deptMap = new Map();
  monthlyOrders.forEach(o => {
    const dept = getRecordPowerNonPower(o) || 'Other';
    const owner = normalizeOwnerName(o.owner);
    if (!deptMap.has(dept)) {
      deptMap.set(dept, new Map());
    }
    const salesMap = deptMap.get(dept);
    if (!salesMap.has(owner)) {
      salesMap.set(owner, []);
    }
    salesMap.get(owner).push(o);
  });

  let tableHtml = `
    <table class="report-data-table" id="hierarchy4-table-element">
      <thead>
        <tr>
          <th style="min-width: 100px;">業務組別</th>
          <th style="min-width: 160px;">責任業務</th>
          <th style="min-width: 180px;">顧客簡稱</th>
          <th class="col-center" style="min-width: 70px;">專案幣別</th>
          <th class="col-right" style="min-width: 130px;">專案金額 (原幣)</th>
          <th class="col-right" style="min-width: 130px;">專案金額 (台幣)</th>
          <th class="col-right" style="min-width: 120px;">預估利潤 (台幣)</th>
          <th class="col-right" style="min-width: 90px;">EBT Rate</th>
          <th class="col-center" style="min-width: 100px;">建檔日期</th>
        </tr>
      </thead>
      <tbody>
  `;

  let grandOrigAmt = 0;
  let grandTwdAmt = 0;
  let grandProfitAmt = 0;

  deptMap.forEach((salesMap, deptName) => {
    let deptOrdersCount = 0;
    let deptOrigAmt = 0;
    let deptTwdAmt = 0;
    let deptProfitAmt = 0;

    salesMap.forEach(orders => {
      deptOrdersCount += orders.length;
      orders.forEach(o => {
        const orig = parseNumber(o.amount_orig || o.amount_twd);
        const twd = parseNumber(o.amount_twd);
        const profit = parseNumber(o.profit_twd || (twd * parseNumber(o.ebt_rate || 0.15)));
        deptOrigAmt += orig;
        deptTwdAmt += twd;
        deptProfitAmt += profit;
      });
    });

    grandOrigAmt += deptOrigAmt;
    grandTwdAmt += deptTwdAmt;
    grandProfitAmt += deptProfitAmt;

    // 部門主標題橫條
    tableHtml += `
      <tr class="report-group-header-row">
        <td colspan="9">
          🏢 業務組別：${deptName} (${deptOrdersCount} 筆資料)
        </td>
      </tr>
    `;

    // 業務人員分組
    salesMap.forEach((orders, ownerName) => {
      const ownerFullName = getSalesFullName(ownerName);
      let sOrig = 0;
      let sTwd = 0;
      let sProfit = 0;

      tableHtml += `
        <tr class="report-sales-header-row">
          <td colspan="9" style="padding-left: 20px;">
            👤 ${ownerFullName} (${orders.length} 筆資料)
          </td>
        </tr>
      `;

      orders.forEach(o => {
        const orig = parseNumber(o.amount_orig || o.amount_twd);
        const twd = parseNumber(o.amount_twd);
        const profit = parseNumber(o.profit_twd || (twd * parseNumber(o.ebt_rate || 0.15)));
        const rate = twd > 0 ? (profit / twd) : (parseNumber(o.ebt_rate) || 0);
        const curr = o.currency || 'NTD';
        const custShort = o.customer_short || o['顧客簡稱'] || (o.customer ? o.customer.substring(0, 10) : '-');
        const dt = o.created_date ? String(o.created_date).replace(/-/g, '/') : '-';

        sOrig += orig;
        sTwd += twd;
        sProfit += profit;

        const rateBadgeClass = (rate >= 0.2) ? 'ebt-rate-high' : ((rate >= 0.1) ? 'ebt-rate-med' : 'ebt-rate-low');

        tableHtml += `
          <tr>
            <td style="color: var(--text-muted);">${deptName}</td>
            <td style="font-weight: 500;">${ownerFullName}</td>
            <td style="color: var(--text-main); font-weight: 500;">${custShort}</td>
            <td class="col-center" style="color: var(--text-muted);">${curr}</td>
            <td class="col-right num-font">${formatNumberWithCommas(orig, 2)}</td>
            <td class="col-right num-font" style="font-weight: 600;">${formatNumberWithCommas(twd, 0)}</td>
            <td class="col-right num-font" style="color: var(--fluids-green); font-weight: 600;">${formatNumberWithCommas(profit, 0)}</td>
            <td class="col-right">
              <span class="ebt-rate-badge ${rateBadgeClass} num-font">${formatPercent(rate * 100, 2)}</span>
            </td>
            <td class="col-center" style="color: var(--text-muted); font-size: 11.5px;">${dt}</td>
          </tr>
        `;
      });

      // 業務小計列
      const sRate = sTwd > 0 ? (sProfit / sTwd * 100) : 0;
      const sRateBadgeClass = (sRate >= 20) ? 'ebt-rate-high' : ((sRate >= 10) ? 'ebt-rate-med' : 'ebt-rate-low');
      tableHtml += `
        <tr class="report-subtotal-row">
          <td colspan="4" style="text-align: right; color: var(--text-muted); font-size: 12px;">${ownerFullName} 小計:</td>
          <td class="col-right num-font">${formatNumberWithCommas(sOrig, 2)}</td>
          <td class="col-right num-font">${formatNumberWithCommas(sTwd, 0)}</td>
          <td class="col-right num-font" style="color: var(--fluids-green); font-weight: 600;">${formatNumberWithCommas(sProfit, 0)}</td>
          <td class="col-right">
            <span class="ebt-rate-badge ${sRateBadgeClass} num-font">${formatPercent(sRate, 2)}</span>
          </td>
          <td class="col-center">-</td>
        </tr>
      `;
    });

    // 部門加總列
    const deptRate = deptTwdAmt > 0 ? (deptProfitAmt / deptTwdAmt * 100) : 0;
    tableHtml += `
      <tr class="report-dept-total-row">
        <td colspan="4" style="font-weight: 700;">🏢 ${deptName} 加總</td>
        <td class="col-right num-font">${formatNumberWithCommas(deptOrigAmt, 2)}</td>
        <td class="col-right num-font">${formatNumberWithCommas(deptTwdAmt, 0)}</td>
        <td class="col-right num-font">${formatNumberWithCommas(deptProfitAmt, 0)}</td>
        <td class="col-right">
          <span class="ebt-rate-badge ebt-rate-high num-font">${formatPercent(deptRate, 2)}</span>
        </td>
        <td class="col-center">-</td>
      </tr>
    `;
  });

  // 全公司總計列
  const grandRate = grandTwdAmt > 0 ? (grandProfitAmt / grandTwdAmt * 100) : 0;
  tableHtml += `
      <tr class="report-grand-total-row">
        <td colspan="4">🏁 總共 ${totalOrders} 筆資料 (Company Total)</td>
        <td class="col-right num-font">${formatNumberWithCommas(grandOrigAmt, 2)}</td>
        <td class="col-right num-font">${formatNumberWithCommas(grandTwdAmt, 0)}</td>
        <td class="col-right num-font">${formatNumberWithCommas(grandProfitAmt, 0)}</td>
        <td class="col-right">
          <span class="ebt-rate-badge ebt-rate-high num-font" style="font-size: 12.5px;">${formatPercent(grandRate, 2)}</span>
        </td>
        <td class="col-center">-</td>
      </tr>
    </tbody>
  </table>
  `;

  container.innerHTML = tableHtml;
}

// ------------------------------------------------------------
// 視圖 2: 年度累積接單業績 (對齊 Sales Report Summary - FCI TW.pdf)
// ------------------------------------------------------------
function renderYtdSummaryReport(container, kpiContainer) {
  const selectedYear = appState.selectedYear || '2026';

  // 篩選當年度訂單
  const curYearOrders = appState.orders.filter(o => {
    const yr = getYearFromDateStr(o.created_date);
    return yr === selectedYear;
  });

  // 篩選當年度目標
  const curYearTargets = appState.targets.filter(t => {
    const yr = (t['年份'] || t['year'] || '').toString().trim();
    return !selectedYear || yr === selectedYear;
  });

  // 業務人員對齊 PDF 兩大群組 (Charlie 同時負責 Non Power 與 Power&EPC)
  const NON_POWER_MEMBERS = ['Charlie', 'Jason', 'Ping', 'Neil', 'Rex', 'Sophie'];
  const POWER_EPC_MEMBERS = ['Canni', 'Charlie', 'Hayashi', 'Shawn', 'Yen'];

  function calcMemberRow(memName, targetGroup) {
    const fullName = getSalesFullName(memName);
    
    // 找出該業務的 Target
    const isTargetGroupMatch = (t) => {
      const p = normalizeOwnerName(t['Sales Person'] || t['salesPerson'] || '');
      if (p !== memName) return false;
      const team = (t['列表頁Team'] || t['Team'] || '').toString();
      if (targetGroup === 'Non Power') {
        return team.includes('NonPower') || team.includes('Non Power');
      } else {
        return team.includes('Power') || team.includes('EPC') || team.includes('MTO');
      }
    };

    let tRow = curYearTargets.find(isTargetGroupMatch);
    if (!tRow) {
      tRow = curYearTargets.find(t => normalizeOwnerName(t['Sales Person'] || t['salesPerson'] || '') === memName);
    }

    let salesTarget = 0;
    let ebtTarget = 0;

    if (memName === 'Charlie') {
      // Charlie 同時跨兩部門：Non Power (目標 6.5M / EBT 650K) 與 Power&EPC (目標 243.5M / EBT 24.85M)
      if (targetGroup === 'Non Power') {
        salesTarget = (tRow && parseNumber(tRow['NonPower Sales Target'])) || 6500000;
        ebtTarget = (tRow && parseNumber(tRow['NonPower EBT Target'])) || 650000;
      } else {
        salesTarget = (tRow && parseNumber(tRow['Power Sales Target'])) || 243500000;
        ebtTarget = (tRow && parseNumber(tRow['Power EBT Target'])) || 24850000;
      }
    } else {
      salesTarget = tRow ? parseNumber(tRow['Sales Amount Target'] || tRow['salesTarget']) : 0;
      ebtTarget = tRow ? parseNumber(tRow['EBT Target'] || tRow['ebtTarget'] || (salesTarget * 0.10)) : (salesTarget * 0.10);
    }

    // 找出該業務在該部門的年度已接單 (依部門精確過濾)
    const memOrders = curYearOrders.filter(o => {
      if (normalizeOwnerName(o.owner) !== memName) return false;
      const dept = getRecordPowerNonPower(o);
      if (targetGroup === 'Non Power') {
        return dept === 'NonPower';
      } else {
        return dept === 'Power' || dept === 'Power&EPC';
      }
    });

    const orderQty = memOrders.length;
    const salesBooked = memOrders.reduce((sum, o) => sum + parseNumber(o.amount_twd), 0);
    const ebtBooked = memOrders.reduce((sum, o) => sum + parseNumber(o.profit_twd || (parseNumber(o.amount_twd) * parseNumber(o.ebt_rate || 0.15))), 0);

    const salesAch = salesTarget > 0 ? (salesBooked / salesTarget * 100) : 0;
    const ebtAch = ebtTarget > 0 ? (ebtBooked / ebtTarget * 100) : 0;
    const targetEbtRate = salesTarget > 0 ? (ebtTarget / salesTarget * 100) : 10;
    const achEbtRate = salesBooked > 0 ? (ebtBooked / salesBooked * 100) : 0;

    return {
      team: targetGroup,
      name: memName,
      fullName: fullName,
      salesTarget,
      salesBooked,
      salesAch,
      ebtTarget,
      ebtBooked,
      ebtAch,
      targetEbtRate,
      achEbtRate,
      orderQty
    };
  }

  const npRows = NON_POWER_MEMBERS.map(m => calcMemberRow(m, 'Non Power'));
  const powerRows = POWER_EPC_MEMBERS.map(m => calcMemberRow(m, 'Power&EPC'));

  // 部門過濾
  let displayNp = (appState.reportDept === 'ALL' || appState.reportDept === 'NonPower');
  let displayPower = (appState.reportDept === 'ALL' || appState.reportDept === 'Power');

  // 計算小計與加總
  function sumGroup(rows) {
    const sTarget = rows.reduce((s, r) => s + r.salesTarget, 0);
    const sBooked = rows.reduce((s, r) => s + r.salesBooked, 0);
    const eTarget = rows.reduce((s, r) => s + r.ebtTarget, 0);
    const eBooked = rows.reduce((s, r) => s + r.ebtBooked, 0);
    const qty = rows.reduce((s, r) => s + r.orderQty, 0);
    return {
      salesTarget: sTarget,
      salesBooked: sBooked,
      salesAch: sTarget > 0 ? (sBooked / sTarget * 100) : 0,
      ebtTarget: eTarget,
      ebtBooked: eBooked,
      ebtAch: eTarget > 0 ? (eBooked / eTarget * 100) : 0,
      targetEbtRate: sTarget > 0 ? (eTarget / sTarget * 100) : 10,
      achEbtRate: sBooked > 0 ? (eBooked / sBooked * 100) : 0,
      orderQty: qty
    };
  }

  const npSubtotal = sumGroup(npRows);
  const powerSubtotal = sumGroup(powerRows);
  const companyTotal = sumGroup([...npRows, ...powerRows]);

  // 更新 KPI 膠囊
  kpiContainer.innerHTML = `
    <div class="report-kpi-card">
      <span class="report-kpi-title">🏆 年度累計接單 (YTD Booked)</span>
      <span class="report-kpi-val num-font">NT$ ${formatNumberWithCommas(companyTotal.salesBooked)}</span>
      <span class="report-kpi-sub">目標: NT$ ${formatNumberWithCommas(companyTotal.salesTarget)}</span>
    </div>
    <div class="report-kpi-card">
      <span class="report-kpi-title">🎯 全年銷售達成率 (Sales Ach.)</span>
      <span class="report-kpi-val num-font" style="color: ${companyTotal.salesAch >= 80 ? '#34d399' : '#f59e0b'};">
        ${formatPercent(companyTotal.salesAch, 1)}
      </span>
      <span class="report-kpi-sub">集團整體 Order Booked 達成</span>
    </div>
    <div class="report-kpi-card">
      <span class="report-kpi-title">💎 年度累積 EBT 利潤 (Booked EBT)</span>
      <span class="report-kpi-val num-font" style="color: #38bdf8;">NT$ ${formatNumberWithCommas(companyTotal.ebtBooked)}</span>
      <span class="report-kpi-sub">EBT 達成率: ${formatPercent(companyTotal.ebtAch, 1)}</span>
    </div>
    <div class="report-kpi-card">
      <span class="report-kpi-title">📑 全年成交筆數 (Total Q'ty)</span>
      <span class="report-kpi-val num-font">${companyTotal.orderQty} 筆</span>
      <span class="report-kpi-sub">平均利潤率: ${formatPercent(companyTotal.achEbtRate, 1)}</span>
    </div>
  `;

  // 輔助函式：達成率進度膠囊
  function renderAchCell(achPct) {
    const val = Number(achPct) || 0;
    const fillWidth = Math.min(100, Math.max(0, val));
    let color = '#f87171'; // 紅色
    if (val >= 100) color = '#34d399'; // 綠色
    else if (val >= 60) color = '#38bdf8'; // 藍色
    else if (val >= 30) color = '#fbbf24'; // 黃色

    return `
      <div class="ach-cell-wrap">
        <span class="num-font" style="color: ${color}; font-weight: 700;">${formatPercent(val, 0)}</span>
        <div class="ach-bar-mini">
          <div class="ach-bar-fill" style="width: ${fillWidth}%; background: ${color};"></div>
        </div>
      </div>
    `;
  }

  // 渲染資料列
  function renderRowHtml(r) {
    return `
      <tr>
        <td style="color: var(--text-muted); font-size: 12px;">${r.team}</td>
        <td style="font-weight: 600; color: var(--text-main);">${r.fullName}</td>
        <td class="col-right num-font">${formatNumberWithCommas(r.salesTarget, 0)}</td>
        <td class="col-right num-font" style="font-weight: 700; color: var(--fluids-blue);">${formatNumberWithCommas(r.salesBooked, 0)}</td>
        <td class="col-right">${renderAchCell(r.salesAch)}</td>
        <td class="col-right num-font">${formatNumberWithCommas(r.ebtTarget, 0)}</td>
        <td class="col-right num-font" style="font-weight: 600; color: var(--fluids-green);">${formatNumberWithCommas(r.ebtBooked, 0)}</td>
        <td class="col-right">${renderAchCell(r.ebtAch)}</td>
        <td class="col-right num-font" style="color: var(--text-muted);">${formatPercent(r.targetEbtRate, 0)}</td>
        <td class="col-right num-font" style="color: var(--fluids-yellow); font-weight: 600;">${formatPercent(r.achEbtRate, 0)}</td>
        <td class="col-center num-font" style="font-weight: 700;">${r.orderQty}</td>
      </tr>
    `;
  }

  let tableHtml = `
    <table class="report-data-table" id="hierarchy4-table-element">
      <thead>
        <tr>
          <th style="min-width: 100px;">Sales Team</th>
          <th style="min-width: 170px;">Sales Person</th>
          <th class="col-right" style="min-width: 120px;">Target (業績)</th>
          <th class="col-right" style="min-width: 130px;">Order Booked</th>
          <th class="col-right" style="min-width: 110px;">Ach.</th>
          <th class="col-right" style="min-width: 120px;">Target (EBT)</th>
          <th class="col-right" style="min-width: 125px;">Order Booked EBT</th>
          <th class="col-right" style="min-width: 110px;">Ach.</th>
          <th class="col-right" style="min-width: 85px;">Target Rate</th>
          <th class="col-right" style="min-width: 85px;">Ach. Rate</th>
          <th class="col-center" style="min-width: 80px;">Order Q'ty</th>
        </tr>
      </thead>
      <tbody>
  `;

  // 1. Non Power 群組
  if (displayNp) {
    npRows.forEach(r => {
      tableHtml += renderRowHtml(r);
    });

    // Non Power 小計列
    tableHtml += `
      <tr class="report-dept-total-row">
        <td colspan="2" style="font-weight: 700;">TEAM SUMMARY: Non Power</td>
        <td class="col-right num-font">${formatNumberWithCommas(npSubtotal.salesTarget, 0)}</td>
        <td class="col-right num-font">${formatNumberWithCommas(npSubtotal.salesBooked, 0)}</td>
        <td class="col-right">${renderAchCell(npSubtotal.salesAch)}</td>
        <td class="col-right num-font">${formatNumberWithCommas(npSubtotal.ebtTarget, 0)}</td>
        <td class="col-right num-font">${formatNumberWithCommas(npSubtotal.ebtBooked, 0)}</td>
        <td class="col-right">${renderAchCell(npSubtotal.ebtAch)}</td>
        <td class="col-right num-font">${formatPercent(npSubtotal.targetEbtRate, 0)}</td>
        <td class="col-right num-font" style="font-weight: 700;">${formatPercent(npSubtotal.achEbtRate, 0)}</td>
        <td class="col-center num-font" style="font-weight: 700;">${npSubtotal.orderQty}</td>
      </tr>
    `;
  }

  // 2. Power&EPC 群組
  if (displayPower) {
    powerRows.forEach(r => {
      tableHtml += renderRowHtml(r);
    });

    // Power&EPC 小計列
    tableHtml += `
      <tr class="report-dept-total-row">
        <td colspan="2" style="font-weight: 700;">TEAM SUMMARY: Power&EPC</td>
        <td class="col-right num-font">${formatNumberWithCommas(powerSubtotal.salesTarget, 0)}</td>
        <td class="col-right num-font">${formatNumberWithCommas(powerSubtotal.salesBooked, 0)}</td>
        <td class="col-right">${renderAchCell(powerSubtotal.salesAch)}</td>
        <td class="col-right num-font">${formatNumberWithCommas(powerSubtotal.ebtTarget, 0)}</td>
        <td class="col-right num-font">${formatNumberWithCommas(powerSubtotal.ebtBooked, 0)}</td>
        <td class="col-right">${renderAchCell(powerSubtotal.ebtAch)}</td>
        <td class="col-right num-font">${formatPercent(powerSubtotal.targetEbtRate, 0)}</td>
        <td class="col-right num-font" style="font-weight: 700;">${formatPercent(powerSubtotal.achEbtRate, 0)}</td>
        <td class="col-center num-font" style="font-weight: 700;">${powerSubtotal.orderQty}</td>
      </tr>
    `;
  }

  // 3. Company Total 全公司總計
  tableHtml += `
      <tr class="report-grand-total-row">
        <td colspan="2">🏁 全公司加總 (Company Total)</td>
        <td class="col-right num-font">${formatNumberWithCommas(companyTotal.salesTarget, 0)}</td>
        <td class="col-right num-font" style="color: #67e8f9;">${formatNumberWithCommas(companyTotal.salesBooked, 0)}</td>
        <td class="col-right">${renderAchCell(companyTotal.salesAch)}</td>
        <td class="col-right num-font">${formatNumberWithCommas(companyTotal.ebtTarget, 0)}</td>
        <td class="col-right num-font" style="color: #34d399;">${formatNumberWithCommas(companyTotal.ebtBooked, 0)}</td>
        <td class="col-right">${renderAchCell(companyTotal.ebtAch)}</td>
        <td class="col-right num-font">${formatPercent(companyTotal.targetEbtRate, 0)}</td>
        <td class="col-right num-font" style="font-weight: 800;">${formatPercent(companyTotal.achEbtRate, 0)}</td>
        <td class="col-center num-font" style="font-weight: 800;">${companyTotal.orderQty}</td>
      </tr>
    </tbody>
  </table>
  `;

  container.innerHTML = tableHtml;
}

// ------------------------------------------------------------
// 匯出報表為 TSV / 複製剪貼簿
// ------------------------------------------------------------
function exportHierarchy4Table() {
  const table = document.getElementById('hierarchy4-table-element');
  const btn = document.getElementById('report-export-btn');
  if (!table) return;

  let tsvContent = '';
  const rows = table.querySelectorAll('tr');
  rows.forEach(r => {
    const cols = r.querySelectorAll('th, td');
    const rowData = [];
    cols.forEach(c => {
      // 清理換行與多餘空白
      const text = c.innerText.replace(/(\r\n|\n|\r)/gm, ' ').replace(/\s+/g, ' ').trim();
      rowData.push(text);
    });
    tsvContent += rowData.join('\t') + '\n';
  });

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(tsvContent).then(() => {
      if (btn) {
        const originalText = btn.innerHTML;
        btn.innerHTML = '✅ 已複製至剪貼簿！';
        btn.style.color = '#34d399';
        setTimeout(() => {
          btn.innerHTML = originalText;
          btn.style.color = '';
        }, 1800);
      }
    }).catch(err => {
      console.warn('複製失敗，改用傳統方式:', err);
      alert('已產生報表資料，請於控制台查看。');
      console.log(tsvContent);
    });
  } else {
    console.log(tsvContent);
    alert('已輸出報表文字至 Console。');
  }
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
// TAB 3: 歷年趨勢與 Run-Rate 斜率預估模型 (全支援動態篩選)
// ------------------------------------------------------------
function renderTrendsTab() {
  const { selectedYear, selectedGroupFilter, selectedSales } = appState;
  const prevYear = (parseInt(selectedYear) - 1).toString();

  // 1. 篩選基礎數據 (過濾狀態為 '簽核完成' 的訂單)
  const allSignedOrders = appState.orders.filter(o => {
    const matchStatus = (o.status === '簽核完成');
    const matchGroup = matchesDepartmentFilter(getRecordPowerNonPower(o), selectedGroupFilter);
    const matchSales = (selectedSales === 'ALL' || normalizeOwnerName(o.owner) === selectedSales);
    return matchStatus && matchGroup && matchSales;
  });

  const curYearOrders = allSignedOrders.filter(o => getYearFromDateStr(o.created_date) === selectedYear);
  const prevYearOrders = allSignedOrders.filter(o => getYearFromDateStr(o.created_date) === prevYear);

  // 2. 計算全體 YoY 核心指標 (填寫 Top 4 Hero Banner)
  const curTotalAmount = curYearOrders.reduce((sum, o) => sum + parseNumber(o.amount_twd), 0);
  const prevTotalAmount = prevYearOrders.reduce((sum, o) => sum + parseNumber(o.amount_twd), 0);
  const amountDiff = curTotalAmount - prevTotalAmount;
  const amountGrowthPct = prevTotalAmount > 0 ? ((amountDiff / prevTotalAmount) * 100).toFixed(1) : (curTotalAmount > 0 ? '100.0' : '0.0');

  const curTotalCount = curYearOrders.length;
  const prevTotalCount = prevYearOrders.length;
  const countDiff = curTotalCount - prevTotalCount;
  const countGrowthPct = prevTotalCount > 0 ? (((countDiff) / prevTotalCount) * 100).toFixed(1) : (curTotalCount > 0 ? '100.0' : '0.0');

  // Banner 卡片 1: 接單金額 YoY 成長 (台灣慣例：正成長為紅色)
  const amountElem = document.getElementById('yoy-amount-growth');
  if (amountElem) {
    amountElem.textContent = `${amountGrowthPct >= 0 ? '+' : ''}${amountGrowthPct}%`;
    amountElem.className = `hero-value num-font ${amountGrowthPct >= 0 ? 'text-rose-500' : 'text-emerald'}`;
  }
  const amountDiffElem = document.getElementById('yoy-amount-diff');
  if (amountDiffElem) {
    amountDiffElem.textContent = `去年: ${formatTWD(prevTotalAmount)} | 增減: ${amountDiff >= 0 ? '+' : ''}${formatTWD(amountDiff)}`;
  }

  // Banner 卡片 2: 接單筆數 YoY 成長 (含去年數值)
  const countElem = document.getElementById('yoy-count-growth');
  if (countElem) {
    countElem.textContent = `${countGrowthPct >= 0 ? '+' : ''}${countGrowthPct}% (${curTotalCount} 筆)`;
  }
  const countDiffElem = document.getElementById('yoy-count-diff');
  if (countDiffElem) {
    countDiffElem.textContent = `去年: ${prevTotalCount} 筆 | 增減: ${countDiff >= 0 ? '+' : ''}${countDiff} 筆`;
  }

  // Helper: 讀取 Industry (新)
  const getIndustry = (o) => {
    const ind = (o['Industry (新)'] || o['industry (新)'] || o['顧客簡稱'] || o['customer'] || '').toString().trim();
    if (!ind || ind === 'undefined') return '其他產業';
    return ind;
  };

  // 最佳成長產業
  const allIndustries = Array.from(new Set(allSignedOrders.map(o => getIndustry(o))));
  const industryYoYStats = allIndustries.map(ind => {
    const curAmt = curYearOrders.filter(o => getIndustry(o) === ind).reduce((sum, o) => sum + parseNumber(o.amount_twd), 0);
    const prevAmt = prevYearOrders.filter(o => getIndustry(o) === ind).reduce((sum, o) => sum + parseNumber(o.amount_twd), 0);
    const curCnt = curYearOrders.filter(o => getIndustry(o) === ind).length;
    const prevCnt = prevYearOrders.filter(o => getIndustry(o) === ind).length;
    const diffAmt = curAmt - prevAmt;
    const growthPct = prevAmt > 0 ? ((diffAmt / prevAmt) * 100) : (curAmt > 0 ? 100 : 0);
    return { ind, curAmt, prevAmt, curCnt, prevCnt, diffAmt, growthPct };
  }).filter(item => item.curAmt > 0 || item.prevAmt > 0).sort((a, b) => b.diffAmt - a.diffAmt);

  const topInd = industryYoYStats[0];
  const indElem = document.getElementById('yoy-top-industry');
  const indAmtElem = document.getElementById('yoy-top-industry-amt');
  if (topInd) {
    if (indElem) indElem.textContent = topInd.ind;
    if (indAmtElem) indAmtElem.textContent = `去年: ${formatTWD(topInd.prevAmt)} | 增減: ${topInd.diffAmt >= 0 ? '+' : ''}${formatTWD(topInd.diffAmt)}`;
  } else {
    if (indElem) indElem.textContent = '無';
    if (indAmtElem) indAmtElem.textContent = '去年: NT$ 0 | 增減: NT$ 0';
  }

  // 鎖定與「階層 3：業務個人業績排行榜」完全一模一樣的 FCI-TW 業務名單
  const fciTwCurrentYearSales = FCI_FULL_SALES_ROSTER
    .filter(m => matchesDepartmentFilter(mapRosterGroupToBucket(m.group), selectedGroupFilter))
    .map(m => m.name);

  // 最佳成長業務
  const salesYoYStats = fciTwCurrentYearSales.map(salesName => {
    const curAmt = curYearOrders.filter(o => normalizeOwnerName(o.owner) === salesName).reduce((sum, o) => sum + parseNumber(o.amount_twd), 0);
    const prevAmt = prevYearOrders.filter(o => normalizeOwnerName(o.owner) === salesName).reduce((sum, o) => sum + parseNumber(o.amount_twd), 0);
    const curCnt = curYearOrders.filter(o => normalizeOwnerName(o.owner) === salesName).length;
    const prevCnt = prevYearOrders.filter(o => normalizeOwnerName(o.owner) === salesName).length;
    const diffAmt = curAmt - prevAmt;
    const growthPct = prevAmt > 0 ? ((diffAmt / prevAmt) * 100) : (curAmt > 0 ? 100 : 0);
    return { salesName, curAmt, prevAmt, curCnt, prevCnt, diffAmt, growthPct };
  }).sort((a, b) => b.diffAmt - a.diffAmt);

  const topSales = salesYoYStats[0];
  const topElem = document.getElementById('yoy-top-sales');
  const topAmtElem = document.getElementById('yoy-top-sales-amt');
  if (topSales) {
    if (topElem) topElem.textContent = topSales.salesName;
    if (topAmtElem) topAmtElem.textContent = `去年: ${formatTWD(topSales.prevAmt)} | 增減: ${topSales.diffAmt >= 0 ? '+' : ''}${formatTWD(topSales.diffAmt)}`;
  } else {
    if (topElem) topElem.textContent = '無';
    if (topAmtElem) topAmtElem.textContent = '去年: NT$ 0 | 增減: NT$ 0';
  }

  // 3. 圖表一：歷年累計營收與 Run-Rate 斜率預估走勢曲線 (Banner 下首張圖表)
  const monthLabels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const { filteredTargets } = getFilteredDataset();
  const targetAmount = filteredTargets.reduce((sum, t) => sum + parseNumber(t['Sales Amount Target'] || t['salesTarget']), 0);
  const currentMonth = new Date().getMonth() + 1;
  const ytdMonths = Math.min(12, currentMonth);

  const actualCumulative = new Array(12).fill(null);
  const projectedCumulative = new Array(12).fill(null);
  const targetLine = new Array(12).fill(targetAmount / 1000000);

  let acc = 0;
  for (let m = 0; m < ytdMonths; m++) {
    const amt = curYearOrders.filter(o => o.created_date && new Date(o.created_date).getMonth() === m)
                             .reduce((sum, o) => sum + parseNumber(o.amount_twd), 0) / 1000000;
    acc += amt;
    actualCumulative[m] = acc;
  }

  const ytdActual = acc * 1000000;
  const monthlySlope = ytdMonths > 0 ? (ytdActual / ytdMonths) : 0;
  const projectedFullYear = monthlySlope * 12;

  projectedCumulative[ytdMonths - 1] = actualCumulative[ytdMonths - 1];
  for (let m = ytdMonths; m < 12; m++) {
    projectedCumulative[m] = actualCumulative[ytdMonths - 1] + (monthlySlope / 1000000) * (m - (ytdMonths - 1));
  }

  const ctxCum = document.getElementById('cumulative-chart')?.getContext('2d');
  if (ctxCum) {
    if (cumulativeChart) cumulativeChart.destroy();
    cumulativeChart = new Chart(ctxCum, {
      type: 'line',
      data: {
        labels: monthLabels,
        datasets: [
          {
            label: `${selectedYear} YTD 實績累計 (M TWD)`,
            data: actualCumulative,
            borderColor: BRAND_COLORS.green,
            backgroundColor: adjustOpacity(BRAND_COLORS.green, 0.15),
            fill: true,
            tension: 0.3,
            pointRadius: 5,
            borderWidth: 3
          },
          {
            label: `Run-Rate 斜率預估軌跡 (${formatTWD(projectedFullYear)})`,
            data: projectedCumulative,
            borderColor: BRAND_COLORS.yellow,
            borderDash: [6, 4],
            backgroundColor: 'transparent',
            tension: 0.3,
            pointRadius: 4,
            borderWidth: 3
          },
          {
            label: `年度總目標 (${formatTWD(targetAmount)})`,
            data: targetLine,
            borderColor: BRAND_COLORS.red,
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
        plugins: { legend: { labels: { color: getThemeConfig().textColor } } },
        scales: {
          x: { ticks: { color: getThemeConfig().textColor }, grid: { color: getThemeConfig().gridColor } },
          y: { ticks: { color: getThemeConfig().textColor }, grid: { color: getThemeConfig().gridColor }, title: { display: true, text: '累計金額 (M NT$)', color: getThemeConfig().textColor } }
        }
      }
    });
  }

  // 4. 圖表二：業務人員歷年成長軌跡圖 (Sales Multi-Year Trend + 點擊聚焦高亮變淡)
  const availableYears = Array.from(new Set(allSignedOrders.map(o => getYearFromDateStr(o.created_date))))
    .filter(y => y >= '2022' && y <= '2030').sort();
  if (!availableYears.includes(selectedYear)) availableYears.push(selectedYear);
  availableYears.sort();

  const salesColors = ['#10b981', '#38bdf8', '#f59e0b', '#a855f7', '#ec4899', '#3b82f6', '#14b8a6', '#f97316', '#6366f1', '#84cc16'];

  let highlightedSalesIdx = -1; // 紀錄點選聚焦的高亮業務索引

  const buildSalesDatasets = (focusIdx = -1) => {
    return fciTwCurrentYearSales.map((salesName, idx) => {
      const yearData = availableYears.map(yr => {
        const yrSalesOrders = allSignedOrders.filter(o => getYearFromDateStr(o.created_date) === yr && normalizeOwnerName(o.owner) === salesName);
        return yrSalesOrders.reduce((sum, o) => sum + parseNumber(o.amount_twd), 0) / 1000000;
      });

      const baseColor = salesColors[idx % salesColors.length];
      const isFocused = (focusIdx === -1 || focusIdx === idx);

      return {
        label: salesName,
        data: yearData,
        borderColor: isFocused ? baseColor : 'rgba(148, 163, 184, 0.18)',
        backgroundColor: isFocused ? baseColor : 'rgba(148, 163, 184, 0.18)',
        tension: 0.3,
        pointRadius: isFocused ? 5 : 2,
        borderWidth: isFocused ? 3 : 1
      };
    });
  };

  const ctxSalesMulti = document.getElementById('sales-multiyear-chart')?.getContext('2d');
  if (ctxSalesMulti) {
    if (salesMultiYearChart) salesMultiYearChart.destroy();
    salesMultiYearChart = new Chart(ctxSalesMulti, {
      type: 'line',
      data: { labels: availableYears.map(y => `${y}年`), datasets: buildSalesDatasets(-1) },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { color: '#94a3b8' },
            onClick: (e, legendItem, legend) => {
              const index = legendItem.datasetIndex;
              if (highlightedSalesIdx === index) {
                highlightedSalesIdx = -1; // 再次點擊取消聚焦
              } else {
                highlightedSalesIdx = index; // 聚焦特定業務
              }
              legend.chart.data.datasets = buildSalesDatasets(highlightedSalesIdx);
              legend.chart.update();
            }
          }
        },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' }, title: { display: true, text: '年度接單金額 (M NT$)', color: '#94a3b8' } }
        }
      }
    });
  }

  // 5. 圖表三：客戶與產業別 (Industry (新)) 跨年度總金額曲線圖 (Line Chart)
  const industryAnnualMap = {};
  allSignedOrders.forEach(o => {
    const yr = getYearFromDateStr(o.created_date);
    const ind = getIndustry(o);
    if (!industryAnnualMap[ind]) industryAnnualMap[ind] = {};
    industryAnnualMap[ind][yr] = (industryAnnualMap[ind][yr] || 0) + parseNumber(o.amount_twd) / 1000000;
  });

  const sortedTopIndustries = Object.keys(industryAnnualMap)
    .sort((a, b) => ((industryAnnualMap[b][selectedYear] || 0) - (industryAnnualMap[a][selectedYear] || 0)))
    .slice(0, 6);

  const indColors = ['#10b981', '#0ea5e9', '#f59e0b', '#a855f7', '#ec4899', '#6366f1', '#64748b'];

  const indAnnualDatasets = sortedTopIndustries.map((ind, idx) => ({
    label: ind,
    data: availableYears.map(yr => industryAnnualMap[ind][yr] || 0),
    borderColor: indColors[idx % indColors.length],
    backgroundColor: indColors[idx % indColors.length],
    tension: 0.3,
    pointRadius: 5,
    borderWidth: 2.5
  }));

  const ctxInd = document.getElementById('industry-trend-chart')?.getContext('2d');
  if (ctxInd) {
    if (industryTrendChart) industryTrendChart.destroy();
    industryTrendChart = new Chart(ctxInd, {
      type: 'line',
      data: { labels: availableYears.map(y => `${y}年`), datasets: indAnnualDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' }, title: { display: true, text: '跨年度接單總金額 (M NT$)', color: '#94a3b8' } }
        }
      }
    });
  }

  // 6. 業務人員 YoY 成長排行榜與對比表格 (FCI-TW 當年度名冊)
  const salesYoYContainer = document.getElementById('sales-yoy-container');
  if (salesYoYContainer) {
    salesYoYContainer.innerHTML = `
      <table class="yoy-table">
        <thead>
          <tr>
            <th>FCI-TW 業務責任</th>
            <th>${selectedYear} 金額</th>
            <th>${prevYear} 金額</th>
            <th>${selectedYear} 筆數</th>
            <th>YoY 成長 %</th>
          </tr>
        </thead>
        <tbody>
          ${salesYoYStats.map(s => {
            const isUp = s.diffAmt >= 0;
            return `
              <tr>
                <td><b>${s.salesName}</b></td>
                <td style="font-weight:700; color:#f87171;">${formatTWD(s.curAmt)}</td>
                <td style="color:#94a3b8;">${formatTWD(s.prevAmt)}</td>
                <td>${s.curCnt} 筆 <span style="font-size:11px; color:#64748b;">(前:${s.prevCnt})</span></td>
                <td>
                  <span class="yoy-badge ${isUp ? 'yoy-badge-up' : 'yoy-badge-down'}">
                    ${isUp ? '▲' : '▼'} ${s.growthPct.toFixed(1)}%
                  </span>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  // 7. 產業別 (Industry (新)) YoY 年對年對比排行榜與表格
  const indYoYContainer = document.getElementById('industry-yoy-container');
  if (indYoYContainer) {
    indYoYContainer.innerHTML = `
      <table class="yoy-table">
        <thead>
          <tr>
            <th>Industry (新)</th>
            <th>${selectedYear} 金額</th>
            <th>${prevYear} 金額</th>
            <th>${selectedYear} 筆數</th>
            <th>YoY 成長 %</th>
          </tr>
        </thead>
        <tbody>
          ${industryYoYStats.map(s => {
            const isUp = s.diffAmt >= 0;
            return `
              <tr>
                <td><b>${s.ind}</b></td>
                <td style="font-weight:700; color:#f87171;">${formatTWD(s.curAmt)}</td>
                <td style="color:#94a3b8;">${formatTWD(s.prevAmt)}</td>
                <td>${s.curCnt} 筆 <span style="font-size:11px; color:#64748b;">(前:${s.prevCnt})</span></td>
                <td>
                  <span class="yoy-badge ${isUp ? 'yoy-badge-up' : 'yoy-badge-down'}">
                    ${isUp ? '▲' : '▼'} ${s.growthPct.toFixed(1)}%
                  </span>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  // 8. 月度對比圖表拆分 (A: 月度成交金額對比, B: 月度成交筆數對比)
  const monthlyAmounts = new Array(12).fill(0);
  const prevMonthlyAmounts = new Array(12).fill(0);
  const monthlyCounts = new Array(12).fill(0);
  const prevMonthlyCounts = new Array(12).fill(0);

  curYearOrders.forEach(o => {
    if (o.created_date) {
      const m = new Date(o.created_date).getMonth();
      if (m >= 0 && m < 12) {
        monthlyAmounts[m] += parseNumber(o.amount_twd) / 1000000;
        monthlyCounts[m] += 1;
      }
    }
  });

  prevYearOrders.forEach(o => {
    if (o.created_date) {
      const m = new Date(o.created_date).getMonth();
      if (m >= 0 && m < 12) {
        prevMonthlyAmounts[m] += parseNumber(o.amount_twd) / 1000000;
        prevMonthlyCounts[m] += 1;
      }
    }
  });

  // (A) 月度成交金額對比圖 (曲線圖)
  const ctxMamt = document.getElementById('monthly-amount-chart')?.getContext('2d');
  if (ctxMamt) {
    if (monthlyAmountChart) monthlyAmountChart.destroy();
    monthlyAmountChart = new Chart(ctxMamt, {
      type: 'line',
      data: {
        labels: monthLabels,
        datasets: [
          {
            label: `${selectedYear} 成交金額 (M TWD)`,
            data: monthlyAmounts,
            borderColor: '#10b981',
            backgroundColor: '#10b981',
            tension: 0.3,
            pointRadius: 5,
            borderWidth: 3
          },
          {
            label: `${prevYear} 成交金額 (M TWD)`,
            data: prevMonthlyAmounts,
            borderColor: '#f59e0b',
            backgroundColor: '#f59e0b',
            borderDash: [5, 5],
            tension: 0.3,
            pointRadius: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' }, title: { display: true, text: '金額 (M NT$)', color: '#94a3b8' } }
        }
      }
    });
  }

  // (B) 月度成交件數對比圖
  const ctxMcnt = document.getElementById('monthly-count-chart')?.getContext('2d');
  if (ctxMcnt) {
    if (monthlyCountChart) monthlyCountChart.destroy();
    monthlyCountChart = new Chart(ctxMcnt, {
      type: 'line',
      data: {
        labels: monthLabels,
        datasets: [
          {
            label: `${selectedYear} 成交筆數 (筆)`,
            data: monthlyCounts,
            borderColor: '#38bdf8',
            backgroundColor: '#38bdf8',
            tension: 0.3,
            pointRadius: 5
          },
          {
            label: `${prevYear} 成交筆數 (筆)`,
            data: prevMonthlyCounts,
            borderColor: '#a855f7',
            backgroundColor: '#a855f7',
            borderDash: [5, 5],
            tension: 0.3,
            pointRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
          y: { ticks: { color: '#94a3b8', precision: 0 }, grid: { color: 'rgba(255, 255, 255, 0.05)' }, title: { display: true, text: '件數 (筆)', color: '#94a3b8' } }
        }
      }
    });
  }

  // 9. 季度營收 (條狀 Bar) 與平均單案金額 (曲線 Line) 整合雙軸圖表
  const qAmounts = [0, 0, 0, 0];
  const qCounts = [0, 0, 0, 0];

  curYearOrders.forEach(o => {
    if (o.created_date) {
      const m = new Date(o.created_date).getMonth();
      const q = Math.floor(m / 3);
      if (q >= 0 && q < 4) {
        qAmounts[q] += parseNumber(o.amount_twd) / 1000000;
        qCounts[q] += 1;
      }
    }
  });

  const qAvgDealSizes = qAmounts.map((amtM, idx) => {
    const cnt = qCounts[idx];
    return cnt > 0 ? (amtM * 1000000 / cnt / 10000) : 0;
  });

  const ctxQDeal = document.getElementById('quarterly-dealsize-chart')?.getContext('2d');
  if (ctxQDeal) {
    if (quarterlyDealSizeChart) quarterlyDealSizeChart.destroy();
    quarterlyDealSizeChart = new Chart(ctxQDeal, {
      type: 'bar',
      data: {
        labels: ['Q1 第一季', 'Q2 第二季', 'Q3 第三季', 'Q4 第四季'],
        datasets: [
          {
            label: `${selectedYear} 季度成交額 (M NT$)`,
            data: qAmounts,
            backgroundColor: 'rgba(59, 130, 246, 0.7)',
            borderColor: '#3b82f6',
            borderRadius: 8,
            yAxisID: 'yAmount'
          },
          {
            label: `${selectedYear} 平均單案金額 (萬 NT$)`,
            data: qAvgDealSizes,
            type: 'line',
            borderColor: '#f59e0b',
            backgroundColor: '#f59e0b',
            tension: 0.3,
            pointRadius: 6,
            borderWidth: 3,
            yAxisID: 'yAvg'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
          yAmount: { type: 'linear', position: 'left', ticks: { color: '#3b82f6' }, title: { display: true, text: '季度總額 (M NT$)', color: '#3b82f6' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
          yAvg: { type: 'linear', position: 'right', ticks: { color: '#f59e0b' }, title: { display: true, text: '平均單案金額 (萬 NT$)', color: '#f59e0b' }, grid: { drawOnChartArea: false } }
        }
      }
    });
  }

  // 10. Sales 業務成長動能矩陣 (以去年度業務平均個人實績為 4 象限切分基準線)
  const salesMap = {};
  fciTwCurrentYearSales.forEach(s => {
    salesMap[s] = { count: 0, amount: 0 };
  });

  curYearOrders.forEach(o => {
    const s = normalizeOwnerName(o.owner);
    if (salesMap[s]) {
      salesMap[s].count += 1;
      salesMap[s].amount += parseNumber(o.amount_twd) / 1000000;
    }
  });

  const scatterData = Object.keys(salesMap).map(s => ({
    x: salesMap[s].count,
    y: salesMap[s].amount,
    salesName: s
  }));

  // 計算黃金切分基準線：去年度總筆數 / 當前業務人數, 去年度總金額 / 當前業務人數
  const prevCountTotal = prevYearOrders.length;
  const prevAmtTotalM = prevYearOrders.reduce((sum, o) => sum + parseNumber(o.amount_twd), 0) / 1000000;
  const salesCount = fciTwCurrentYearSales.length || 1;

  let xCut = prevCountTotal > 0 ? (prevCountTotal / salesCount) : (scatterData.reduce((s, p) => s + p.x, 0) / salesCount);
  let yCut = prevAmtTotalM > 0 ? (prevAmtTotalM / salesCount) : (scatterData.reduce((s, p) => s + p.y, 0) / salesCount);

  if (xCut <= 0) xCut = 3;
  if (yCut <= 0) yCut = 5;

  const quadrantLinesPlugin = {
    id: 'quadrantLines',
    beforeDraw: (chart) => {
      const { ctx, chartArea: { left, top, right, bottom }, scales: { x, y } } = chart;
      if (!left || !right || !top || !bottom || !x || !y) return;

      // 依據動態切分基準值 (xCut, yCut) 計算真正的 Canvas Pixel 座標
      let xCenter = x.getPixelForValue(xCut);
      let yCenter = y.getPixelForValue(yCut);

      // 安全卡位防止爆出畫布範圍
      xCenter = Math.max(left + 20, Math.min(right - 20, xCenter));
      yCenter = Math.max(top + 20, Math.min(bottom - 20, yCenter));

      ctx.save();

      // 1. 繪製 4 大象限柔和背景底圖
      ctx.fillStyle = 'rgba(16, 185, 129, 0.06)'; // 右上: 明星主力
      ctx.fillRect(xCenter, top, right - xCenter, yCenter - top);

      ctx.fillStyle = 'rgba(56, 189, 248, 0.06)'; // 左上: 獵鯨專家
      ctx.fillRect(left, top, xCenter - left, yCenter - top);

      ctx.fillStyle = 'rgba(239, 68, 68, 0.06)'; // 左下: 待輔導區
      ctx.fillRect(left, yCenter, xCenter - left, bottom - yCenter);

      ctx.fillStyle = 'rgba(245, 158, 11, 0.06)'; // 右下: 基層耕耘
      ctx.fillRect(xCenter, yCenter, right - xCenter, bottom - yCenter);

      // 2. 繪製十字分隔虛線 (黃金基準線)
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);

      ctx.beginPath();
      ctx.moveTo(xCenter, top);
      ctx.lineTo(xCenter, bottom);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(left, yCenter);
      ctx.lineTo(right, yCenter);
      ctx.stroke();

      // 3. 在 4 個角落標註象限說明文字
      ctx.font = 'bold 12px system-ui, sans-serif';

      // 右上角落
      ctx.fillStyle = 'rgba(52, 211, 153, 0.95)';
      ctx.fillText('🌟 明星主力 (高金額/高筆數)', right - 195, top + 22);

      // 左上角落
      ctx.fillStyle = 'rgba(56, 189, 248, 0.95)';
      ctx.fillText('🐋 獵鯨專家 (高金額/低筆數)', left + 12, top + 22);

      // 左下角落
      ctx.fillStyle = 'rgba(248, 113, 113, 0.95)';
      ctx.fillText('🌱 待輔導/新進 (低金額/低筆數)', left + 12, bottom - 14);

      // 右下角落
      ctx.fillStyle = 'rgba(251, 191, 36, 0.95)';
      ctx.fillText('🐝 基層耕耘 (低金額/高筆數)', right - 195, bottom - 14);

      // 中心基準線標註說明
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(245, 158, 11, 0.8)';
      ctx.fillText(`去年人均基準: ${xCut.toFixed(1)}筆 / NT$${yCut.toFixed(1)}M`, xCenter + 6, yCenter - 6);

      ctx.restore();
    },
    afterDatasetsDraw: (chart) => {
      const { ctx, chartArea: { left, top, right, bottom }, scales: { x, y } } = chart;
      if (!left || !right || !top || !bottom || !x || !y) return;

      const xCenter = Math.max(left + 20, Math.min(right - 20, x.getPixelForValue(xCut)));
      const yCenter = Math.max(top + 20, Math.min(bottom - 20, y.getPixelForValue(yCut)));

      const meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data) return;

      meta.data.forEach((element, idx) => {
        const pt = scatterData[idx];
        if (!pt) return;

        const ptX = element.x;
        const ptY = element.y;

        ctx.save();
        ctx.font = 'bold 11px system-ui, sans-serif';

        const labelText = `👤 ${pt.salesName} (${pt.x}筆/NT$${pt.y.toFixed(1)}M)`;
        const textWidth = ctx.measureText(labelText).width;

        let posX = ptX + 12;
        let posY = ptY + 4;
        if (posX + textWidth > right - 10) {
          posX = ptX - textWidth - 16;
        }

        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(posX - 4, posY - 12, textWidth + 8, 16, 4);
        } else {
          ctx.rect(posX - 4, posY - 12, textWidth + 8, 16);
        }
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.stroke();

        // 人名文字顏色依與黃金基準線 (xCut, yCut) 的比較判斷
        if (pt.x >= xCut && pt.y >= yCut) {
          ctx.fillStyle = '#34d399'; // 明星主力: 亮綠
        } else if (pt.x < xCut && pt.y >= yCut) {
          ctx.fillStyle = '#38bdf8'; // 獵鯨專家: 亮藍
        } else if (pt.x >= xCut && pt.y < yCut) {
          ctx.fillStyle = '#fbbf24'; // 基層耕耘: 亮黃
        } else {
          ctx.fillStyle = '#f87171'; // 待輔導區: 亮紅
        }

        ctx.fillText(labelText, posX, posY);
        ctx.restore();
      });
    }
  };

  const ctxMatrix = document.getElementById('matrix-chart')?.getContext('2d');
  if (ctxMatrix) {
    if (matrixChart) matrixChart.destroy();

    const pointColors = scatterData.map(pt => {
      if (pt.x >= xCut && pt.y >= yCut) return '#10b981'; // 明星主力: 翡翠綠
      if (pt.x < xCut && pt.y >= yCut) return '#38bdf8';  // 獵鯨專家: 天空藍
      if (pt.x >= xCut && pt.y < yCut) return '#f59e0b';  // 基層耕耘: 琥珀黃
      return '#ef4444'; // 待輔導區: 珊瑚紅
    });

    matrixChart = new Chart(ctxMatrix, {
      type: 'scatter',
      data: {
        datasets: [{
          label: `${selectedYear} 業務成員銷售動能 (筆數 vs 金額)`,
          data: scatterData,
          backgroundColor: pointColors,
          borderColor: '#ffffff',
          borderWidth: 2,
          pointRadius: 10,
          pointHoverRadius: 14
        }]
      },
      plugins: [quadrantLinesPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                const raw = context.raw;
                return ` 👤 ${raw.salesName}: ${raw.x} 筆成案, 金額 ${raw.y.toFixed(2)} M NT$`;
              }
            }
          }
        },
        scales: {
          x: { ticks: { color: '#94a3b8', precision: 0 }, title: { display: true, text: '成交案件數量 (件)', color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
          y: { ticks: { color: '#94a3b8' }, title: { display: true, text: '成交總金額 (M NT$)', color: '#94a3b8' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
        }
      }
    });
  }
}

// Kickstart
window.addEventListener('DOMContentLoaded', initDashboard);

