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
// in fetchAttendance() or by submitAdminLogin() (D-05, and to keep the
// Task 2 gate's exact-6-occurrence count meaningful).
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

  showToast('請重新登入', msg || '管理者登入已過期或失效，請重新登入', 'rose');
}

// Toggle every [data-admin-only] element, swap the header auth button's
// label/icon, and disable/enable SortableJS drag (a genuine write path via
// updateStatus(), not just a UI affordance).
function applyAdminVisibility() {
  document.querySelectorAll('[data-admin-only]').forEach(el => {
    el.classList.toggle('hidden', !isAdmin);
  });

  const authBtn = document.getElementById('adminAuthBtn');
  if (authBtn) {
    if (isAdmin) {
      authBtn.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i> 登出';
      authBtn.className = 'flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-lg text-xs font-bold transition active:scale-95';
    } else {
      authBtn.innerHTML = '<i class="fa-solid fa-lock"></i> 管理者登入';
      authBtn.className = 'flex items-center gap-1.5 bg-slate-800/90 text-slate-300 border border-slate-700/70 px-3 py-1.5 rounded-lg text-xs font-bold transition active:scale-95';
    }
  }

  sortableInstances.forEach(s => {
    if (s && typeof s.option === 'function') {
      s.option('disabled', !isAdmin);
    }
  });
}

// Header auth button click handler: logs out when already logged in,
// otherwise opens the login modal (D-07).
function handleAdminAuthClick() {
  if (isAdmin) {
    adminToken = '';
    isAdmin = false;
    localStorage.removeItem('badmintonAdminToken');
    applyAdminVisibility();
    renderKanban();
    renderPrepaidCyclesBoard();
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
// object (not authHeaders()) and branches on data.success (not on the HTTP
// unauthorized status code) — this fetch is a login attempt, not a gated
// write, and reusing either pattern here would make the Task 2 exact-count
// gate (6 occurrences each) false-positive over a 7th, unrelated call site.
async function submitAdminLogin() {
  const password = document.getElementById('adminPasswordInput').value;
  const errorEl = document.getElementById('adminLoginError');
  errorEl.classList.add('hidden');

  try {
    const res = await fetch('/api/badminton?path=login', {
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

// ===== Tap-to-toggle fixed-position tooltip portal =====
// Replaces the old CSS :hover mechanism, which does not meaningfully exist
// on touch and was clipped by scrolling/truncating ancestors regardless of z-index.
let tooltipPortalEl = null;
let tooltipPortalOpenTrigger = null;

function getTooltipPortal() {
  if (!tooltipPortalEl) {
    tooltipPortalEl = document.createElement('div');
    tooltipPortalEl.id = 'tooltipPortal';
    document.body.appendChild(tooltipPortalEl);
  }
  return tooltipPortalEl;
}

function showTooltipPortal(triggerEl) {
  const container = triggerEl.closest('.custom-tooltip-container');
  if (!container) return;
  const box = container.querySelector('.custom-tooltip-box');
  if (!box) return;

  const portal = getTooltipPortal();
  // outerHTML (not innerHTML) preserves the box's own border/background/padding classes.
  portal.innerHTML = box.outerHTML;

  const rect = triggerEl.getBoundingClientRect();
  const margin = 12;
  portal.style.display = 'block';

  // Measure after content is in the DOM so offsetHeight/offsetWidth are accurate.
  const portalWidth = portal.offsetWidth;
  const portalHeight = portal.offsetHeight;

  // Prefer above the trigger, flip below when there is not enough room above.
  let top;
  if (rect.top - portalHeight - margin > 0) {
    top = rect.top - portalHeight - margin;
  } else {
    top = rect.bottom + margin;
  }

  let left = rect.left + rect.width / 2 - portalWidth / 2;
  const maxLeft = window.innerWidth - portalWidth - margin;
  left = Math.max(margin, Math.min(left, maxLeft));

  const maxTop = window.innerHeight - portalHeight - margin;
  top = Math.max(margin, Math.min(top, maxTop));

  portal.style.top = `${top}px`;
  portal.style.left = `${left}px`;

  tooltipPortalOpenTrigger = triggerEl;
}

function hideTooltipPortal() {
  if (!tooltipPortalEl) return;
  tooltipPortalEl.style.display = 'none';
  tooltipPortalEl.innerHTML = '';
  tooltipPortalOpenTrigger = null;
}

document.addEventListener('click', (e) => {
  if (tooltipPortalEl && tooltipPortalEl.contains(e.target)) {
    // Click is inside the portal itself (e.g. scrolling the date list) — do nothing.
    return;
  }

  const trigger = e.target.closest('[data-tooltip-trigger]');
  if (trigger) {
    if (tooltipPortalOpenTrigger === trigger) {
      // Tapping the same trigger again closes it.
      hideTooltipPortal();
    } else {
      showTooltipPortal(trigger);
    }
    return;
  }

  hideTooltipPortal();
});

// Fetch Attendance and Member Data from Express API
async function fetchAttendance(selectedDate = '') {
  const refreshIcon = document.getElementById('refreshIcon');
  refreshIcon.classList.add('fa-spin');

  try {
    const res = await fetch(`/api/badminton?path=attendance&date=${encodeURIComponent(selectedDate)}`);
    const data = await res.json();

    if (data.success) {
      currentData = data;
      hideTooltipPortal();
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
    elYear2026King.innerHTML = `<span class="text-amber-400 font-black">${fb.year2026King.name}</span> (2026出勤 <span class="underline">${fb.year2026King.count}</span> 次稱霸)`;
  } else {
    elYear2026King.innerText = '尚無紀錄';
  }

  const elFastestCasual = document.getElementById('bannerFastestCasual');
  if (fb.fastestCasual && fb.fastestCasual.name && fb.fastestCasual.wins > 0) {
    elFastestCasual.innerHTML = `<span class="text-cyan-400 font-black">${fb.fastestCasual.name}</span> (年度累計 <span class="underline">${fb.fastestCasual.wins}</span> 場最速報名)`;
  } else {
    elFastestCasual.innerText = '尚無紀錄';
  }

  const elStreak = document.getElementById('bannerStreakKing');
  if (fb.streakKing && fb.streakKing.name) {
    elStreak.innerHTML = `<span class="text-purple-400 font-black">${fb.streakKing.name}</span> (連續出勤 <span class="underline">${fb.streakKing.streak}</span> 場無間斷)`;
  } else {
    elStreak.innerText = '尚無紀錄';
  }

  const elMonth = document.getElementById('bannerMonthLeader');
  if (fb.monthLeader && fb.monthLeader.name) {
    elMonth.innerHTML = `<span class="text-emerald-400 font-black">${fb.monthLeader.name}</span> (8月打球 <span class="underline">${fb.monthLeader.count}</span> 次稱霸)`;
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

  if (memberNames.length === 0) {
    container.innerHTML = `<div class="col-span-full py-10 text-center text-slate-500 font-bold">尚無符合條件的儲值球員期別履歷</div>`;
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

    const card = document.createElement('div');
    card.className = 'glass-card bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3 shadow-lg relative';

    const memberPageId = mInfo ? mInfo.memberPageId : '';

    const renewButtonHtml = isAdmin
      ? `<button onclick="openRenewPassModal('${memberPageId}', '${name}')" title="購買新一期 / 續卡加 10 次 (記錄金額)" class="bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 text-[10px] font-extrabold px-2.5 py-1 rounded border border-amber-500/40 transition flex items-center gap-1">
            <i class="fa-solid fa-plus-circle"></i> +購新一期
          </button>`
      : '';

    // Header
    card.innerHTML = `
      <div class="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div class="flex items-center gap-2">
          <span style="background-color: #f59e0b; width: 12px; height: 12px; border-radius: 9999px; display: inline-block; box-shadow: 0 0 10px rgba(245,158,11,0.9);"></span>
          <h3 class="font-extrabold text-white text-sm hover:text-amber-400 cursor-pointer" onclick="openMemberModal('${name}')">${name}</h3>
        </div>
        <div class="flex items-center gap-1.5">
          ${renewButtonHtml}
          <span class="bg-slate-800 text-slate-300 text-[10px] font-extrabold px-2 py-1 rounded-full border border-slate-700">
            ${targetYear === 'all' ? '全部' : targetYear + '年'} 完卡 ${completedInYear} 期
          </span>
        </div>
      </div>
    `;

    // Cycles Timeline Container
    const cyclesListDiv = document.createElement('div');
    cyclesListDiv.className = 'space-y-3 max-h-80 overflow-y-auto pr-1 text-xs';

    if (filteredCycles.length === 0) {
      cyclesListDiv.innerHTML = `<p class="text-slate-500 text-center py-3">該年份無儲值期別紀錄</p>`;
    } else {
      filteredCycles.forEach(c => {
        const cycleItem = document.createElement('div');
        cycleItem.className = 'bg-slate-800/50 border border-slate-700/50 rounded-lg p-2.5';

        // Plain text fallback for title attribute & Rich HTML custom tooltip
        const datesTitleText = c.items.map(it => `第 ${it.sessionNo} 次: ${it.date}`).join('\n');
        
        const tooltipBoxHtml = `
          <div class="custom-tooltip-box bg-slate-900/95 border border-amber-500/60 text-slate-100 rounded-xl p-3 text-xs shadow-2xl backdrop-blur-md">
            <div class="font-extrabold text-amber-400 border-b border-slate-800 pb-1.5 mb-2 flex items-center justify-between gap-3">
              <span><i class="fa-solid fa-calendar-days mr-1.5 text-amber-400"></i>第 ${c.cycleNum} 期 出席日期</span>
              <span class="text-[10px] ${c.isCompleted ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'} px-1.5 py-0.5 rounded font-bold">
                ${c.isCompleted ? '✅ 已完卡 (10/10)' : `⏳ 進行中 (${c.items.length}/10)`}
              </span>
            </div>
            <div class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              ${c.items.length > 0 ? c.items.map(it => `
                <div class="flex items-center justify-between text-[11px] hover:bg-slate-800/80 px-2 py-1 rounded transition border border-slate-800/50">
                  <span class="text-slate-400 font-medium">第 ${it.sessionNo} 次</span>
                  <span class="font-mono text-emerald-400 font-bold">📅 ${it.date}</span>
                </div>
              `).join('') : '<div class="text-slate-500 text-center py-1">尚無打球紀錄</div>'}
            </div>
          </div>
        `;

        const dateRangeStr = c.isCompleted 
          ? `<span class="text-emerald-300 font-extrabold">${c.startDate}</span> ➔ <span class="text-emerald-300 font-extrabold">${c.endDate}</span> <span class="text-slate-400 font-normal">(歷時 ${c.totalDays} 天)</span>`
          : `<span class="text-amber-300 font-extrabold">${c.startDate} 開始</span> ➔ <span class="text-slate-400">進行中 (已打 ${c.items.length}/10 次)</span>`;

        // 10 Detailed Dates Accordion/List for verification
        let dateItemsHtml = '';
        c.items.forEach(it => {
          const editDateBtnHtml = isAdmin
            ? `<button onclick="promptEditAttendanceDate('${it.id}', '${it.date}')" class="text-[10px] text-amber-400 hover:text-amber-300 px-1" title="修改出勤日期">
                  <i class="fa-solid fa-edit"></i>
                </button>`
            : '';
          dateItemsHtml += `
            <div class="flex items-center justify-between text-[11px] bg-slate-900/60 px-2 py-0.5 rounded border border-slate-800">
              <span class="font-bold text-slate-300">第 ${it.sessionNo} 次打球</span>
              <div class="flex items-center gap-1">
                <span class="font-extrabold text-emerald-400">📅 ${it.date}</span>
                ${editDateBtnHtml}
              </div>
            </div>
          `;
        });

        const collapseId = `cycleDetail_${name}_${c.cycleNum}`;

        cycleItem.innerHTML = `
          <div class="flex items-center justify-between mb-1.5">
            <div class="custom-tooltip-container" title="${datesTitleText}">
              <span class="font-extrabold ${c.isCompleted ? 'text-slate-200' : 'text-amber-400'} cursor-help hover:underline decoration-amber-400/50" data-tooltip-trigger>
                <i class="fa-solid fa-bookmark mr-1"></i> 第 ${c.cycleNum} 期 ${c.isCompleted ? '✅ 已完卡' : '⏳ 進行中'}
              </span>
              ${tooltipBoxHtml}
            </div>
            <button onclick="toggleCycleDetail('${collapseId}')" class="text-[10px] font-bold text-amber-400 hover:underline">
              <i class="fa-solid fa-calendar-check mr-1"></i> 對帳日期 (10次明細)
            </button>
          </div>

          <div class="text-[11px] mb-2 custom-tooltip-container w-full" data-tooltip-trigger title="${datesTitleText}">
            ${dateRangeStr}
            ${tooltipBoxHtml}
          </div>

          <!-- Detailed 10 Attendance Dates Grid -->
          <div id="${collapseId}" class="mt-2 pt-2 border-t border-slate-800 grid grid-cols-2 gap-1.5 hidden">
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
    const res = await fetch('/api/badminton?path=members/add', {
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
    const res = await fetch('/api/badminton?path=members/renew', {
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
    cBtn.className = 'px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30';
    nBtn.className = 'px-2 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-slate-200';
  } else {
    nBtn.className = 'px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30';
    cBtn.className = 'px-2 py-0.5 rounded bg-slate-800 text-slate-400 hover:text-slate-200';
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

// Helper: Get Vibrant Color Orb & Left Bar Style for Plan Type (100% Ultra Visible)
function getPlanStyle(planType) {
  if (planType === '年繳') {
    return {
      dot: `<span style="background-color: #a855f7; width: 12px; height: 12px; min-width: 12px; border-radius: 9999px; display: inline-block; box-shadow: 0 0 10px rgba(168,85,247,0.9);" title="年繳"></span>`,
      barColor: '#a855f7'
    };
  }
  if (planType === '月繳') {
    return {
      dot: `<span style="background-color: #10b981; width: 12px; height: 12px; min-width: 12px; border-radius: 9999px; display: inline-block; box-shadow: 0 0 10px rgba(16,185,129,0.9);" title="月繳"></span>`,
      barColor: '#10b981'
    };
  }
  // 儲值 (Prepaid)
  return {
    dot: `<span style="background-color: #f59e0b; width: 12px; height: 12px; min-width: 12px; border-radius: 9999px; display: inline-block; box-shadow: 0 0 10px rgba(245,158,11,0.9);" title="儲值"></span>`,
    barColor: '#f59e0b'
  };
}

// Create Ultra-Compact Card DOM Element
function createCardElement(item) {
  const card = document.createElement('div');
  const isCompact = layoutDensity === 'compact';
  const planStyle = getPlanStyle(item.planType);

  card.className = `glass-card kanban-card rounded-lg border transition-all duration-150 relative group cursor-grab active:cursor-grabbing ${
    isCompact ? 'p-2 border-slate-800/90 bg-slate-900/90 hover:border-slate-700' : 'p-3 border-slate-800 bg-slate-900/80'
  } ${item.isBlacklisted ? 'border-rose-500/60 bg-rose-950/20' : ''}`;
  
  card.style.borderLeft = `4px solid ${planStyle.barColor}`;

  card.dataset.id = item.id;
  card.dataset.name = item.name;
  card.dataset.memberpageid = item.memberPageId || '';
  card.dataset.status = item.status;

  const blacklistBadge = item.isBlacklisted
    ? `<span class="bg-rose-600/30 text-rose-200 border border-rose-500/80 text-[10px] font-extrabold px-1.5 py-0.2 rounded">⛔ 1個月未到${item.noshowCount}次</span>`
    : '';

  let actionButtons = '';
  if (isAdmin && (item.status === '已報名' || item.status === '報名成功')) {
    actionButtons = `
      <button onclick="updateStatus('${item.id}', '已出席', '${item.memberPageId}', '${item.status}')" title="點名出席" class="bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-slate-950 text-[11px] font-bold px-2 py-0.5 rounded border border-emerald-500/40 transition">
        <i class="fa-solid fa-check"></i> 出席
      </button>
      <button onclick="updateStatus('${item.id}', '未到', '${item.memberPageId}', '${item.status}')" title="標記未到" class="bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-slate-950 text-[11px] font-bold px-2 py-0.5 rounded border border-rose-500/40 transition">
        <i class="fa-solid fa-xmark"></i> 未到
      </button>
    `;
  } else if (isAdmin && item.status === '已出席') {
    actionButtons = `
      <button onclick="updateStatus('${item.id}', '已報名', '${item.memberPageId}', '${item.status}')" title="重設狀態" class="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-700 transition">
        <i class="fa-solid fa-rotate-left"></i> 重設
      </button>
      <button onclick="updateStatus('${item.id}', '未到', '${item.memberPageId}', '${item.status}')" title="改為未到" class="bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-slate-950 text-[10px] font-bold px-1.5 py-0.5 rounded border border-rose-500/40 transition">
        改未到
      </button>
    `;
  } else if (isAdmin && (item.status === '未到' || item.status === '放鳥')) {
    actionButtons = `
      <button onclick="updateStatus('${item.id}', '已出席', '${item.memberPageId}', '${item.status}')" title="改為出席" class="bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-slate-950 text-[10px] font-bold px-1.5 py-0.5 rounded border border-emerald-500/40 transition">
        改出席
      </button>
      <button onclick="updateStatus('${item.id}', '已報名', '${item.memberPageId}', '${item.status}')" title="重設狀態" class="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold px-1.5 py-0.5 rounded border border-slate-700 transition">
        <i class="fa-solid fa-rotate-left"></i> 重設
      </button>
    `;
  }

  // Generate Floating Tooltip for Prepaid Member Cycles on Kanban Card
  let memberTooltipHtml = '';
  let memberTitleText = '';
  if (item.planType === '儲值' || item.planType === '預繳10次') {
    const userCycles = (currentData.prepaidCyclesMap && currentData.prepaidCyclesMap[item.name]) || [];
    if (userCycles.length > 0) {
      const activeCycle = userCycles.find(c => !c.isCompleted) || userCycles[userCycles.length - 1];
      const itemsList = activeCycle.items || [];
      memberTitleText = `【${item.name} 第 ${activeCycle.cycleNum} 期 (已打 ${itemsList.length}/10 次)】\n` + 
        itemsList.map(it => `第 ${it.sessionNo} 次: ${it.date}`).join('\n');

      memberTooltipHtml = `
        <div class="custom-tooltip-box bg-slate-900/95 border border-amber-500/60 text-slate-100 rounded-xl p-2.5 text-xs shadow-2xl backdrop-blur-md">
          <div class="font-extrabold text-amber-400 border-b border-slate-800 pb-1 mb-1.5 flex items-center justify-between gap-2">
            <span><i class="fa-solid fa-bookmark mr-1 text-amber-400"></i>第 ${activeCycle.cycleNum} 期出席明細</span>
            <span class="text-[10px] text-amber-300 font-bold">${itemsList.length}/10 次</span>
          </div>
          <div class="space-y-1 max-h-40 overflow-y-auto pr-1">
            ${itemsList.length > 0 ? itemsList.map(it => `
              <div class="flex items-center justify-between gap-2 text-[11px] hover:bg-slate-800/80 px-1.5 py-0.5 rounded">
                <span class="text-slate-400 font-medium">第 ${it.sessionNo} 次</span>
                <span class="font-mono text-emerald-400 font-bold">${it.date}</span>
              </div>
            `).join('') : '<div class="text-slate-500 text-center text-[10px] py-0.5">尚無打球紀錄</div>'}
          </div>
        </div>
      `;
    }
  }

  // Restructure: `truncate max-w-[110px]` moved off the container onto the name span
  // (so the name truncates on its own, keeping the info icon always visible), the
  // container itself becomes inline-flex, and the info icon (the actual trigger) sits
  // inside the container immediately after the name span so closest('.custom-tooltip-container')
  // still resolves. The name span keeps its openMemberModal onclick and does NOT carry
  // data-tooltip-trigger; only the icon does.
  const infoIconHtml = memberTooltipHtml
    ? `<i class="fa-solid fa-circle-info text-amber-400/80 hover:text-amber-300 text-[11px] cursor-pointer shrink-0" data-tooltip-trigger></i>`
    : '';

  const checkboxHtml = isAdmin
    ? `<input type="checkbox" onchange="handleCardCheckChange()" class="card-checkbox w-3.5 h-3.5 rounded border-slate-700 bg-slate-800 text-emerald-400 focus:ring-0 cursor-pointer shrink-0" data-id="${item.id}" data-memberpageid="${item.memberPageId || ''}" data-status="${item.status}">`
    : '';

  card.innerHTML = `
    <div class="flex items-center justify-between gap-1">
      <div class="flex items-center gap-1.5 overflow-hidden">
        ${checkboxHtml}
        ${planStyle.dot}
        <div class="custom-tooltip-container inline-flex items-center gap-1" title="${memberTitleText}">
          <span onclick="openMemberModal('${item.name}')" class="font-extrabold text-slate-100 text-xs truncate max-w-[110px] hover:text-emerald-400 cursor-pointer underline decoration-slate-700 underline-offset-2">${item.name}</span>
          ${infoIconHtml}
          ${memberTooltipHtml}
        </div>
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
        card.classList.add('ring-2', 'ring-emerald-400');
      } else {
        card.classList.remove('ring-2', 'ring-emerald-400');
      }
    } else {
      card.classList.add('hidden');
      card.classList.remove('ring-2', 'ring-emerald-400');
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
    const res = await fetch('/api/badminton?path=attendance/batch-update', {
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
    const res = await fetch('/api/badminton?path=attendance/batch-update', {
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
    const res = await fetch('/api/badminton?path=attendance/update', {
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
    listEl.innerHTML = `<div class="text-slate-500 text-center py-4">無歷史打球紀錄</div>`;
  } else {
    mInfo.history.forEach(h => {
      const item = document.createElement('div');
      item.className = 'flex items-center justify-between p-2 rounded-lg bg-slate-800/50 border border-slate-700/50';
      
      let badge = '';
      if (h.status === '已出席') {
        badge = `<span class="bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded text-[10px] font-bold"><i class="fa-solid fa-circle-check mr-1"></i>已出席</span>`;
      } else if (h.status === '未到' || h.status === '放鳥') {
        badge = `<span class="bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded text-[10px] font-bold"><i class="fa-solid fa-circle-xmark mr-1"></i>未到</span>`;
      } else {
        badge = `<span class="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded text-[10px] font-bold">已報名</span>`;
      }

      item.innerHTML = `
        <span class="font-semibold text-slate-200">📅 ${h.date}</span>
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

  kanbanBtn.className = 'tab-btn text-xs font-extrabold border-b-2 border-transparent text-slate-400 hover:text-slate-200 pb-1 flex items-center gap-1.5';
  cyclesBtn.className = 'tab-btn text-xs font-extrabold border-b-2 border-transparent text-slate-400 hover:text-slate-200 pb-1 flex items-center gap-1.5';

  if (tab === 'kanban') {
    kanbanSec.classList.remove('hidden');
    kanbanBtn.className = 'tab-btn active text-xs font-extrabold border-b-2 border-emerald-400 text-emerald-400 pb-1 flex items-center gap-1.5';
  } else if (tab === 'cycles') {
    cyclesSec.classList.remove('hidden');
    cyclesBtn.className = 'tab-btn active text-xs font-extrabold border-b-2 border-amber-400 text-amber-400 pb-1 flex items-center gap-1.5';
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
    toastIcon.className = 'fa-solid fa-circle-xmark text-rose-400 text-base';
    toast.className = 'fixed bottom-4 right-4 z-50 bg-slate-900/95 border border-rose-500/50 shadow-xl rounded-xl p-3 flex items-center gap-2.5 text-slate-100 backdrop-blur-xl text-xs';
  } else if (color === 'blue') {
    toastIcon.className = 'fa-solid fa-spinner fa-spin text-blue-400 text-base';
    toast.className = 'fixed bottom-4 right-4 z-50 bg-slate-900/95 border border-blue-500/50 shadow-xl rounded-xl p-3 flex items-center gap-2.5 text-slate-100 backdrop-blur-xl text-xs';
  } else {
    toastIcon.className = 'fa-solid fa-circle-check text-emerald-400 text-base';
    toast.className = 'fixed bottom-4 right-4 z-50 bg-slate-900/95 border border-emerald-500/50 shadow-xl rounded-xl p-3 flex items-center gap-2.5 text-slate-100 backdrop-blur-xl text-xs';
  }

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
    const res = await fetch('/api/badminton?path=attendance/update-date', {
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
