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
const OFFICIAL_PREPAID = ['糖果寶', '淑湘', '賓哥', 'Sam', '小潘', '小卉', '銘仁', '為欽', '羽辰', '世昌', '文和', '智文', '浩騰', 'Justin', '進宗', '庭偉', '柏村', '昆疆', '牧民', 'Gary', '弘峻', '慶鴻'];

function getOfficialPlan(name) {
  if (OFFICIAL_YEARLY.includes(name)) return '年繳';
  if (OFFICIAL_MONTHLY.includes(name)) return '月繳';
  if (OFFICIAL_PREPAID.includes(name)) return '儲值';
  return '儲值';
}

async function queryAllNotionDatabase(dbId, maxPages = 10) {
  let allResults = [];
  let hasMore = true;
  let nextCursor = undefined;
  let pageCount = 0;

  while (hasMore && pageCount < maxPages) {
    pageCount++;
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
    .filter(h => h.status === '已出席' || h.status === '報名成功' || h.status === '已報名')
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const cycles = [];
  let currentCycle = null;

  validAttendances.forEach((item, index) => {
    const cycleIndex = Math.floor(index / 10) + 1;
    const positionInCycle = (index % 10) + 1;

    if (positionInCycle === 1) {
      currentCycle = {
        cycleNum: cycleIndex,
        startDate: item.date,
        endDate: null,
        isCompleted: false,
        totalDays: 0,
        year: item.date.slice(0, 4),
        items: [{ sessionNo: 1, date: item.date, status: item.status, id: item.id }]
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

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { path } = req.query;

  try {
    // 1. GET api/attendance
    if (req.method === 'GET' && path === 'attendance') {
      const targetDate = req.query.date || '';
      const currentYear = '2026';
      const currentMonthPrefix = '2026-08';
      const realTodayStr = toTaiwanDateStr(new Date().toISOString());
      
      const attendanceResults = await queryAllNotionDatabase(ATTENDANCE_DB_ID, 10);
      const memberResults = await queryAllNotionDatabase(MEMBERS_DB_ID, 3);

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
          remainingCount: count
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

      attendanceResults.forEach(p => {
        const attendanceStatus = getPlainText(p.properties['出席情況']);
        const originStatus = getPlainText(p.properties['Status']) || '已報名';
        
        let status = attendanceStatus || originStatus;
        if (status === '放鳥') status = '未到';
        if (status === '取消報名' || status === '報名取消') return;

        const name = (getPlainText(p.properties['姓名(Name)'])).trim();
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
        const mInfo = memberPlanMap[uId] || memberNameMap[name] || { planType: officialPlan, remainingCount: 10 };
        const resolvedPlan = mInfo.planType || officialPlan;

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

        playerStatsMap[name].history.push({
          date: finalDate,
          status,
          id: p.id
        });

        if (status === '已出席' || status === '報名成功' || status === '已報名') {
          if (finalDate.startsWith(currentYear)) {
            playerStatsMap[name].year2026Count += 1;
            if (finalDate.startsWith(currentMonthPrefix)) {
              playerStatsMap[name].monthCount += 1;
            }
          }
        }
      });

      const prepaidCyclesMap = {};

      Object.values(playerStatsMap).forEach(p => {
        let currentStreak = 0;
        let maxStreak = 0;
        const sorted2026Hist = [...p.history]
          .filter(h => h.date.startsWith(currentYear))
          .sort((a, b) => new Date(a.date) - new Date(b.date));

        sorted2026Hist.forEach(h => {
          if (h.status === '已出席' || h.status === '報名成功' || h.status === '已報名') {
            currentStreak += 1;
            if (currentStreak > maxStreak) maxStreak = currentStreak;
          } else if (h.status === '未到') {
            currentStreak = 0;
          }
        });
        p.streakCount = maxStreak;

        if (OFFICIAL_PREPAID.includes(p.name)) {
          prepaidCyclesMap[p.name] = calculatePrepaidCycles(p.history);
        }
      });

      const availableDates = Object.keys(dateCounts)
        .sort((a, b) => new Date(b) - new Date(a))
        .map(d => ({ date: d, count: dateCounts[d] }));

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

        const name = (getPlainText(p.properties['姓名(Name)'])).trim();
        if (!name || name === '5' || !isNaN(name)) return;

        const uId = getPlainText(p.properties['userId']);
        const datePropVal = getDatePropVal(p.properties);
        const createdDateVal = toTaiwanDateStr(p.created_time);
        const finalDate = datePropVal || createdDateVal;
        const isPaid = p.properties['繳費?']?.checkbox || false;

        const officialPlan = getOfficialPlan(name);
        const mInfo = memberPlanMap[uId] || memberNameMap[name] || { planType: officialPlan, remainingCount: 10, memberPageId: null };
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

      const casualRegistrars = list
        .filter(item => (item.planType === '儲值' || item.planType === '預繳10次' || !item.planType) && item.date.startsWith(currentYear))
        .sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));
      const fastestCasualPlayer = casualRegistrars[0] || null;

      const sortedStreak = [...allPlayersList].sort((a, b) => b.streakCount - a.streakCount);
      const streakKing = sortedStreak[0] && sortedStreak[0].streakCount > 0 ? sortedStreak[0] : null;

      const sortedMonth = [...allPlayersList].sort((a, b) => b.monthCount - a.monthCount);
      const monthLeader = sortedMonth[0] && sortedMonth[0].monthCount > 0 ? sortedMonth[0] : null;

      const funBanners = {
        year2026King: year2026King ? { name: year2026King.name, count: year2026King.year2026Count, planType: year2026King.planType } : null,
        fastestCasual: fastestCasualPlayer ? { name: fastestCasualPlayer.name, time: fastestCasualPlayer.createdTime } : null,
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

      let updatedCount = 0;
      const promises = items.map(async (item) => {
        const { pageId, memberPageId, currentStatus } = item;
        if (!pageId || pageId === 'dummy' || pageId.length < 20) return;

        await updateNotionPage(pageId, {
          '出席情況': { select: { name: status } }
        });
        updatedCount++;

        if (memberPageId && memberPageId !== 'null' && memberPageId !== 'undefined' && memberPageId.length >= 20) {
          try {
            const page = await getNotionPage(memberPageId);
            const planType = getPlainText(page.properties['繳費類型']) || '儲值';
            if (planType === '儲值' || planType === '預繳10次') {
              const currentCount = page.properties['Number'] ? (page.properties['Number'].number ?? 0) : 0;

              if (status === '已出席' && currentStatus !== '已出席') {
                const newCount = Math.max(0, currentCount - 1);
                await updateNotionPage(memberPageId, { 'Number': { number: newCount } });
              } else if (currentStatus === '已出席' && status !== '已出席') {
                const newCount = currentCount + 1;
                await updateNotionPage(memberPageId, { 'Number': { number: newCount } });
              }
            }
          } catch (e) {
            console.warn('Batch member count update skipped for:', memberPageId);
          }
        }
      });

      await Promise.all(promises);
      return res.status(200).json({ success: true, updatedCount, status });
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
