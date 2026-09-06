import crypto from 'node:crypto';

// Paced batch-update (attendance/batch-update) sends Notion requests at
// ~3/s to stay under Notion's rate limit. A 36-person 一鍵全到 batch is
// ~36 items x up to 3 Notion calls ≈ 108 requests ≈ 36s, which cannot fit
// in Vercel's default Node function timeout. 60 is the Vercel Hobby
// ceiling, so it is safe on any plan tier this project could be on.
export const maxDuration = 60;

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const ATTENDANCE_DB_ID = process.env.NOTION_ATTENDANCE_DB_ID;
const MEMBERS_DB_ID = process.env.NOTION_MEMBERS_DB_ID;

const NOTION_HEADERS = {
  'Authorization': `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json'
};

const OFFICIAL_YEARLY = ['小鄭', '阿峻', '蘇聯', '賴董', '誠仁'];
const OFFICIAL_MONTHLY = ['富哥', '福哥', '光廷', '阿娟', '小洪', '年興'];
const OFFICIAL_PREPAID = ['糖果寶', '淑湘', '賓哥', 'Sam', '小潘', '小卉', '銘仁', '為欽', '羽辰', '世昌', '文和', '智文', '浩騰', 'Justin', '進宗', '庭偉', '柏村', '昆疆', '牧民', 'Gary', '弘峻', '慶鴻', '柳大神', '俊佳'];

const NAME_ALIASES = { '黃羽辰': '羽辰', '柳大俠': '柳大神' };

function normalizeName(rawName) {
  return NAME_ALIASES[rawName] || rawName;
}

function getOfficialPlan(name) {
  if (OFFICIAL_YEARLY.includes(name)) return '年繳';
  if (OFFICIAL_MONTHLY.includes(name)) return '月繳';
  if (OFFICIAL_PREPAID.includes(name)) return '儲值';
  return '儲值';
}

// Pagination is driven exclusively by Notion's own has_more/next_cursor
// signal -- there is no hardcoded page/record cap. MAX_SAFETY_PAGES below
// is a runaway-loop guard only (not a data-correctness cap): it protects
// against a genuine Notion-API-misbehavior scenario (has_more never
// resolving to false), sized generously at ~25x today's largest table
// (attendance DB had 4,013 rows / 41 pages as of 2026-09-06). If it is
// ever hit, this throws loudly instead of looping forever or silently
// truncating results. See .planning/quick/260906-i5e-badminton-attendance-pagination-dataloss/
// for the data-loss bug this replaces (the old hardcoded page-count cap
// silently dropped the oldest records once a table grew past it).
const MAX_SAFETY_PAGES = 1000;

async function queryAllNotionDatabase(dbId) {
  let allResults = [];
  let hasMore = true;
  let nextCursor = undefined;
  let pageCount = 0;

  while (hasMore) {
    pageCount++;
    if (pageCount > MAX_SAFETY_PAGES) {
      throw new Error(`queryAllNotionDatabase runaway-loop abort: dbId=${dbId} exceeded MAX_SAFETY_PAGES=${MAX_SAFETY_PAGES} (fetched ${allResults.length} records so far) without has_more resolving to false. This is a safety-guard abort, not a data-correctness truncation -- investigate Notion API behavior.`);
    }
    const body = {
      page_size: 100,
      sorts: [{ timestamp: 'created_time', direction: 'descending' }]
    };
    if (nextCursor) body.start_cursor = nextCursor;

    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: NOTION_HEADERS,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Notion API Error (${res.status}): ${errText}`);
    }
    const data = await res.json();
    allResults = allResults.concat(data.results || []);
    hasMore = data.has_more || false;
    nextCursor = data.next_cursor;
  }

  return allResults;
}

async function createNotionPage(dbId, properties) {
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: NOTION_HEADERS,
    body: JSON.stringify({
      parent: { database_id: dbId },
      properties
    })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Notion Create Page Error (${res.status}): ${errText}`);
  }
  return await res.json();
}

async function updateNotionPage(pageId, properties) {
  if (!pageId || pageId === 'dummy' || pageId.length < 20) {
    return { success: false, skipped: true };
  }
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: NOTION_HEADERS,
    body: JSON.stringify({ properties })
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Notion Update Page Error (${res.status}): ${errText}`);
  }
  return await res.json();
}

async function getNotionPage(pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'GET',
    headers: NOTION_HEADERS
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Notion Get Page Error (${res.status}): ${errText}`);
  }
  return await res.json();
}

function getPlainText(prop) {
  if (!prop) return '';
  if (prop.type === 'title' && prop.title) {
    return prop.title.map(t => t.plain_text).join('');
  }
  if (prop.type === 'rich_text' && prop.rich_text) {
    return prop.rich_text.map(t => t.plain_text).join('');
  }
  if (prop.type === 'select' && prop.select) {
    return prop.select.name || '';
  }
  if (prop.type === 'email') return prop.email || '';
  return '';
}

// Notion's API caps out around 3 requests/second per integration. A plain
// concurrency cap is not enough (with ~250ms round trips, 3 concurrent
// workers can still push ~12 req/s), so we reserve evenly-spaced send slots
// instead: the send RATE is bounded regardless of latency. Reservation is
// synchronous so two concurrent callers can never win the same slot.
const NOTION_MIN_INTERVAL_MS = 340;
let notionNextSlotAt = 0;
function acquireNotionSlot() {
  const at = Math.max(Date.now(), notionNextSlotAt);
  notionNextSlotAt = at + NOTION_MIN_INTERVAL_MS;
  const delay = at - Date.now();
  if (delay <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function getDatePropVal(properties) {
  if (!properties) return '';
  for (const key in properties) {
    const prop = properties[key];
    if (prop && prop.type === 'date' && prop.date && prop.date.start) {
      return prop.date.start.slice(0, 10);
    }
  }
  return '';
}

function toTaiwanDateStr(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const twDate = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return twDate.toISOString().split('T')[0];
}

function calculatePrepaidCycles(attendanceHistory) {
  const validAttendances = attendanceHistory
    .filter(h => h.originStatus === '報名成功' && h.attendanceStatus === '已出席')
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const cycles = [];
  let currentCycle = null;

  validAttendances.forEach((item, index) => {
    const cycleIndex = Math.floor(index / 10) + 1;
    const positionInCycle = (index % 10) + 1;

    if (positionInCycle === 1) {
      const itemYear = (item.date && item.date.length >= 4) ? item.date.slice(0, 4) : '2026';
      currentCycle = {
        cycleNum: cycleIndex,
        startDate: item.date || '',
        endDate: null,
        isCompleted: false,
        totalDays: 0,
        year: itemYear,
        items: [{ sessionNo: 1, date: item.date || '', status: item.status, id: item.id }]
      };
      cycles.push(currentCycle);
    } else {
      currentCycle.items.push({ sessionNo: positionInCycle, date: item.date, status: item.status, id: item.id });
    }

    if (positionInCycle === 10) {
      currentCycle.endDate = item.date;
      currentCycle.isCompleted = true;
      const startD = new Date(currentCycle.startDate);
      const endD = new Date(item.date);
      currentCycle.totalDays = Math.max(1, Math.round((endD - startD) / (1000 * 60 * 60 * 24)));
    }
  });

  return cycles;
}

// Admin auth helpers (D-03, D-10). Env reads happen at call time inside these
// functions or their callers — never as module-level consts — so a trailing
// space in a dashboard-pasted value or a runtime env mutation (as the test
// harness does) is always picked up fresh.

function constantTimeEqual(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function signExpiry(expiryStr, secret) {
  return crypto.createHmac('sha256', secret).update(expiryStr).digest('hex');
}

function verifyAdminToken(req) {
  const secret = (process.env.ADMIN_TOKEN_SECRET || '').trim();
  if (!secret) return false;

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;

  const token = authHeader.slice('Bearer '.length);
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [expiryStr, sig] = parts;
  if (!Number.isInteger(Number(expiryStr))) return false;
  if (Number(expiryStr) <= Date.now()) return false;

  return constantTimeEqual(signExpiry(expiryStr, secret), sig);
}

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  // vercel.json applies `Cache-Control: public, max-age=3600` to `/(.*)`, which
  // matches this rewritten API path and let Vercel's edge CDN serve hour-old
  // Notion data after a write (measured: X-Vercel-Cache: HIT, Age: 349).
  // vercel.json is shared by every site in this project and must not be edited,
  // so override it here instead. Applies to all routes — reads and writes alike.
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { path } = req.query;

  try {
    // 0a. POST api/badminton?path=login — issues a stateless HMAC-signed admin
    // token. Every failure path returns the identical generic body so nothing
    // leaks about wrong-password vs unconfigured-env (D-10, T-wjq-07).
    if (req.method === 'POST' && path === 'login') {
      const adminPassword = (process.env.ADMIN_PASSWORD || '').trim();
      if (!adminPassword) {
        console.error('[badminton auth] login attempted but ADMIN_PASSWORD is not configured');
        return res.status(401).json({ success: false, error: '登入失敗' });
      }

      const body = req.body || {};
      const password = typeof body.password === 'string' ? body.password : '';
      if (!password) {
        return res.status(401).json({ success: false, error: '登入失敗' });
      }

      if (!constantTimeEqual(password, adminPassword)) {
        return res.status(401).json({ success: false, error: '登入失敗' });
      }

      const secret = (process.env.ADMIN_TOKEN_SECRET || '').trim();
      if (!secret) {
        return res.status(401).json({ success: false, error: '登入失敗' });
      }

      const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const expiryStr = String(expiry);
      const token = `${expiryStr}.${signExpiry(expiryStr, secret)}`;

      return res.status(200).json({ success: true, token, expiresAt: expiry });
    }

    // 0b. Fail-closed guard on every other POST route (D-04). Deliberately
    // "every POST except login" rather than an allow-list of the five known
    // write paths, so a future route is protected by default. Sits above all
    // route blocks so it precedes both body validation and any Notion call.
    if (req.method === 'POST' && path !== 'login') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, error: '需要管理者權限，請重新登入' });
      }
    }

    // 1. GET api/attendance
    if (req.method === 'GET' && path === 'attendance') {
      const targetDate = req.query.date || '';
      const currentYear = '2026';
      const currentMonthPrefix = '2026-08';
      const realTodayStr = toTaiwanDateStr(new Date().toISOString());
      
      const attendanceResults = await queryAllNotionDatabase(ATTENDANCE_DB_ID);
      const memberResults = await queryAllNotionDatabase(MEMBERS_DB_ID);

      const memberPlanMap = {};
      const memberNameMap = {};
      const memberIdToPageId = {};

      memberResults.forEach(m => {
        const props = m.properties;
        const userId = getPlainText(props['userId']);
        const name = getPlainText(props['Name']) || getPlainText(props['item']) || '';
        const planType = getPlainText(props['繳費類型']);
        const count = props['Number'] ? (props['Number'].number ?? 0) : 0;
        
        const memberInfo = {
          memberPageId: m.id,
          userId,
          name,
          planType,
          remainingCount: count,
          year2026Count: 0,
          monthCount: 0
        };

        if (userId) memberPlanMap[userId] = memberInfo;
        if (name) memberNameMap[name] = memberInfo;
        memberIdToPageId[m.id] = memberInfo;
      });

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const noshowCounts = {};
      const dateCounts = {};
      const playerStatsMap = {};
      const casualWinnerByDate = {};

      attendanceResults.forEach(p => {
        const attendanceStatus = getPlainText(p.properties['出席情況']);
        const originStatus = getPlainText(p.properties['Status']) || '已報名';
        
        let status = attendanceStatus || originStatus;
        if (status === '放鳥') status = '未到';
        if (status === '取消報名' || status === '報名取消') return;

        const name = normalizeName((getPlainText(p.properties['姓名(Name)'])).trim());
        if (!name || name === '5' || !isNaN(name)) return;

        const uId = getPlainText(p.properties['userId']);
        const datePropVal = getDatePropVal(p.properties);
        const createdDateVal = toTaiwanDateStr(p.created_time);
        const finalDate = datePropVal || createdDateVal;

        if (finalDate) {
          dateCounts[finalDate] = (dateCounts[finalDate] || 0) + 1;
        }

        if (status === '未到' && finalDate) {
          const pDate = new Date(finalDate);
          if (pDate >= thirtyDaysAgo) {
            noshowCounts[name] = (noshowCounts[name] || 0) + 1;
            if (uId) noshowCounts[uId] = (noshowCounts[uId] || 0) + 1;
          }
        }

        const officialPlan = getOfficialPlan(name);
        const mInfo = memberNameMap[name] || memberPlanMap[uId] || { planType: officialPlan, remainingCount: 10 };
        const resolvedPlan = mInfo.planType || officialPlan;

        // D-02/D-03: per-session-date 零打 race, computed year-wide (not from the
        // date-filtered `list` below). Eligible = no real Members-DB record at all
        // (mInfo.memberPageId is undefined for the fallback object above — that IS
        // the falsy-memberPageId signal). Cancelled records already `return` above,
        // so they are excluded for free. Keep the earliest-created_time record per date.
        if (!mInfo.memberPageId && finalDate && finalDate.startsWith(currentYear)) {
          const existing = casualWinnerByDate[finalDate];
          if (!existing || new Date(p.created_time) < new Date(existing.createdTime)) {
            casualWinnerByDate[finalDate] = { name, createdTime: p.created_time };
          }
        }

        if (!playerStatsMap[name]) {
          playerStatsMap[name] = {
            name,
            userId: uId,
            planType: resolvedPlan,
            remainingCount: mInfo.remainingCount,
            year2026Count: 0,
            monthCount: 0,
            streakCount: 0,
            history: []
          };
        }

        const isValid = originStatus === '報名成功' || attendanceStatus === '已出席';

        playerStatsMap[name].history.push({
          date: finalDate,
          status,
          attendanceStatus,
          originStatus,
          isValid,
          isAttended: attendanceStatus === '已出席',
          id: p.id
        });

        if (isValid) {
          if (finalDate && finalDate.startsWith(currentYear)) {
            playerStatsMap[name].year2026Count += 1;
            if (mInfo) mInfo.year2026Count = (mInfo.year2026Count || 0) + 1;
            if (finalDate.startsWith(currentMonthPrefix)) {
              playerStatsMap[name].monthCount += 1;
              if (mInfo) mInfo.monthCount = (mInfo.monthCount || 0) + 1;
            }
          }
        }
      });

      const prepaidCyclesMap = {};

      Object.values(playerStatsMap).forEach(p => {
        let currentStreak = 0;
        let maxStreak = 0;
        const sorted2026Hist = [...p.history]
          .filter(h => h.date && h.date.startsWith(currentYear))
          .sort((a, b) => new Date(a.date) - new Date(b.date));

        sorted2026Hist.forEach(h => {
          if (h.isValid) {
            currentStreak += 1;
            if (currentStreak > maxStreak) maxStreak = currentStreak;
          } else if (h.status === '未到') {
            currentStreak = 0;
          }
        });
        p.streakCount = maxStreak;

        const resolvedPlan = p.planType;

        // 僅限官方儲值名單 (OFFICIAL_PREPAID) 且繳費類型為「儲值」者才列入儲值期別履歷看板
        if (OFFICIAL_PREPAID.includes(p.name) && resolvedPlan === '儲值') {
          prepaidCyclesMap[p.name] = calculatePrepaidCycles(p.history);
        }
      });

      const availableDates = Object.keys(dateCounts)
        .sort((a, b) => new Date(b) - new Date(a))
        .map(d => ({ date: d, count: dateCounts[d] }));

      // 優先顯示「今天」，若今天無開局，則自動倒退顯示最近一個「最後開場日期」
      let defaultDate = availableDates[0]?.date || realTodayStr;
      if (availableDates.find(d => d.date === realTodayStr)) {
        defaultDate = realTodayStr;
      }

      const activeDate = targetDate || defaultDate;
      const list = [];

      attendanceResults.forEach(p => {
        const attendanceStatus = getPlainText(p.properties['出席情況']);
        const originStatus = getPlainText(p.properties['Status']) || '已報名';
        
        let status = attendanceStatus || originStatus;
        if (status === '放鳥') status = '未到';
        if (status === '取消報名' || status === '報名取消') return;

        const name = normalizeName((getPlainText(p.properties['姓名(Name)'])).trim());
        if (!name || name === '5' || !isNaN(name)) return;

        const uId = getPlainText(p.properties['userId']);
        const datePropVal = getDatePropVal(p.properties);
        const createdDateVal = toTaiwanDateStr(p.created_time);
        const finalDate = datePropVal || createdDateVal;
        const isPaid = p.properties['繳費?']?.checkbox || false;

        const officialPlan = getOfficialPlan(name);
        const mInfo = memberNameMap[name] || memberPlanMap[uId] || { planType: officialPlan, remainingCount: 10, memberPageId: null };
        const resolvedPlan = mInfo.planType || officialPlan;

        if (activeDate === 'all' || (finalDate && finalDate.startsWith(activeDate))) {
          const noshowCount = (noshowCounts[name] || 0) + (uId ? (noshowCounts[uId] || 0) : 0);
          const isBlacklisted = noshowCount >= 2;

          list.push({
            id: p.id,
            name,
            userId: uId,
            date: finalDate,
            createdTime: p.created_time,
            status,
            isPaid,
            memberPageId: mInfo.memberPageId,
            remainingCount: mInfo.remainingCount,
            planType: resolvedPlan,
            noshowCount,
            isBlacklisted
          });
        }
      });

      const allPlayersList = Object.values(playerStatsMap);
      const sortedYear = [...allPlayersList].sort((a, b) => b.year2026Count - a.year2026Count);
      const year2026King = sortedYear[0] && sortedYear[0].year2026Count > 0 ? sortedYear[0] : null;

      // D-02/D-03/D-04: tally per-date 零打 race wins (from casualWinnerByDate,
      // populated year-wide above), tie-break most wins -> most recent lastWinDate
      // -> name.localeCompare, for determinism.
      const casualWinTally = {};
      Object.values(casualWinnerByDate).forEach(entry => {
        if (!casualWinTally[entry.name]) {
          casualWinTally[entry.name] = { name: entry.name, wins: 0, lastWinDate: '' };
        }
        casualWinTally[entry.name].wins += 1;
      });
      Object.entries(casualWinnerByDate).forEach(([date, entry]) => {
        const t = casualWinTally[entry.name];
        if (t && (!t.lastWinDate || date > t.lastWinDate)) {
          t.lastWinDate = date;
        }
      });
      const sortedCasualTally = Object.values(casualWinTally).sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.lastWinDate !== a.lastWinDate) return b.lastWinDate.localeCompare(a.lastWinDate);
        return a.name.localeCompare(b.name);
      });
      const fastestCasualLeader = sortedCasualTally[0] && sortedCasualTally[0].wins > 0 ? sortedCasualTally[0] : null;

      const sortedStreak = [...allPlayersList].sort((a, b) => b.streakCount - a.streakCount);
      const streakKing = sortedStreak[0] && sortedStreak[0].streakCount > 0 ? sortedStreak[0] : null;

      const sortedMonth = [...allPlayersList].sort((a, b) => b.monthCount - a.monthCount);
      const monthLeader = sortedMonth[0] && sortedMonth[0].monthCount > 0 ? sortedMonth[0] : null;

      const funBanners = {
        year2026King: year2026King ? { name: year2026King.name, count: year2026King.year2026Count, planType: year2026King.planType } : null,
        fastestCasual: fastestCasualLeader ? { name: fastestCasualLeader.name, wins: fastestCasualLeader.wins, lastWinDate: fastestCasualLeader.lastWinDate } : null,
        streakKing: streakKing ? { name: streakKing.name, streak: streakKing.streakCount, planType: streakKing.planType } : null,
        monthLeader: monthLeader ? { name: monthLeader.name, count: monthLeader.monthCount, planType: monthLeader.planType } : null
      };

      return res.status(200).json({
        success: true,
        activeDate,
        availableDates,
        attendance: list,
        members: Object.values(memberIdToPageId),
        prepaidCyclesMap,
        funBanners
      });
    }

    // 2. POST api/members/add
    if (req.method === 'POST' && path === 'members/add') {
      const { name, planType = '儲值', count = 10 } = req.body;
      if (!name) {
        return res.status(400).json({ success: false, error: 'Missing member name' });
      }

      const properties = {
        'item': {
          title: [{ text: { content: 'A' } }]
        },
        'Name': {
          email: name
        },
        'Type': {
          rich_text: [{ text: { content: 'A' } }]
        },
        '繳費類型': {
          rich_text: [{ text: { content: planType } }]
        },
        'Number': {
          number: parseInt(count, 10) || 0
        }
      };

      const newPage = await createNotionPage(MEMBERS_DB_ID, properties);
      return res.status(200).json({ success: true, memberPageId: newPage.id, name, planType, count });
    }

    // 3. POST api/members/renew
    if (req.method === 'POST' && path === 'members/renew') {
      const { memberPageId, addCount = 10, amount = 0 } = req.body;
      if (!memberPageId) {
        return res.status(400).json({ success: false, error: 'Missing memberPageId' });
      }

      const page = await getNotionPage(memberPageId);
      const currentCount = page.properties['Number'] ? (page.properties['Number'].number ?? 0) : 0;
      const newCount = currentCount + parseInt(addCount, 10);

      await updateNotionPage(memberPageId, {
        'Number': { number: newCount }
      });

      return res.status(200).json({ success: true, memberPageId, newCount, amount });
    }

    // 4. POST api/attendance/update
    if (req.method === 'POST' && path === 'attendance/update') {
      const { pageId, status, memberPageId, currentStatus } = req.body;
      if (!pageId || !status) {
        return res.status(400).json({ success: false, error: 'Missing pageId or status' });
      }

      await updateNotionPage(pageId, {
        '出席情況': { select: { name: status } }
      });

      let newCount = null;

      if (memberPageId && memberPageId !== 'null') {
        try {
          const page = await getNotionPage(memberPageId);
          const planType = getPlainText(page.properties['繳費類型']) || '儲值';
          
          if (planType === '儲值' || planType === '預繳10次') {
            const currentCount = page.properties['Number'] ? (page.properties['Number'].number ?? 0) : 0;

            if (status === '已出席' && currentStatus !== '已出席') {
              newCount = Math.max(0, currentCount - 1);
              await updateNotionPage(memberPageId, { 'Number': { number: newCount } });
            } else if (currentStatus === '已出席' && status !== '已出席') {
              newCount = currentCount + 1;
              await updateNotionPage(memberPageId, { 'Number': { number: newCount } });
            }
          }
        } catch (e) {
          console.warn('Member count update skipped:', memberPageId);
        }
      }

      return res.status(200).json({ success: true, pageId, status, newCount });
    }

    // 5. POST api/attendance/batch-update
    if (req.method === 'POST' && path === 'attendance/batch-update') {
      const { items, status } = req.body;
      if (!Array.isArray(items) || !status) {
        return res.status(400).json({ success: false, error: 'Invalid items or status' });
      }

      // Soft internal deadline so the handler always answers instead of
      // being killed mid-flight: if the budget runs out, stop claiming new
      // items and honestly report the remainder as skipped rather than
      // dying with an opaque 504.
      const startedAt = Date.now();
      const BATCH_BUDGET_MS = 50000;

      let updatedCount = 0;
      const failed = [];
      const skipped = [];
      let cursor = 0;

      async function processItem(item) {
        const { pageId, memberPageId, currentStatus } = item;

        if (!pageId || pageId === 'dummy' || pageId.length < 20) {
          skipped.push(pageId);
          return;
        }

        try {
          // Retry the 出席情況 PATCH up to 2x, but ONLY on a 429. A 429 means
          // Notion did not apply the write, so retrying cannot double-apply it.
          let attempt = 0;
          while (true) {
            await acquireNotionSlot();
            try {
              await updateNotionPage(pageId, { '出席情況': { select: { name: status } } });
              break;
            } catch (err) {
              const msg = err && err.message ? err.message : String(err);
              if (attempt < 2 && /\(429\)/.test(msg)) {
                attempt++;
                await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
                continue;
              }
              throw err;
            }
          }
          updatedCount++;

          if (memberPageId && memberPageId !== 'null' && memberPageId !== 'undefined' && memberPageId.length >= 20) {
            // Skip the wasted member-page GET when neither boundary crossing
            // can happen regardless of planType.
            const crossesBoundary =
              (status === '已出席' && currentStatus !== '已出席') ||
              (currentStatus === '已出席' && status !== '已出席');
            if (crossesBoundary) {
              try {
                await acquireNotionSlot();
                const page = await getNotionPage(memberPageId);
                const planType = getPlainText(page.properties['繳費類型']) || '儲值';
                if (planType === '儲值' || planType === '預繳10次') {
                  const currentCount = page.properties['Number'] ? (page.properties['Number'].number ?? 0) : 0;
                  if (status === '已出席' && currentStatus !== '已出席') {
                    const newCount = Math.max(0, currentCount - 1);
                    await acquireNotionSlot();
                    await updateNotionPage(memberPageId, { 'Number': { number: newCount } });
                  } else if (currentStatus === '已出席' && status !== '已出席') {
                    const newCount = currentCount + 1;
                    await acquireNotionSlot();
                    await updateNotionPage(memberPageId, { 'Number': { number: newCount } });
                  }
                }
              } catch (e) {
                // Best-effort only: a failure to adjust remaining-session
                // count must not mark the attendance item as failed.
                console.warn('Batch member count update skipped for:', memberPageId);
              }
            }
          }
        } catch (err) {
          failed.push({ pageId, error: String(err && err.message ? err.message : err) });
          console.warn('Batch item failed for:', pageId, err);
        }
      }

      async function worker() {
        while (true) {
          if (Date.now() - startedAt > BATCH_BUDGET_MS) {
            while (cursor < items.length) {
              skipped.push(items[cursor].pageId);
              cursor++;
            }
            return;
          }
          if (cursor >= items.length) return;
          const item = items[cursor++];
          await processItem(item);
        }
      }

      // Bounded worker pool: caps in-flight items at 3 while acquireNotionSlot
      // caps the outbound request RATE. A worker body never rejects, so
      // awaiting Promise.all on the workers is safe.
      const workerCount = Math.min(3, items.length);
      const workers = [];
      for (let w = 0; w < workerCount; w++) workers.push(worker());
      await Promise.all(workers);

      const payload = { success: true, updatedCount, status, failed, skipped };
      if (updatedCount === 0 && failed.length > 0) {
        payload.success = false;
        payload.error = `批次更新失敗（${failed.length} 筆）：${failed[0].error}`;
      }
      return res.status(200).json(payload);
    }

    // 6. POST api/attendance/update-date
    if (req.method === 'POST' && path === 'attendance/update-date') {
      const { pageId, date } = req.body;
      if (!pageId || !date) {
        return res.status(400).json({ success: false, error: 'Missing pageId or date' });
      }

      const page = await getNotionPage(pageId);
      let datePropName = null;
      for (const key in page.properties) {
        if (page.properties[key] && page.properties[key].type === 'date') {
          datePropName = key;
          break;
        }
      }

      if (!datePropName) {
        return res.status(400).json({ success: false, error: 'No date property found in Notion page' });
      }

      await updateNotionPage(pageId, {
        [datePropName]: {
          date: { start: date }
        }
      });

      return res.status(200).json({ success: true, pageId, date });
    }

    return res.status(404).json({ success: false, error: `Route not found: ${req.method} ${path}` });
  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
