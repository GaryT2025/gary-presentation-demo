let currentData = { attendance: [], members: [], availableDates: [], activeDate: '', prepaidCyclesMap: {}, funBanners: {} };
let layoutDensity = 'compact'; // 'compact' or 'normal'

// ===== Admin auth state (D-01, D-06) =====
let adminToken = '';
let isAdmin = false;
let sortableInstances = [];

document.addEventListener('DOMContentLoaded', () => {
  // Load-bearing ordering: initAuthState() must run first, before initSortable()
  // (which calls applyAdminVisibility() at its end) and before fetchAttendance().
  // sortableInstances is still an empty array at this point, so this is safe.
  initAuthState();

  const dateDropdown = document.getElementById('dateSelectDropdown');

  // Event Listeners
  dateDropdown.addEventListener('change', (e) => fetchAttendance(e.target.value));
  document.getElementById('refreshBtn').addEventListener('click', () => fetchAttendance(dateDropdown.value));

  // Initialize Kanban & Fetch Data
  initSortable();
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

// Toggle every [data-admin-only] element, swap the header auth button's
// icon/style, and disable/enable SortableJS drag (a genuine write path via
// updateStatus(), not just a UI affordance).
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

// Fetch Attendance and Member Data from Express API
async function fetchAttendance(selectedDate = '') {
  const refreshIcon = document.getElementById('refreshIcon');
  refreshIcon.classList.add('fa-spin');

  try {
    const res = await fetch(`api/attendance?date=${encodeURIComponent(selectedDate)}`);
    const data = await res.json();

    if (data.success) {
      currentData = data;
      renderDateDropdown();
      renderKanban();
      renderFunBanners();
      renderPrepaidCyclesBoard();
      updateKPIs();
      clearBatchSelection();
    } else {
      showToast('錯誤', data.error || '無法讀取 Notion 資料', 'rose');
    }
  } catch (err) {
    showToast('連線失敗', '連線伺服器錯誤', 'rose');
  } finally {
    refreshIcon.classList.remove('fa-spin');
  }
}

// Render Fun Champion Banners
function renderFunBanners() {
  const fb = currentData.funBanners || {};

  const elYear2026King = document.getElementById('bannerYear2026King');
  if (fb.year2026King && fb.year2026King.name) {
    elYear2026King.innerHTML = `<span class="text-warning font-bold">${fb.year2026King.name}</span> (2026出勤 <span class="underline">${fb.year2026King.count}</span> 次稱霸)`;
  } else {
    elYear2026King.innerText = '尚無紀錄';
  }

  const elFastestCasual = document.getElementById('bannerFastestCasual');
  if (fb.fastestCasual && fb.fastestCasual.name) {
    const timeStr = fb.fastestCasual.time ? new Date(fb.fastestCasual.time).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '';
    elFastestCasual.innerHTML = `<span class="text-info font-bold">${fb.fastestCasual.name}</span> (${timeStr} PM 8點零打首殺)`;
  } else {
    elFastestCasual.innerText = '尚無紀錄';
  }

  const elStreak = document.getElementById('bannerStreakKing');
  if (fb.streakKing && fb.streakKing.name) {
    elStreak.innerHTML = `<span class="text-plan-annual font-bold">${fb.streakKing.name}</span> (連續出勤 <span class="underline">${fb.streakKing.streak}</span> 場無間斷)`;
  } else {
    elStreak.innerText = '尚無紀錄';
  }

  const elMonth = document.getElementById('bannerMonthLeader');
  if (fb.monthLeader && fb.monthLeader.name) {
    elMonth.innerHTML = `<span class="text-accent-strong font-bold">${fb.monthLeader.name}</span> (8月打球 <span class="underline">${fb.monthLeader.count}</span> 次稱霸)`;
  } else {
    elMonth.innerText = '尚無紀錄';
  }
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
    container.innerHTML = `<div class="col-span-full py-10 text-center text-muted font-semibold text-base">尚無符合條件的儲值球員期別履歷</div>`;
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
    const isWarning = activeCount >= 8 && activeCycle && !activeCycle.isCompleted;

    const totalSessions = allCycles.reduce((sum, c) => sum + (c.items ? c.items.length : 0), 0);
    const yearCount = mInfo ? mInfo.year2026Count || 0 : 0;

    // Dynamic warning border color (8次: info/blue, 9次: accent/green, 10次: danger/red)
    // Set via inline style (not a Tailwind class) so it reliably overrides the
    // default .card hairline border regardless of stylesheet load order.
    let warningBorderColor = '';
    let warningBadgeClass = '';
    if (isWarning) {
      if (activeCount >= 10) {
        warningBorderColor = '#c23b3b';
        warningBadgeClass = 'bg-danger text-white';
      } else if (activeCount === 9) {
        warningBorderColor = '#1f7a54';
        warningBadgeClass = 'bg-accent text-white';
      } else {
        warningBorderColor = '#2563a8';
        warningBadgeClass = 'bg-info text-white';
      }
    }

    const card = document.createElement('div');
    card.className = 'card rounded-xl p-4 space-y-3 relative transition-all duration-200';
    if (warningBorderColor) {
      card.style.borderColor = warningBorderColor;
      card.style.borderWidth = '1.5px';
    }

    const memberPageId = mInfo ? mInfo.memberPageId : '';

    const warningBadge = isWarning
      ? `<span class="${warningBadgeClass} text-xs font-bold px-2 py-0.5 rounded-full">續卡</span>`
      : '';

    const renewButtonHtml = isAdmin
      ? `<button onclick="openRenewPassModal('${memberPageId}', '${name}')" title="購買新一期 / 續卡加 10 次 (記錄金額)" class="h-9 px-3 rounded-lg text-xs font-semibold text-warning bg-warning-soft active:bg-warning active:text-white transition flex items-center gap-1 shrink-0">
          <i class="fa-solid fa-plus-circle"></i> 購新一期
        </button>`
      : '';

    // Header
    card.innerHTML = `
      <div class="flex items-center justify-between gap-2 border-b border-hairline pb-2.5">
        <div class="flex items-center gap-2 min-w-0">
          <span class="w-2.5 h-2.5 rounded-full bg-plan-prepaid shrink-0"></span>
          <h3 class="font-semibold text-ink text-base truncate active:text-accent-strong cursor-pointer" onclick="openMemberModal('${name}')">${name}</h3>
          ${warningBadge}
        </div>
        <span class="bg-surface text-muted text-xs font-semibold px-2 py-1 rounded-full shrink-0">
          ${targetYear === 'all' ? '全部' : targetYear + '年'} 完卡 ${completedInYear} 期
        </span>
      </div>
      <div class="flex items-center justify-between gap-2 text-sm">
        <span class="text-muted">當期進度 <strong class="${isWarning ? 'text-warning' : 'text-accent-strong'} font-bold">${activeCount}/10</strong> ・ 總計 <strong class="text-ink font-bold">${totalSessions}</strong> 次</span>
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
  if (!memberPageId) return showToast('提示', '無法取得會員 ID', 'rose');

  document.getElementById('renewMemberPageIdInput').value = memberPageId;
  document.getElementById('renewModalMemberName').innerText = `球員: ${memberName}`;
  document.getElementById('renewCountInput').value = '10';
  document.getElementById('renewAmountInput').value = '1500';
  document.getElementById('renewPassModal').classList.remove('hidden');
}

function closeRenewPassModal() {
  document.getElementById('renewPassModal').classList.add('hidden');
}

async function submitRenewPass() {
  const memberPageId = document.getElementById('renewMemberPageIdInput').value;
  const addCount = document.getElementById('renewCountInput').value;
  const amount = document.getElementById('renewAmountInput').value;

  if (!memberPageId) return showToast('提示', '無效的會員 ID', 'rose');

  showToast('續卡處理中...', `正在記錄繳費 $${amount} 並增加 ${addCount} 次...`, 'blue');

  try {
    const res = await fetch('api/members/renew', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ memberPageId, addCount, amount })
    });
    if (res.status === 401) { forceLogout(); return; }
    const data = await res.json();

    if (data.success) {
      showToast('購買/續卡成功！', `成功記錄繳費 $${amount}，次數充值 +${addCount} 次 (現剩餘 ${data.newCount} 次)`, 'emerald');
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
        <i class="fa-solid fa-check"></i> 出席
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
        改出席
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

  showToast('一鍵全到處理中...', `正在將 ${items.length} 位報名球員一鍵標記【已出席】`, 'blue');

  try {
    const res = await fetch('api/attendance/batch-update', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ items, status: '已出席' })
    });
    if (res.status === 401) { forceLogout(); return; }
    const data = await res.json();

    if (data.success) {
      showToast('一鍵點名完成！', `全場 ${data.updatedCount} 位球員成功標記【已出席】`, 'emerald');
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
      let msg = `已在 Notion【出席情況】寫入：${status}`;
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

// Initialize Drag & Drop via SortableJS
function initSortable() {
  const cols = ['colPending', 'colAttended', 'colNoshow'];
  const statusMap = {
    'colPending': '已報名',
    'colAttended': '已出席',
    'colNoshow': '未到'
  };

  cols.forEach(colId => {
    const el = document.getElementById(colId);
    if (!el) return;

    const instance = new Sortable(el, {
      group: 'kanban',
      animation: 150,
      ghostClass: 'sortable-ghost',
      dragClass: 'sortable-drag',
      onEnd: async function (evt) {
        const itemEl = evt.item;
        const targetColId = evt.to.id;
        const newStatus = statusMap[targetColId];
        const pageId = itemEl.dataset.id;
        const memberPageId = itemEl.dataset.memberpageid;
        const oldStatus = itemEl.dataset.status;

        if (newStatus && oldStatus !== newStatus) {
          updateStatus(pageId, newStatus, memberPageId, oldStatus);
        }
      }
    });
    sortableInstances.push(instance);
  });

  applyAdminVisibility();
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
        badge = `<span class="bg-success-soft text-accent-strong px-2 py-1 rounded text-xs font-semibold"><i class="fa-solid fa-circle-check mr-1"></i>已出席</span>`;
      } else if (h.status === '未到' || h.status === '放鳥') {
        badge = `<span class="bg-danger-soft text-danger px-2 py-1 rounded text-xs font-semibold"><i class="fa-solid fa-circle-xmark mr-1"></i>未到</span>`;
      } else {
        badge = `<span class="bg-info-soft text-info px-2 py-1 rounded text-xs font-semibold">已報名</span>`;
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
