let currentData = { attendance: [], members: [], availableDates: [], activeDate: '', prepaidCyclesMap: {}, funBanners: {} };
let layoutDensity = 'compact'; // 'compact' or 'normal'
let cycleWarningOnly = false;

// ===== Admin auth state (D-01, D-06) =====
let adminToken = '';
let isAdmin = false;
let sortableInstances = [];

document.addEventListener('DOMContentLoaded', () => {
  // Load-bearing ordering: initAuthState() must run first, before
  // applyAdminVisibility() and before fetchAttendance().
  initAuthState();

  const dateDropdown = document.getElementById('dateSelectDropdown');

  // Event Listeners
  dateDropdown.addEventListener('change', (e) => fetchAttendance(e.target.value));
  document.getElementById('refreshBtn').addEventListener('click', () => fetchAttendance(dateDropdown.value));

  // Apply admin gating & Fetch Data
  applyAdminVisibility();
  fetchAttendance();
});

// Restore admin session from localStorage. Client-side expiry parsing here is
// a UX convenience only (avoid showing controls that would 401 on first
// click) — the server re-verifies the HMAC signature on every write.
function initAuthState() {
  const stored = localStorage.getItem('badmintonAdminToken');
  if (!stored) return;

  const expiryPart = stored.split('.')[0];
  const expiry = Number(expiryPart);
  if (!Number.isInteger(expiry) || expiry <= Date.now()) {
    localStorage.removeItem('badmintonAdminToken');
    return;
  }

  adminToken = stored;
  isAdmin = true;
}

// Attach Authorization header when logged in. Never used by the read fetch
// in fetchAttendance() or by submitAdminLogin() (this is a login attempt,
// not a gated write).
function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (adminToken) {
    headers['Authorization'] = `Bearer ${adminToken}`;
  }
  return headers;
}

// A 401 on any write means the session is no longer valid server-side —
// clear it and force back to the logged-out view rather than letting the
// write silently fail into a generic error toast.
function forceLogout(msg) {
  localStorage.removeItem('badmintonAdminToken');
  adminToken = '';
  isAdmin = false;

  document.getElementById('addMemberModal').classList.add('hidden');
  document.getElementById('renewPassModal').classList.add('hidden');
  document.getElementById('adminLoginModal').classList.add('hidden');

  applyAdminVisibility();
  renderKanban();
  renderPrepaidCyclesBoard();
  clearBatchSelection();

  showToast('請重新登入', msg || '管理者登入已過期或失效，請重新登入', 'rose');
}

// Toggle every [data-admin-only] element and swap the header auth button's
// icon/style based on admin state. Drag-and-drop reordering was removed;
// sortableInstances is now permanently an empty array, so the forEach below
// is a permanent no-op kept only to avoid touching unrelated code.
function applyAdminVisibility() {
  document.querySelectorAll('[data-admin-only]').forEach(el => {
    el.classList.toggle('hidden', !isAdmin);
  });

  const authBtn = document.getElementById('adminAuthBtn');
  if (authBtn) {
    if (isAdmin) {
      authBtn.innerHTML = '<i class="fa-solid fa-right-from-bracket text-base"></i>';
      authBtn.title = '登出管理者模式';
      authBtn.className = 'w-11 h-11 flex items-center justify-center rounded-full bg-accent text-white active:bg-accent-strong transition';
    } else {
      authBtn.innerHTML = '<i class="fa-solid fa-lock text-base"></i>';
      authBtn.title = '管理者登入';
      authBtn.className = 'w-11 h-11 flex items-center justify-center rounded-full border border-hairline text-muted active:bg-surface transition';
    }
  }

  sortableInstances.forEach(s => {
    if (s && typeof s.option === 'function') {
      s.option('disabled', !isAdmin);
    }
  });
}

// Header auth button click handler: logs out when already logged in,
// otherwise opens the login modal.
function handleAdminAuthClick() {
  if (isAdmin) {
    adminToken = '';
    isAdmin = false;
    localStorage.removeItem('badmintonAdminToken');
    applyAdminVisibility();
    renderKanban();
    renderPrepaidCyclesBoard();
    clearBatchSelection();
    showToast('已登出', '已退出管理者模式，目前為唯讀檢視', 'blue');
  } else {
    document.getElementById('adminPasswordInput').value = '';
    document.getElementById('adminLoginError').classList.add('hidden');
    document.getElementById('adminLoginModal').classList.remove('hidden');
  }
}

function closeAdminLoginModal() {
  document.getElementById('adminLoginModal').classList.add('hidden');
}

// Submits password to the login route. Deliberately uses an inline headers
// object (not authHeaders()) — this fetch is a login attempt, not a gated
// write, so it should never carry a stale/expired Authorization header.
async function submitAdminLogin() {
  const password = document.getElementById('adminPasswordInput').value;
  const errorEl = document.getElementById('adminLoginError');
  errorEl.classList.add('hidden');

  try {
    const res = await fetch('api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();

    if (data.success) {
      adminToken = data.token;
      isAdmin = true;
      localStorage.setItem('badmintonAdminToken', data.token);
      closeAdminLoginModal();
      document.getElementById('adminPasswordInput').value = '';
      applyAdminVisibility();
      renderKanban();
      renderPrepaidCyclesBoard();
      showToast('登入成功', '已切換為管理者模式', 'emerald');
    } else {
      errorEl.innerText = '登入失敗，請確認密碼';
      errorEl.classList.remove('hidden');
    }
  } catch (err) {
    errorEl.innerText = '登入失敗，請確認密碼';
    errorEl.classList.remove('hidden');
  }
}

// D-3: display-layer text simplification only — translates the ORIGINAL
// status strings (which are also what's compared against elsewhere and what
// gets written to Notion's select field) into the user-facing wording
// Gary asked for: 報名／已到／未到. The comparisons inside this function
// must stay on the original strings; only the return value (what the user
// sees) is simplified.
function statusLabel(status) {
  if (status === '已出席') return '已到';
  if (status === '未到' || status === '放鳥') return '未到';
  return '報名';
}

let isStatsLoading = false;

// Fetch Attendance and Member Data (Fast Path: Kanban first, Stats in background)
async function fetchAttendance(selectedDate = '') {
  const refreshIcon = document.getElementById('refreshIcon');
  refreshIcon.classList.add('fa-spin');

  try {
    // 方案 A: 先快速載入點名看板與人員名單 (< 1s)
    const res = await fetch(`api/attendance?scope=kanban&date=${encodeURIComponent(selectedDate)}`);
    const data = await res.json();

    if (data.success) {
      currentData.attendance = data.attendance || [];
      currentData.members = data.members || [];
      currentData.activeDate = data.activeDate || '';
      currentData.availableDates = data.availableDates || [];

      renderDateDropdown();
      renderKanban();
      updateKPIs();
      clearBatchSelection();

      // 背景非同步載入年度/月度指標榜與儲值期別履歷
      fetchStats();
    } else {
      showToast('錯誤', data.error || '無法讀取 Notion 資料', 'rose');
    }
  } catch (err) {
    showToast('連線失敗', '連線伺服器錯誤', 'rose');
  } finally {
    refreshIcon.classList.remove('fa-spin');
  }
}

async function fetchStats() {
  if (isStatsLoading) return;
  isStatsLoading = true;

  try {
    const res = await fetch('api/attendance?scope=stats');
    const data = await res.json();

    if (data.success) {
      currentData.funBanners = data.funBanners || {};
      currentData.prepaidCyclesMap = data.prepaidCyclesMap || {};
      if (data.availableDates && data.availableDates.length > currentData.availableDates.length) {
        currentData.availableDates = data.availableDates;
        renderDateDropdown();
      }
      renderFunBanners();
      renderPrepaidCyclesBoard();
    }
  } catch (err) {
    console.warn('[Badminton Stats] 背景指標載入失敗:', err);
  } finally {
    isStatsLoading = false;
  }
}

// Render Fun Champion Banners — D-2: yearly and monthly now share the same
// three-metric shape (attendanceKing/streakKing/fastestCasual), both top-2;
// D-4: month/year labels are dynamic, not hardcoded strings.
function renderFunBanners() {
  const fb = currentData.funBanners || {};
  const yearly = fb.yearly || {};
  const monthly = fb.monthly || {};

  const yearlyLabelEl = document.getElementById('yearlyGroupLabel');
  if (yearlyLabelEl) {
    yearlyLabelEl.innerText = fb.currentYear ? `🏆 年度榜 · ${fb.currentYear}` : '🏆 年度榜';
  }
  const monthlyLabelEl = document.getElementById('monthlyGroupLabel');
  if (monthlyLabelEl) {
    monthlyLabelEl.innerText = fb.currentMonthLabel ? `📆 月度榜 · ${fb.currentMonthLabel}月` : '📆 月度榜';
  }

  // Fills a champion node + optional runner-up node from a top-N array.
  // Empty array -> "尚無紀錄" + blank runner-up (never leaves "載入中..."
  // stuck, never renders "undefined"). Length 1 -> champion only, runner-up
  // blank. Length 2 -> both, runner-up is just the next line under the
  // champion with no "second place" or other text prefix — D-1.
  function renderLeaderboardCard(championEl, runnerUpEl, list, formatFn) {
    if (!championEl) return;
    const arr = Array.isArray(list) ? list : [];
    if (arr.length === 0) {
      championEl.innerText = '尚無紀錄';
      if (runnerUpEl) runnerUpEl.innerText = '';
      return;
    }
    championEl.innerHTML = formatFn(arr[0]);
    if (runnerUpEl) {
      runnerUpEl.innerHTML = arr.length >= 2 ? formatFn(arr[1]) : '';
    }
  }

  // D-2: data-driven config, one entry per card, instead of 6 near-identical
  // renderLeaderboardCard() call sites drifting apart over time. Monthly
  // formatFns reuse yearly's color tokens; card title + monthlyGroupLabel above
  // already state which month it is, so the formatFn text itself is identical
  // to yearly's (D-3: 姓名 + 數字 + 次, no repeated month/year wording).
  const cardConfigs = [
    {
      championId: 'bannerYearAttendanceKing',
      runnerUpId: 'bannerYearAttendanceKingRunnerUp',
      list: yearly.attendanceKing,
      formatFn: p => `<span class="text-warning font-bold">${p.name}</span> <span class="underline">${p.count}</span> 次`
    },
    {
      championId: 'bannerStreakKing',
      runnerUpId: 'bannerStreakKingRunnerUp',
      list: yearly.streakKing,
      formatFn: p => `<span class="text-plan-annual font-bold">${p.name}</span> <span class="underline">${p.streak}</span> 次`
    },
    {
      championId: 'bannerFastestCasual',
      runnerUpId: 'bannerFastestCasualRunnerUp',
      list: yearly.fastestCasual,
      // D-3: lastWinDate deliberately dropped from display -- keeps yearly/monthly
      // 秒殺王 formats identical and the card text terse (Gary-approved simplification).
      formatFn: p => `<span class="text-info font-bold">${p.name}</span>（<span class="underline">${p.wins}</span> 次）`
    },
    {
      championId: 'bannerMonthAttendanceKing',
      runnerUpId: 'bannerMonthAttendanceKingRunnerUp',
      list: monthly.attendanceKing,
      formatFn: p => `<span class="text-accent-strong font-bold">${p.name}</span> <span class="underline">${p.count}</span> 次`
    },
    {
      championId: 'bannerMonthStreakKing',
      runnerUpId: 'bannerMonthStreakKingRunnerUp',
      list: monthly.streakKing,
      formatFn: p => `<span class="text-plan-annual font-bold">${p.name}</span> <span class="underline">${p.streak}</span> 次`
    },
    {
      championId: 'bannerMonthFastestCasual',
      runnerUpId: 'bannerMonthFastestCasualRunnerUp',
      list: monthly.fastestCasual,
      formatFn: p => `<span class="text-info font-bold">${p.name}</span>（<span class="underline">${p.wins}</span> 次）`
    }
  ];

  cardConfigs.forEach(cfg => {
    renderLeaderboardCard(
      document.getElementById(cfg.championId),
      document.getElementById(cfg.runnerUpId),
      cfg.list,
      cfg.formatFn
    );
  });
}

// Render Available Dates Dropdown
function renderDateDropdown() {
  const dropdown = document.getElementById('dateSelectDropdown');
  const activeDate = currentData.activeDate;

  let html = `<option value="all" ${activeDate === 'all' ? 'selected' : ''}>📅 全部歷史日期 (總覽)</option>`;

  currentData.availableDates.forEach(item => {
    const isSelected = item.date === activeDate ? 'selected' : '';
    html += `<option value="${item.date}" ${isSelected}>📅 ${item.date} (${item.count}人報名)</option>`;
  });

  dropdown.innerHTML = html;
}

// Update Top KPI Counters
function updateKPIs() {
  const list = currentData.attendance;
  const members = currentData.members;

  const total = list.length;
  const attended = list.filter(i => i.status === '已出席').length;
  const noshow = list.filter(i => i.status === '未到').length;

  document.getElementById('statTotal').innerText = total;
  document.getElementById('statAttended').innerText = attended;
  document.getElementById('statNoshow').innerText = noshow;

  const lowCountMembers = members.filter(m => (m.planType === '儲值' || m.planType === '預繳10次') && m.remainingCount <= 2).length;
  document.getElementById('statWarning').innerText = lowCountMembers;

  const bar = document.getElementById('attendanceProgressBar');
  const text = document.getElementById('attendanceProgressText');
  if (bar && text) {
    const pct = total > 0 ? Math.round((attended / total) * 100) : 0;
    bar.style.width = `${pct}%`;
    text.innerText = `${pct}% (${attended}/${total}人已到)`;
  }
}

// 續卡/預告卡片共用門檻：當期打滿 8 次視為「快滿了」。
// 刻意獨立命名（不是隨便寫死的數字）：既有的 isWarning 續卡警示徽章、
// 「購新一期」按鈕防呆、下一期預告卡片，三處都必須吃同一個常數，
// 避免日後改動時三處門檻漂移成不同數字。
const RENEW_THRESHOLD = 8;

// 純唯讀衍生判斷：本函式不寫入任何資料、不影響任何一筆出席記錄算進哪一期；
// 期別歸屬永遠由後端 calculatePrepaidCycles() 決定，這裡只是拿後端已經算好的
// allCycles/activeCount/remainingCount 做顯示層的「要不要多畫一張預告卡」判斷。
//
// 顯示條件（2026-09-12 Gary 核准修正版，不看 isCompleted）：
//   1. activeCycle 存在（該會員至少有一期資料）
//   2. activeCount >= RENEW_THRESHOLD（不論當期是否已完卡；完卡的 activeCount
//      恆為 10，本來就滿足 >= 8，不需要也不得另外特判 isCompleted）
//   3. remainingCount 是有效數字，且 >= (10 - activeCount) + 10——
//      語意：扣掉打完當期還要用掉的堂數之後，餘額還能再撐滿一整期
//   4. allCycles 裡不存在 cycleNum === activeCycle.cycleNum + 1 的真實期別，
//      避免跟真實資料重疊/打架，一旦真的打出下一期就該由真實卡片取代預告卡
//   5. targetYear 為 'all' 或等於 activeCycle.year，避免切到別的年份還看到當期預告
function computeNextCyclePreview({ allCycles, activeCycle, activeCount, remainingCount, targetYear }) {
  if (!activeCycle) return null;
  if (!(activeCount >= RENEW_THRESHOLD)) return null;
  if (!Number.isFinite(remainingCount) || !(remainingCount >= (10 - activeCount) + 10)) return null;
  if ((allCycles || []).some(c => c.cycleNum === activeCycle.cycleNum + 1)) return null;
  if (!(targetYear === 'all' || targetYear === activeCycle.year)) return null;
  return { cycleNum: activeCycle.cycleNum + 1 };
}
window.computeNextCyclePreview = computeNextCyclePreview;

// RENDER PREPAID 10-SESSION CYCLES TRACKER BOARD (精準展示雙方對帳出席時間)
function renderPrepaidCyclesBoard() {
  const container = document.getElementById('cyclesGridContainer');
  if (!container) return;

  const yearSelect = document.getElementById('cycleYearSelect');
  const searchInput = document.getElementById('cycleMemberSearch');

  const targetYear = yearSelect ? yearSelect.value : '2026';
  const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

  container.innerHTML = '';

  const cycleMap = currentData.prepaidCyclesMap || {};
  let memberNames = Object.keys(cycleMap);

  if (cycleWarningOnly) {
    memberNames = memberNames.filter(name => {
      const m = (currentData.members || []).find(it => it.name === name);
      const cycles = cycleMap[name] || [];
      const activeCycle = cycles.find(c => !c.isCompleted) || (cycles.length > 0 ? cycles[cycles.length - 1] : null);
      const activeCount = activeCycle ? activeCycle.items.length : 0;

      const isRemainingLow = m && Number.isFinite(m.remainingCount) && m.remainingCount <= 2;
      const isCycleNearEnd = activeCount >= RENEW_THRESHOLD;

      return isRemainingLow || isCycleNearEnd;
    });
  }

  if (keyword) {
    memberNames = memberNames.filter(n => n.toLowerCase().includes(keyword));
  }

  // 依據總出席次數 (包含所有期別的總打球次數 & 2026年度次數) 由高到低排序
  memberNames.sort((a, b) => {
    const cyclesA = cycleMap[a] || [];
    const cyclesB = cycleMap[b] || [];
    const totalSessionsA = cyclesA.reduce((sum, c) => sum + (c.items ? c.items.length : 0), 0);
    const totalSessionsB = cyclesB.reduce((sum, c) => sum + (c.items ? c.items.length : 0), 0);
    
    if (totalSessionsB !== totalSessionsA) return totalSessionsB - totalSessionsA;
    
    const infoA = (currentData.members || []).find(m => m.name === a) || {};
    const infoB = (currentData.members || []).find(m => m.name === b) || {};
    const countA = infoA.year2026Count || 0;
    const countB = infoB.year2026Count || 0;
    if (countB !== countA) return countB - countA;
    
    return a.localeCompare(b, 'zh-Hant');
  });

  if (memberNames.length === 0) {
    if (isStatsLoading) {
      container.innerHTML = `<div class="col-span-full py-10 text-center text-muted font-semibold text-base"><i class="fa-solid fa-spinner fa-spin mr-2"></i>履歷資料載入中...</div>`;
    } else {
      container.innerHTML = `<div class="col-span-full py-10 text-center text-muted font-semibold text-base">尚無符合條件的儲值球員期別履歷</div>`;
    }
    return;
  }

  memberNames.forEach(name => {
    const allCycles = cycleMap[name] || [];
    const mInfo = currentData.members.find(m => m.name === name);

    const filteredCycles = allCycles.filter(c => {
      if (targetYear === 'all') return true;
      return c.year === targetYear || (c.startDate && c.startDate.startsWith(targetYear));
    });

    const completedInYear = filteredCycles.filter(c => c.isCompleted).length;
    const activeCycle = allCycles.find(c => !c.isCompleted) || (allCycles.length > 0 ? allCycles[allCycles.length - 1] : null);
    const activeCount = activeCycle ? activeCycle.items.length : 0;
    const remainingCount = mInfo ? mInfo.remainingCount : undefined;
    const isRemainingZero = Number.isFinite(remainingCount) && remainingCount <= 0;
    const isRemainingLow = Number.isFinite(remainingCount) && remainingCount <= 2;

    // atRenewThreshold：當期滿8次 或 儲值次數已用盡(剩<=0次)，皆允許管理員點擊「購新一期」續卡
    const atRenewThreshold = activeCount >= RENEW_THRESHOLD || isRemainingZero;
    // isWarning：當期進行中且（滿8次 或 堂數告急<=2次）亮起警示色
    const isWarning = (activeCount >= RENEW_THRESHOLD || isRemainingLow) && activeCycle && !activeCycle.isCompleted;

    const totalSessions = allCycles.reduce((sum, c) => sum + (c.items ? c.items.length : 0), 0);
    const yearCount = mInfo ? mInfo.year2026Count || 0 : 0;

    // Dynamic warning border color (8次: info/blue, 9次: accent/green, 10次: danger/red)
    // Set via inline style (not a Tailwind class) so it reliably overrides the
    // default .card hairline border regardless of stylesheet load order.
    let warningBorderColor = '';
    let warningDotClass = '';
    if (isWarning) {
      if (activeCount >= 10 || isRemainingZero) {
        warningBorderColor = '#c23b3b';
        warningDotClass = 'bg-danger';
      } else if (activeCount === 9) {
        warningBorderColor = '#1f7a54';
        warningDotClass = 'bg-accent';
      } else {
        warningBorderColor = '#2563a8';
        warningDotClass = 'bg-info';
      }
    }

    if (!warningBorderColor && isRemainingLow) {
      warningBorderColor = remainingCount <= 0 ? '#c23b3b' : '#d97706';
    }

    const card = document.createElement('div');
    card.className = 'card rounded-xl p-4 space-y-3 relative transition-all duration-200';
    if (warningBorderColor) {
      card.style.borderColor = warningBorderColor;
      card.style.borderWidth = '1.5px';
    }

    const memberPageId = mInfo ? mInfo.memberPageId : '';

    let remainingBadge = '';
    if (Number.isFinite(remainingCount)) {
      if (remainingCount <= 0) {
        remainingBadge = `<span class="bg-danger-soft text-danger text-xs font-bold px-2 py-0.5 rounded-full" title="儲值剩餘堂數">剩 0 次</span>`;
      } else if (remainingCount <= 2) {
        remainingBadge = `<span class="bg-warning-soft text-warning text-xs font-bold px-2 py-0.5 rounded-full" title="儲值剩餘堂數">剩 ${remainingCount} 次</span>`;
      } else {
        remainingBadge = `<span class="bg-surface text-muted text-xs font-medium px-2 py-0.5 rounded-full" title="儲值剩餘堂數">剩 ${remainingCount} 次</span>`;
      }
    }

    const warningBadge = isWarning
      ? `<span class="${warningDotClass} w-3 h-3 rounded-[3px] shrink-0" title="續卡提醒：當期已打 ${activeCount}/10 次" aria-label="續卡提醒：當期已打 ${activeCount}/10 次"></span>`
      : '';

    // D-03: 沒查到 mInfo（會員在 Members-DB 沒有頁面）一律視為「尚未確認儲值」，
    // 沒有第三種空白狀態；只看「最後儲值日期」是否有值，不做逐次出席日期比對。
    const hasConfirmedPrepay = !!(mInfo && mInfo.hasConfirmedPrepay);
    const prepayBadge = hasConfirmedPrepay
      ? `<span class="bg-accent w-3 h-3 rounded-full shrink-0" title="已確認儲值" aria-label="已確認儲值"></span>`
      : `<span class="bg-warning w-3 h-3 rounded-full shrink-0" title="尚未確認儲值" aria-label="尚未確認儲值"></span>`;

    let renewButtonHtml = '';
    if (isAdmin && atRenewThreshold) {
      renewButtonHtml = `<button onclick="openRenewPassModal('${memberPageId}', '${name}')" title="購買新一期 / 續卡加 10 次 (記錄金額)" class="h-9 px-3 rounded-lg text-xs font-semibold text-warning bg-warning-soft active:bg-warning active:text-white transition flex items-center gap-1 shrink-0">
          <i class="fa-solid fa-plus-circle"></i> 購新一期
        </button>`;
    } else if (isAdmin && !atRenewThreshold) {
      // disabled 屬性 + 無 onclick 雙重防呆：只靠 CSS pointer-events:none 擋不住鍵盤觸發。
      renewButtonHtml = `<button disabled title="當期進度未達 8 次且尚有剩餘堂數（目前進度 ${activeCount}/10，剩餘 ${remainingCount ?? 0} 次）" class="h-9 px-3 rounded-lg text-xs font-semibold text-muted bg-surface cursor-not-allowed transition flex items-center gap-1 shrink-0">
          <i class="fa-solid fa-plus-circle"></i> 購新一期
        </button>`;
    }

    let progressNote = '';
    if (activeCount >= 10) {
      progressNote = ' <span class="text-danger font-bold text-xs">(已滿10次)</span>';
    } else if (activeCount >= 8) {
      progressNote = ` <span class="text-warning font-bold text-xs">(本期剩${10 - activeCount}次)</span>`;
    }

    // Header
    card.innerHTML = `
      <div class="flex items-center justify-between gap-2 border-b border-hairline pb-2.5">
        <div class="flex items-center gap-2 min-w-0 flex-wrap">
          <span class="w-2.5 h-2.5 rounded-full bg-plan-prepaid shrink-0"></span>
          <h3 class="font-semibold text-ink text-base truncate active:text-accent-strong cursor-pointer" onclick="openMemberModal('${name}')">${name}</h3>
          ${remainingBadge}
          ${warningBadge}
          ${prepayBadge}
        </div>
        <span class="bg-surface text-muted text-xs font-semibold px-2 py-1 rounded-full shrink-0">
          ${targetYear === 'all' ? '全部' : targetYear + '年'} 完卡 ${completedInYear} 期
        </span>
      </div>
      <div class="flex items-center justify-between gap-2 text-sm">
        <span class="text-muted">當期進度 <strong class="${isWarning ? 'text-warning' : 'text-accent-strong'} font-bold">${activeCount}/10</strong>${progressNote} ・ 總計 <strong class="text-ink font-bold">${totalSessions}</strong> 次</span>
        ${renewButtonHtml}
      </div>
    `;

    // Cycles Timeline Container
    const cyclesListDiv = document.createElement('div');
    cyclesListDiv.className = 'space-y-2.5 max-h-80 overflow-y-auto pr-1 text-sm';

    if (filteredCycles.length === 0) {
      cyclesListDiv.innerHTML = `<p class="text-muted text-center py-3">該年份無儲值期別紀錄</p>`;
    } else {
      [...filteredCycles].reverse().forEach(c => {
        const cycleItem = document.createElement('div');
        cycleItem.className = `p-3 rounded-lg border ${c.isCompleted ? 'bg-surface border-hairline' : 'bg-warning-soft border-warning/40'
          }`;

        const dateRangeStr = c.isCompleted
          ? `<span class="text-accent-strong font-semibold">${c.startDate}</span> &rarr; <span class="text-accent-strong font-semibold">${c.endDate}</span> <span class="text-muted font-normal">(歷時 ${c.totalDays} 天)</span>`
          : `<span class="text-warning font-semibold">${c.startDate} 開始</span> &rarr; <span class="text-muted">進行中 (已打 ${c.items.length}/10 次)</span>`;

        // 10 Detailed Dates Accordion/List for verification
        let dateItemsHtml = '';
        c.items.forEach(it => {
          dateItemsHtml += `
            <div class="flex items-center justify-between text-sm bg-white px-2.5 py-1.5 rounded-md border border-hairline">
              <span class="font-medium text-body">第 ${it.sessionNo} 次打球</span>
              <span class="font-semibold text-accent-strong">${it.date}</span>
            </div>
          `;
        });

        const collapseId = `cycleDetail_${name}_${c.cycleNum}`;

        cycleItem.innerHTML = `
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <span class="font-semibold ${c.isCompleted ? 'text-ink' : 'text-warning'}">
              <i class="fa-solid fa-bookmark mr-1"></i> 第 ${c.cycleNum} 期 ${c.isCompleted ? '已完卡' : '進行中'}
            </span>
            <button onclick="toggleCycleDetail('${collapseId}')" class="h-8 px-2 text-xs font-semibold text-accent-strong active:underline">
              <i class="fa-solid fa-calendar-check mr-1"></i> 對帳明細
            </button>
          </div>

          <div class="text-sm mb-2">
            ${dateRangeStr}
          </div>

          <!-- Detailed 10 Attendance Dates Grid -->
          <div id="${collapseId}" class="mt-2 pt-2 border-t border-hairline grid grid-cols-2 gap-1.5 hidden">
            ${dateItemsHtml}
          </div>
        `;

        cyclesListDiv.appendChild(cycleItem);
      });
    }

    const preview = computeNextCyclePreview({
      allCycles,
      activeCycle,
      activeCount,
      remainingCount: mInfo ? mInfo.remainingCount : undefined,
      targetYear
    });
    if (preview) {
      const previewItem = document.createElement('div');
      previewItem.className = 'p-3 rounded-lg border border-dashed border-hairline bg-white';
      previewItem.setAttribute('data-preview-cycle', String(preview.cycleNum));
      previewItem.innerHTML = `
        <div class="flex items-center justify-between gap-2 mb-1.5">
          <span class="font-semibold text-muted">
            <i class="fa-solid fa-hourglass-half mr-1"></i> 第 ${preview.cycleNum} 期（已儲值，等待開打）
          </span>
        </div>
        <div class="text-sm mb-1 text-muted">0/10</div>
        <p class="text-xs text-muted">餘額已足夠支付下一整期，出席累積至第 ${activeCycle.cycleNum * 10 + 1} 次後會自動轉為正式期別</p>
      `;
      cyclesListDiv.insertBefore(previewItem, cyclesListDiv.firstChild);
    }

    card.appendChild(cyclesListDiv);
    container.appendChild(card);
  });
}

// Toggle Cycle Attendance Dates Accordion
function toggleCycleDetail(elementId) {
  const el = document.getElementById(elementId);
  if (el) {
    el.classList.toggle('hidden');
  }
}

// CYCLE LEGEND MODAL LOGIC (色塊說明)
function openCycleLegendModal() {
  document.getElementById('cycleLegendModal').classList.remove('hidden');
}

function closeCycleLegendModal() {
  document.getElementById('cycleLegendModal').classList.add('hidden');
}

// ADD NEW MEMBER MODAL LOGIC (新增儲值人員)
function openAddMemberModal(defaultPlan = '儲值') {
  document.getElementById('addMemberNameInput').value = '';
  document.getElementById('addMemberCountInput').value = '10';
  document.getElementById('addMemberAmountInput').value = '1500';
  document.getElementById('addMemberModal').classList.remove('hidden');
}

function closeAddMemberModal() {
  document.getElementById('addMemberModal').classList.add('hidden');
}

async function submitAddMember() {
  const name = document.getElementById('addMemberNameInput').value.trim();
  const count = document.getElementById('addMemberCountInput').value;
  const amount = document.getElementById('addMemberAmountInput').value;

  if (!name) return showToast('提示', '請輸入儲值球員姓名', 'rose');

  showToast('建立中...', `正在為 ${name} 建立儲值資料...`, 'blue');

  try {
    const res = await fetch('api/members/add', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name, planType: '儲值', count, amount })
    });
    if (res.status === 401) { forceLogout(); return; }
    const data = await res.json();

    if (data.success) {
      showToast('建立成功！', `已新增儲值球員【${name}】至 Notion`, 'emerald');
      closeAddMemberModal();
      const activeDate = document.getElementById('dateSelectDropdown').value;
      fetchAttendance(activeDate);
    } else {
      showToast('建立失敗', data.error || 'Notion 建立失敗', 'rose');
    }
  } catch (err) {
    showToast('連線錯誤', '新增儲值球員失敗', 'rose');
  }
}

// RENEW PASS / BUY NEW CYCLE MODAL LOGIC (記錄金額並充值)
function openRenewPassModal(memberPageId, memberName) {
  if (!memberPageId) return showToast('提示', `無法取得 ${memberName} 的會員 ID（該球員尚未在會員表建檔，請先點擊右上角【新增會員】）`, 'rose');

  const mInfo = (currentData.members || []).find(m => m.name === memberName);
  const cycles = (currentData.prepaidCyclesMap || {})[memberName] || [];
  const activeCycle = cycles.find(c => !c.isCompleted) || (cycles.length > 0 ? cycles[cycles.length - 1] : null);
  const activeCount = activeCycle && !activeCycle.isCompleted ? activeCycle.items.length : 0;
  const currentCount = mInfo && Number.isFinite(mInfo.remainingCount) ? mInfo.remainingCount : 0;

  // 計算新購一期實得堂數：
  // 1. 若原本額度已用盡(剩0次/負數)且新期已開打(activeCount > 0)，購買10次自動扣抵當期已打堂數 (10 - activeCount)
  // 2. 若原本尚有剩餘次數(currentCount > 0)，購買10次累加 (currentCount + 10)
  // 3. 若原本剩0次且新期未開打，購買10次即剩餘 10 次
  let defaultCount = 10;
  const noteEl = document.getElementById('renewDeductNote');
  if (currentCount <= 0 && activeCount > 0) {
    defaultCount = Math.max(0, 10 - activeCount);
    if (noteEl) {
      noteEl.innerText = `💡 當期已出席 ${activeCount} 次（未扣點），新購 10 次扣除後剩餘 ${defaultCount} 次`;
      noteEl.classList.remove('hidden');
    }
  } else if (currentCount > 0) {
    defaultCount = currentCount + 10;
    if (noteEl) {
      noteEl.innerText = `💡 目前尚有 ${currentCount} 次，新購 10 次累積後剩餘 ${defaultCount} 次`;
      noteEl.classList.remove('hidden');
    }
  } else {
    defaultCount = 10;
    if (noteEl) {
      noteEl.innerText = `💡 新購 10 次，充值後剩餘 10 次`;
      noteEl.classList.remove('hidden');
    }
  }

  document.getElementById('renewMemberPageIdInput').value = memberPageId;
  document.getElementById('renewModalMemberName').innerText = `球員: ${memberName}`;
  document.getElementById('renewCountInput').value = String(defaultCount);
  document.getElementById('renewAmountInput').value = '20000';
  document.getElementById('renewPassModal').classList.remove('hidden');
}

function closeRenewPassModal() {
  document.getElementById('renewPassModal').classList.add('hidden');
}

async function submitRenewPass() {
  const memberPageId = document.getElementById('renewMemberPageIdInput').value;
  const targetCount = parseInt(document.getElementById('renewCountInput').value, 10);
  const amount = parseInt(document.getElementById('renewAmountInput').value, 10) || 0;

  if (!memberPageId) return showToast('提示', '無效的會員 ID', 'rose');
  if (isNaN(targetCount) || targetCount < 0) return showToast('提示', '請輸入有效的次數', 'rose');

  showToast('續卡處理中...', `正在記錄繳費 $${amount} 並更新剩餘 ${targetCount} 次...`, 'blue');

  try {
    const res = await fetch('api/members/renew', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ memberPageId, targetCount, addCount: 10, amount })
    });
    if (res.status === 401) { forceLogout(); return; }
    const data = await res.json();

    if (data.success) {
      showToast('購買/續卡成功！', `成功記錄繳費 $${amount}，現剩餘 ${data.newCount} 次`, 'emerald');
      closeRenewPassModal();
      const activeDate = document.getElementById('dateSelectDropdown').value;
      fetchAttendance(activeDate);
    } else {
      showToast('續卡失敗', data.error || 'Notion 同步失敗', 'rose');
    }
  } catch (err) {
    showToast('連線錯誤', '續卡失敗', 'rose');
  }
}

// Layout Density Switch
function setLayoutDensity(density) {
  layoutDensity = density;
  const cBtn = document.getElementById('densityCompactBtn');
  const nBtn = document.getElementById('densityNormalBtn');

  if (density === 'compact') {
    cBtn.className = 'density-btn active h-11 px-3 rounded-lg text-sm font-semibold';
    nBtn.className = 'density-btn h-11 px-3 rounded-lg text-sm font-semibold';
  } else {
    nBtn.className = 'density-btn active h-11 px-3 rounded-lg text-sm font-semibold';
    cBtn.className = 'density-btn h-11 px-3 rounded-lg text-sm font-semibold';
  }
  renderKanban();
}

// Render Kanban Cards
function renderKanban() {
  const pendingCol = document.getElementById('colPending');
  const attendedCol = document.getElementById('colAttended');
  const noshowCol = document.getElementById('colNoshow');

  pendingCol.innerHTML = '';
  attendedCol.innerHTML = '';
  noshowCol.innerHTML = '';

  let countPending = 0, countAttended = 0, countNoshow = 0;

  currentData.attendance.forEach(item => {
    const cardHtml = createCardElement(item);

    if (item.status === '已出席') {
      attendedCol.appendChild(cardHtml);
      countAttended++;
    } else if (item.status === '未到' || item.status === '放鳥') {
      noshowCol.appendChild(cardHtml);
      countNoshow++;
    } else {
      pendingCol.appendChild(cardHtml);
      countPending++;
    }
  });

  document.getElementById('countPending').innerText = countPending;
  document.getElementById('countAttended').innerText = countAttended;
  document.getElementById('countNoshow').innerText = countNoshow;

  const searchInput = document.getElementById('kanbanQuickSearch');
  if (searchInput && searchInput.value) {
    filterKanbanCards(searchInput.value);
  }
}

// Helper: Get Plan Type Color Dot & Left Bar Color (kept hue identity: 年繳=purple, 月繳=green, 儲值=amber)
function getPlanStyle(planType) {
  if (planType === '年繳') {
    return {
      dot: `<span style="background-color: #6d3fa0; width: 10px; height: 10px; min-width: 10px; border-radius: 9999px; display: inline-block;" title="年繳"></span>`,
      barColor: '#6d3fa0'
    };
  }
  if (planType === '月繳') {
    return {
      dot: `<span style="background-color: #1f7a54; width: 10px; height: 10px; min-width: 10px; border-radius: 9999px; display: inline-block;" title="月繳"></span>`,
      barColor: '#1f7a54'
    };
  }
  // 儲值 (Prepaid)
  return {
    dot: `<span style="background-color: #a3620c; width: 10px; height: 10px; min-width: 10px; border-radius: 9999px; display: inline-block;" title="儲值"></span>`,
    barColor: '#a3620c'
  };
}

// Create Kanban Card DOM Element
function createCardElement(item) {
  const card = document.createElement('div');
  const isCompact = layoutDensity === 'compact';
  const planStyle = getPlanStyle(item.planType);

  card.className = `kanban-card card rounded-lg transition-all duration-150 relative cursor-grab active:cursor-grabbing ${isCompact ? 'py-2 px-2.5' : 'py-2.5 px-3'
    }`;

  card.style.borderLeft = `4px solid ${planStyle.barColor}`;
  if (item.isBlacklisted) {
    card.style.borderColor = '#c23b3b';
    card.style.backgroundColor = 'var(--danger-soft)';
  }

  card.dataset.id = item.id;
  card.dataset.name = item.name;
  card.dataset.memberpageid = item.memberPageId || '';
  card.dataset.status = item.status;

  const blacklistBadge = item.isBlacklisted
    ? `<span class="bg-danger text-white text-sm font-bold px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap">近1月未到${item.noshowCount}次</span>`
    : '';

  let actionButtons = '';
  if (isAdmin && (item.status === '已報名' || item.status === '報名成功')) {
    actionButtons = `
      <button onclick="updateStatus('${item.id}', '已出席', '${item.memberPageId}', '${item.status}')" title="點名出席" class="h-9 px-2.5 rounded-md text-sm font-semibold text-accent-strong bg-success-soft active:bg-accent active:text-white transition">
        <i class="fa-solid fa-check"></i> 已到
      </button>
      <button onclick="updateStatus('${item.id}', '未到', '${item.memberPageId}', '${item.status}')" title="標記未到" class="h-9 px-2.5 rounded-md text-sm font-semibold text-danger bg-danger-soft active:bg-danger active:text-white transition">
        <i class="fa-solid fa-xmark"></i> 未到
      </button>
    `;
  } else if (isAdmin && item.status === '已出席') {
    actionButtons = `
      <button onclick="updateStatus('${item.id}', '已報名', '${item.memberPageId}', '${item.status}')" title="重設狀態" class="h-9 px-2.5 rounded-md text-sm font-semibold text-muted bg-surface active:bg-surface-strong transition">
        <i class="fa-solid fa-rotate-left"></i> 重設
      </button>
      <button onclick="updateStatus('${item.id}', '未到', '${item.memberPageId}', '${item.status}')" title="改為未到" class="h-9 px-2.5 rounded-md text-sm font-semibold text-danger bg-danger-soft active:bg-danger active:text-white transition">
        改未到
      </button>
    `;
  } else if (isAdmin && (item.status === '未到' || item.status === '放鳥')) {
    actionButtons = `
      <button onclick="updateStatus('${item.id}', '已出席', '${item.memberPageId}', '${item.status}')" title="改為出席" class="h-9 px-2.5 rounded-md text-sm font-semibold text-accent-strong bg-success-soft active:bg-accent active:text-white transition">
        改已到
      </button>
      <button onclick="updateStatus('${item.id}', '已報名', '${item.memberPageId}', '${item.status}')" title="重設狀態" class="h-9 px-2.5 rounded-md text-sm font-semibold text-muted bg-surface active:bg-surface-strong transition">
        <i class="fa-solid fa-rotate-left"></i> 重設
      </button>
    `;
  }

  const checkboxHtml = isAdmin
    ? `<label class="w-11 h-11 -m-2.5 flex items-center justify-center shrink-0 cursor-pointer">
          <input type="checkbox" onchange="handleCardCheckChange()" class="card-checkbox w-5 h-5 rounded border-hairline cursor-pointer" data-id="${item.id}" data-memberpageid="${item.memberPageId || ''}" data-status="${item.status}">
        </label>`
    : '';

  card.innerHTML = `
    <div class="flex items-center justify-between gap-1.5">
      <div class="flex items-center gap-2 overflow-hidden min-w-0">
        ${checkboxHtml}
        ${planStyle.dot}
        <span onclick="openMemberModal('${item.name}')" class="font-semibold text-ink text-base truncate flex-1 min-w-0 active:text-accent-strong cursor-pointer">${item.name}</span>
        ${blacklistBadge}
      </div>
      <div class="flex items-center gap-1 shrink-0">
        ${actionButtons}
      </div>
    </div>
  `;

  return card;
}

// INSTANT PLAYER CARD FILTER
function filterKanbanCards(query) {
  const cards = document.querySelectorAll('.kanban-card');
  const q = query.trim().toLowerCase();

  cards.forEach(card => {
    const name = card.dataset.name.toLowerCase();
    if (!q || name.includes(q)) {
      card.classList.remove('hidden');
      if (q) {
        card.classList.add('search-hit');
      } else {
        card.classList.remove('search-hit');
      }
    } else {
      card.classList.add('hidden');
      card.classList.remove('search-hit');
    }
  });
}

// ONE-TAP ALL PRESENT SHORTCUT
async function quickAllAttend() {
  const pendingCheckboxes = document.querySelectorAll('#colPending .card-checkbox');
  if (pendingCheckboxes.length === 0) {
    return showToast('提示', '目前沒有待出席的球員', 'blue');
  }

  const items = Array.from(pendingCheckboxes).map(cb => ({
    pageId: cb.dataset.id,
    memberPageId: cb.dataset.memberpageid,
    currentStatus: cb.dataset.status
  }));

  showToast('一鍵全到處理中...', `正在將 ${items.length} 位報名球員一鍵標記【已到】`, 'blue');

  try {
    const res = await fetch('api/attendance/batch-update', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ items, status: '已出席' })
    });
    if (res.status === 401) { forceLogout(); return; }
    const data = await res.json();

    if (data.success) {
      showToast('一鍵點名完成！', `全場 ${data.updatedCount} 位球員成功標記【已到】`, 'emerald');
      const activeDate = document.getElementById('dateSelectDropdown').value;
      fetchAttendance(activeDate);
    } else {
      showToast('點名失敗', data.error || 'Notion 同步失敗', 'rose');
    }
  } catch (err) {
    showToast('連線錯誤', '一鍵點名失敗', 'rose');
  }
}

// BATCH SELECTION LOGIC

let isAllPendingSelected = false;
function toggleSelectAllPending() {
  const pendingCheckboxes = document.querySelectorAll('#colPending .card-checkbox');
  isAllPendingSelected = !isAllPendingSelected;

  pendingCheckboxes.forEach(cb => {
    cb.checked = isAllPendingSelected;
  });

  handleCardCheckChange();
}

function handleCardCheckChange() {
  const checkedBoxes = document.querySelectorAll('.card-checkbox:checked');
  const floatingBar = document.getElementById('floatingBatchBar');
  const countEl = document.getElementById('batchSelectedCount');

  if (checkedBoxes.length > 0) {
    countEl.innerText = checkedBoxes.length;
    floatingBar.classList.remove('hidden');
  } else {
    floatingBar.classList.add('hidden');
    isAllPendingSelected = false;
  }
}

function clearBatchSelection() {
  const allBoxes = document.querySelectorAll('.card-checkbox');
  allBoxes.forEach(cb => cb.checked = false);
  const floatingBar = document.getElementById('floatingBatchBar');
  if (floatingBar) floatingBar.classList.add('hidden');
  isAllPendingSelected = false;
}

async function executeBatchAction(targetStatus) {
  const checkedBoxes = document.querySelectorAll('.card-checkbox:checked');
  if (checkedBoxes.length === 0) return;

  const items = Array.from(checkedBoxes).map(cb => ({
    pageId: cb.dataset.id,
    memberPageId: cb.dataset.memberpageid,
    currentStatus: cb.dataset.status
  }));

  showToast('批次處理中...', `正在為 ${items.length} 位球員點名標記【${targetStatus}】`, 'blue');

  try {
    const res = await fetch('api/attendance/batch-update', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ items, status: targetStatus })
    });
    if (res.status === 401) { forceLogout(); return; }
    const data = await res.json();

    if (data.success) {
      showToast('批次點名成功！', `成功將 ${data.updatedCount} 位球員標記為【${targetStatus}】`, 'emerald');
      const activeDate = document.getElementById('dateSelectDropdown').value;
      fetchAttendance(activeDate);
    } else {
      showToast('批次處理失敗', data.error || 'Notion 同步失敗', 'rose');
    }
  } catch (err) {
    showToast('連線錯誤', '批次更新失敗', 'rose');
  }
}

// Single Update Status via API
async function updateStatus(pageId, status, memberPageId, currentStatus) {
  try {
    const res = await fetch('api/attendance/update', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ pageId, status, memberPageId, currentStatus })
    });
    if (res.status === 401) { forceLogout(); return; }
    const data = await res.json();

    if (data.success) {
      let msg = `出席狀態已更新：${statusLabel(status)}`;
      if (status === '已出席' && data.newCount !== null) {
        msg += `，儲值額度剩餘：${data.newCount} 次`;
      }
      showToast('出席情況寫入成功', msg, status === '已出席' ? 'emerald' : status === '未到' ? 'rose' : 'blue');
      const activeDate = document.getElementById('dateSelectDropdown').value;
      fetchAttendance(activeDate);
    } else {
      showToast('更新失敗', data.error || 'Notion 同步失敗', 'rose');
    }
  } catch (err) {
    showToast('連線錯誤', '更新失敗', 'rose');
  }
}

// Member Detail & Attendance History Modal
function openMemberModal(memberName) {
  const mInfo = currentData.members.find(m => m.name === memberName);
  const modal = document.getElementById('memberDetailModal');
  const nameEl = document.getElementById('modalMemberName');
  const daysEl = document.getElementById('modalAttendedDays');
  const countEl = document.getElementById('modalRemainingCount');
  const listEl = document.getElementById('modalHistoryList');
  const renewBtn = document.getElementById('modalRenewBtn');

  const pType = mInfo ? mInfo.planType : '儲值';

  nameEl.innerText = memberName;
  daysEl.innerText = `${mInfo ? mInfo.year2026Count || 0 : 0} 次`;

  if (pType === '儲值' || pType === '預繳10次') {
    countEl.innerText = `${mInfo ? mInfo.remainingCount : 0} 次`;
    if (isAdmin) {
      renewBtn.classList.remove('hidden');
      if (mInfo && mInfo.memberPageId) {
        renewBtn.onclick = () => {
          openRenewPassModal(mInfo.memberPageId, memberName);
          closeMemberModal();
        };
      }
    } else {
      renewBtn.classList.add('hidden');
    }
  } else {
    countEl.innerText = '- (免計次)';
    renewBtn.classList.add('hidden');
  }

  // Render History Timeline
  listEl.innerHTML = '';
  if (!mInfo || !mInfo.history || mInfo.history.length === 0) {
    listEl.innerHTML = `<div class="text-muted text-center py-4">無歷史打球紀錄</div>`;
  } else {
    mInfo.history.forEach(h => {
      const item = document.createElement('div');
      item.className = 'flex items-center justify-between p-2.5 rounded-lg bg-surface';

      let badge = '';
      if (h.status === '已出席') {
        badge = `<span class="bg-success-soft text-accent-strong px-2 py-1 rounded text-xs font-semibold"><i class="fa-solid fa-circle-check mr-1"></i>${statusLabel(h.status)}</span>`;
      } else if (h.status === '未到' || h.status === '放鳥') {
        badge = `<span class="bg-danger-soft text-danger px-2 py-1 rounded text-xs font-semibold"><i class="fa-solid fa-circle-xmark mr-1"></i>${statusLabel(h.status)}</span>`;
      } else {
        badge = `<span class="bg-info-soft text-info px-2 py-1 rounded text-xs font-semibold">${statusLabel(h.status)}</span>`;
      }

      item.innerHTML = `
        <span class="font-medium text-ink">${h.date}</span>
        ${badge}
      `;
      listEl.appendChild(item);
    });
  }

  modal.classList.remove('hidden');
}

function closeMemberModal() {
  document.getElementById('memberDetailModal').classList.add('hidden');
}

// Tab Switching
function switchTab(tab) {
  const kanbanSec = document.getElementById('tabKanban');
  const cyclesSec = document.getElementById('tabCycles');

  const kanbanBtn = document.getElementById('tabKanbanBtn');
  const cyclesBtn = document.getElementById('tabCyclesBtn');

  kanbanSec.classList.add('hidden');
  cyclesSec.classList.add('hidden');

  kanbanBtn.className = 'tab-btn text-base font-semibold pb-2.5 flex items-center gap-2';
  cyclesBtn.className = 'tab-btn text-base font-semibold pb-2.5 flex items-center gap-2';

  if (tab === 'kanban') {
    kanbanSec.classList.remove('hidden');
    kanbanBtn.className = 'tab-btn active text-base font-semibold pb-2.5 flex items-center gap-2';
  } else if (tab === 'cycles') {
    cyclesSec.classList.remove('hidden');
    cyclesBtn.className = 'tab-btn active text-base font-semibold pb-2.5 flex items-center gap-2';
    renderPrepaidCyclesBoard();
  }
}

// Global Toast Alert
function showToast(title, msg, color = 'emerald') {
  const toast = document.getElementById('toast');
  const toastTitle = document.getElementById('toastTitle');
  const toastMsg = document.getElementById('toastMsg');
  const toastIcon = document.getElementById('toastIcon');

  toastTitle.innerText = title;
  toastMsg.innerText = msg;

  if (color === 'rose') {
    toastIcon.className = 'fa-solid fa-circle-xmark text-danger text-xl shrink-0';
    toast.className = 'fixed z-50 toast-box rounded-xl p-3.5 flex items-center gap-3';
    toast.style.borderLeft = '4px solid var(--danger)';
  } else if (color === 'blue') {
    toastIcon.className = 'fa-solid fa-spinner fa-spin text-info text-xl shrink-0';
    toast.className = 'fixed z-50 toast-box rounded-xl p-3.5 flex items-center gap-3';
    toast.style.borderLeft = '4px solid var(--info)';
  } else {
    toastIcon.className = 'fa-solid fa-circle-check text-accent-strong text-xl shrink-0';
    toast.className = 'fixed z-50 toast-box rounded-xl p-3.5 flex items-center gap-3';
    toast.style.borderLeft = '4px solid var(--accent)';
  }
  toast.style.bottom = 'calc(1rem + env(safe-area-inset-bottom))';
  toast.style.right = '1rem';
  toast.style.maxWidth = 'calc(100% - 2rem)';

  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

// Prompt to edit attendance date
async function promptEditAttendanceDate(pageId, currentDate) {
  if (!pageId || pageId === 'dummy') {
    return showToast('提示', '無法修改虛擬或無效的點名紀錄日期', 'rose');
  }
  const newDate = prompt(`請輸入新的出勤日期 (格式: YYYY-MM-DD):`, currentDate);
  if (!newDate) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    alert("日期格式錯誤，請使用 YYYY-MM-DD");
    return;
  }

  showToast('修改中...', '正在更新出勤日期...', 'blue');
  try {
    const res = await fetch('api/attendance/update-date', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ pageId, date: newDate })
    });
    if (res.status === 401) { forceLogout(); return; }
    const data = await res.json();
    if (data.success) {
      showToast('更新成功！', '出勤日期已成功更新', 'emerald');
      const activeDate = document.getElementById('dateSelectDropdown').value;
      fetchAttendance(activeDate);
    } else {
      showToast('更新失敗', data.error || 'Notion 同步失敗', 'rose');
    }
  } catch (err) {
    showToast('連線錯誤', '更新失敗', 'rose');
  }
}

// TOGGLE CYCLE WARNING-ONLY FILTER (期別履歷僅看告急人員)
function toggleCycleWarningFilter() {
  cycleWarningOnly = !cycleWarningOnly;
  const btn = document.getElementById('cycleWarningOnlyBtn');
  if (btn) {
    if (cycleWarningOnly) {
      btn.className = 'h-11 px-3 rounded-lg text-sm font-semibold border border-warning bg-warning-soft text-warning transition flex items-center gap-1.5 shrink-0 shadow-sm';
      btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <span>只看告急 (已啟用)</span>';
    } else {
      btn.className = 'h-11 px-3 rounded-lg text-sm font-semibold border border-hairline bg-white text-muted hover:text-warning hover:border-warning/50 transition flex items-center gap-1.5 shrink-0';
      btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <span>只看告急 (≤2次)</span>';
    }
  }
  renderPrepaidCyclesBoard();
}

// OPEN LOW BALANCE MEMBERS MODAL (儲值告急聯動清單)
function openLowBalanceModal() {
  const members = currentData.members || [];
  const low = members.filter(m => (m.planType === '儲值' || m.planType === '預繳10次') && m.remainingCount <= 2);

  // 排序：剩餘次數由少到多 (0 次最優先)，其次依照姓名排序
  low.sort((a, b) => a.remainingCount - b.remainingCount || a.name.localeCompare(b.name, 'zh-Hant'));

  const subtitle = document.getElementById('lowBalanceModalSubtitle');
  if (subtitle) {
    subtitle.innerText = `共 ${low.length} 位儲值球員餘額 ≤ 2 次，點擊可快速對帳或跳轉`;
  }

  const listEl = document.getElementById('lowBalanceList');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (low.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-8 text-muted font-semibold">
        <i class="fa-solid fa-circle-check text-accent-strong text-2xl mb-2 block"></i>
        太棒了！目前沒有儲值即將用罄的人員
      </div>
    `;
  } else {
    low.forEach(m => {
      const item = document.createElement('div');
      item.className = 'p-3 rounded-xl border border-hairline bg-white hover:border-warning/60 hover:shadow-sm transition space-y-2';

      let countBadge = '';
      if (m.remainingCount <= 0) {
        countBadge = `<span class="bg-danger-soft text-danger text-xs font-bold px-2 py-0.5 rounded-full"><i class="fa-solid fa-triangle-exclamation mr-1"></i>剩 0 次 (已用罄)</span>`;
      } else if (m.remainingCount === 1) {
        countBadge = `<span class="bg-warning-soft text-warning text-xs font-bold px-2 py-0.5 rounded-full"><i class="fa-solid fa-clock mr-1"></i>剩 1 次</span>`;
      } else {
        countBadge = `<span class="bg-warning-soft text-warning text-xs font-bold px-2 py-0.5 rounded-full">剩 ${m.remainingCount} 次</span>`;
      }

      const lastDateInfo = m.lastPrepaidDate
        ? `<span class="text-xs text-muted">上次儲值: ${m.lastPrepaidDate}</span>`
        : `<span class="text-xs text-muted">未登記儲值日</span>`;

      let adminRenewBtn = '';
      if (isAdmin && m.memberPageId) {
        adminRenewBtn = `
          <button onclick="openRenewPassModal('${m.memberPageId}', '${m.name}'); closeLowBalanceModal();" title="立即為 ${m.name} 續卡充值" class="h-8 px-2.5 rounded-lg text-xs font-semibold text-warning bg-warning-soft hover:bg-warning hover:text-white transition flex items-center gap-1 shrink-0">
            <i class="fa-solid fa-plus-circle"></i> 充值
          </button>
        `;
      }

      item.innerHTML = `
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2.5 h-2.5 rounded-full bg-plan-prepaid shrink-0"></span>
            <span class="font-bold text-ink text-base truncate">${m.name}</span>
            ${countBadge}
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            ${adminRenewBtn}
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 pt-1 border-t border-hairline/60">
          ${lastDateInfo}
          <div class="flex items-center gap-1.5">
            <button onclick="locatePlayerInKanban('${m.name}')" title="跳轉至今日點名查看" class="h-7 px-2.5 rounded-md text-xs font-semibold text-accent-strong bg-accent-soft hover:bg-accent hover:text-white transition flex items-center gap-1">
              <i class="fa-solid fa-border-all text-[11px]"></i> 今日點名
            </button>
            <button onclick="locatePlayerInCycles('${m.name}')" title="跳轉至期別履歷查看對帳明細" class="h-7 px-2.5 rounded-md text-xs font-semibold text-body bg-surface hover:bg-hairline transition flex items-center gap-1">
              <i class="fa-solid fa-clock-rotate-left text-[11px]"></i> 期別履歷
            </button>
          </div>
        </div>
      `;

      listEl.appendChild(item);
    });
  }

  document.getElementById('lowBalanceModal').classList.remove('hidden');
}

function closeLowBalanceModal() {
  const modal = document.getElementById('lowBalanceModal');
  if (modal) modal.classList.add('hidden');
}

// 聯動動作：在今日點名定位球員
function locatePlayerInKanban(playerName) {
  closeLowBalanceModal();
  switchTab('kanban');
  const searchInput = document.getElementById('kanbanQuickSearch');
  if (searchInput) {
    searchInput.value = playerName;
    filterKanbanCards(playerName);
    searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// 聯動動作：在期別履歷定位球員
function locatePlayerInCycles(playerName) {
  closeLowBalanceModal();
  switchTab('cycles');
  const searchInput = document.getElementById('cycleMemberSearch');
  if (searchInput) {
    searchInput.value = playerName;
  }
  cycleWarningOnly = false;
  const btn = document.getElementById('cycleWarningOnlyBtn');
  if (btn) {
    btn.className = 'h-11 px-3 rounded-lg text-sm font-semibold border border-hairline bg-white text-muted hover:text-warning hover:border-warning/50 transition flex items-center gap-1.5 shrink-0';
  }
  renderPrepaidCyclesBoard();
  const container = document.getElementById('cyclesGridContainer');
  if (container) {
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// 聯動動作：在期別履歷中檢視所有告急球員
function viewAllLowBalanceInCycles() {
  closeLowBalanceModal();
  switchTab('cycles');
  cycleWarningOnly = true;
  const btn = document.getElementById('cycleWarningOnlyBtn');
  if (btn) {
    btn.className = 'h-11 px-3 rounded-lg text-sm font-semibold border border-warning bg-warning-soft text-warning transition flex items-center gap-1.5 shrink-0 shadow-sm';
    btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <span>只看告急 (已啟用)</span>';
  }
  const searchInput = document.getElementById('cycleMemberSearch');
  if (searchInput) searchInput.value = '';
  renderPrepaidCyclesBoard();
  const container = document.getElementById('cyclesGridContainer');
  if (container) {
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
