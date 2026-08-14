// DOM Elements
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const clearChatBtn = document.getElementById('clearChatBtn');
const settingsToggleBtn = document.getElementById('settingsToggleBtn');
const settingsPanel = document.getElementById('settingsPanel');
const customApiKey = document.getElementById('customApiKey');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const keyStatus = document.getElementById('keyStatus');
const kbToggleBtn = document.getElementById('kbToggleBtn');
const kbModal = document.getElementById('kbModal');
const closeKbBtn = document.getElementById('closeKbBtn');
const testChips = document.querySelectorAll('.test-chip');
const sourceDrawer = document.getElementById('sourceDrawer');
const closeDrawerBtn = document.getElementById('closeDrawerBtn');
const drawerTitle = document.getElementById('drawerTitle');
const drawerBadge = document.getElementById('drawerBadge');
const drawerContent = document.getElementById('drawerContent');

// 完整原始法規條文資料庫 (供點擊標籤時彈出原文對照)
const ARTICLES_DB = {
  // 《員工差旅管理辦法 · 2026年版》 (DOC-02)
  '2026_1': {
    doc: '《員工差旅管理辦法 · 2026年版》 (DOC-02)',
    isOfficial: true,
    title: '第一條 · 交通費 (ARTICLE Ⅰ · TRANSPORTATION)',
    text: `員工因公出差，可以申請以下交通費：
• 高鐵標準車廂
• 台鐵
• 客運
• 捷運
• 公車
• 計程車

搭乘計程車時，必須提供收據並說明搭乘原因。

【重要限制】
高鐵商務車廂原則上不得報帳。若因特殊業務需求，必須事前取得部門主管核准。`
  },
  '2026_2': {
    doc: '《員工差旅管理辦法 · 2026年版》 (DOC-02)',
    isOfficial: true,
    title: '第二條 · 住宿費 (ARTICLE Ⅱ · ACCOMMODATION)',
    text: `國內出差住宿費上限如下：
• 一般員工：每晚上限新台幣 2,500 元
• 部門主管：每晚上限新台幣 3,200 元

超過住宿費上限的部分，由員工自行負擔。`
  },
  '2026_3': {
    doc: '《員工差旅管理辦法 · 2026年版》 (DOC-02)',
    isOfficial: true,
    title: '第三條 · 餐費 (ARTICLE Ⅲ · MEALS)',
    text: `國內出差餐費補助為每日新台幣 600 元。
若公司或活動主辦單位已提供餐點，不得重複申請該餐餐費。`
  },
  '2026_4': {
    doc: '《員工差旅管理辦法 · 2026年版》 (DOC-02)',
    isOfficial: true,
    title: '第四條 · 報帳期限 (ARTICLE Ⅳ · REIMBURSEMENT DEADLINE)',
    text: `員工應在出差結束後 10 個工作日內完成報帳。
報帳時應提供：
• 交通票據或收據
• 住宿發票
• 出差申請單
• 其他必要證明

【IMPORTANT】
報帳期限以 10 個工作日為準（不含週末與例假日）；逾期恕不受理，除非有主管核准之特殊事由。`
  },
  '2026_5': {
    doc: '《員工差旅管理辦法 · 2026年版》 (DOC-02)',
    isOfficial: true,
    title: '第五條 · 特殊情況 (ARTICLE Ⅴ · FORCE MAJEURE)',
    text: `若因颱風、地震、交通中斷或其他不可抗力因素，需要增加住宿或交通費，員工應保留相關證明並說明原因。
特殊費用可以提出申請，但仍須經部門主管核准。`
  },
  '2026_6': {
    doc: '《員工差旅管理辦法 · 2026年版》 (DOC-02)',
    isOfficial: true,
    title: '第六條 · 未規定事項 (ARTICLE Ⅵ · UNLISTED MATTERS)',
    text: `若本辦法沒有明確規定，員工不得自行認定可以報帳，應向行政部門確認。

【效力優先聲明】
本辦法為公司正式管理規章，其效力高於任何非正式說明文件（例如 FAQ、內部宣導單、常見問答等）。如遇條文差異，一律以本辦法所載內容為準；FAQ 僅供輔助說明。`
  },

  // 《差旅常見問題 FAQ》 (DOC-03)
  'faq_1': {
    doc: '《差旅常見問題 FAQ》 (DOC-03)',
    isOfficial: false,
    title: '問答 01 · 住宿費可以申請多少？',
    text: `一般員工國內出差住宿費上限為每晚新台幣 2,200 元。
部門主管住宿費上限為每晚新台幣 3,000 元。`
  },
  'faq_2': {
    doc: '《差旅常見問題 FAQ》 (DOC-03)',
    isOfficial: false,
    title: '問答 02 · 出差可以搭高鐵嗎？',
    text: `可以搭乘高鐵標準車廂。
搭乘商務車廂時，必須事前取得主管同意。`
  },
  'faq_3': {
    doc: '《差旅常見問題 FAQ》 (DOC-03)',
    isOfficial: false,
    title: '問答 03 · 計程車可以報帳嗎？',
    text: `可以，但必須提供收據，並說明搭乘原因。`
  },
  'faq_4': {
    doc: '《差旅常見問題 FAQ》 (DOC-03)',
    isOfficial: false,
    title: '問答 04 · 出差餐費一天多少？',
    text: `國內出差餐費補助為每日新台幣 600 元。
若公司或活動主辦單位已經提供餐點，不可以重複申請。`
  },
  'faq_5': {
    doc: '《差旅常見問題 FAQ》 (DOC-03)',
    isOfficial: false,
    title: '問答 05 · 多久之內要完成報帳？',
    text: `原則上應在出差結束後 14 天內完成報帳。`
  },
  'faq_6': {
    doc: '《差旅常見問題 FAQ》 (DOC-03)',
    isOfficial: false,
    title: '問答 06 · 颱風導致多住一晚，可以報帳嗎？',
    text: `可以提出申請，但必須提供交通中斷、航班取消或其他相關證明，最後仍須經主管核准。`
  },
  'faq_7': {
    doc: '《差旅常見問題 FAQ》 (DOC-03)',
    isOfficial: false,
    title: '問答 07 · 家人一起出差的費用可以報帳嗎？',
    text: `本 FAQ 沒有相關說明，請向行政部門確認。

【關於本文件】
本 FAQ 為 HR 部門整理之輔助說明文件，文件日期為 2025 年 6 月 1 日。如與最新版《員工差旅管理辦法》所載內容不一致，一律以正式管理辦法為準。`
  }
};

// App State
let conversationHistory = [];
let isGenerating = false;

// Initialize Settings
const savedKey = localStorage.getItem('DAXIN_GEMINI_KEY') || '';
if (savedKey) {
  customApiKey.value = savedKey;
  keyStatus.textContent = '已設定本地金鑰 (優先使用)';
}

// Event Listeners
settingsToggleBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});

saveKeyBtn.addEventListener('click', () => {
  const key = customApiKey.value.trim();
  if (key) {
    localStorage.setItem('DAXIN_GEMINI_KEY', key);
    keyStatus.textContent = '✅ API Key 已儲存至瀏覽器';
  } else {
    localStorage.removeItem('DAXIN_GEMINI_KEY');
    keyStatus.textContent = '已清除自訂 Key，將使用後端環境變數';
  }
  setTimeout(() => {
    settingsPanel.classList.add('hidden');
  }, 1200);
});

kbToggleBtn.addEventListener('click', () => {
  kbModal.classList.remove('hidden');
});

closeKbBtn.addEventListener('click', () => {
  kbModal.classList.add('hidden');
});

kbModal.addEventListener('click', (e) => {
  if (e.target === kbModal) {
    kbModal.classList.add('hidden');
  }
});

closeDrawerBtn.addEventListener('click', () => {
  sourceDrawer.classList.add('hidden');
});

clearChatBtn.addEventListener('click', () => {
  conversationHistory = [];
  chatMessages.innerHTML = `
    <div class="message-row bot-row">
      <div class="avatar bot-avatar">🤖</div>
      <div class="message-bubble bot-bubble">
        <p>對話已清空。您可以繼續提問關於《員工差旅管理辦法 2026年版》與《差旅常見問題 FAQ》的任何問題。</p>
      </div>
    </div>
  `;
});

// Auto-expand textarea
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
});

// Enter to send (Shift+Enter for newline)
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!isGenerating && userInput.value.trim()) {
      chatForm.dispatchEvent(new Event('submit'));
    }
  }
});

// Quick Test Chips
testChips.forEach(chip => {
  chip.addEventListener('click', () => {
    if (isGenerating) return;
    const query = chip.getAttribute('data-query');
    if (query) {
      userInput.value = query;
      userInput.style.height = 'auto';
      chatForm.dispatchEvent(new Event('submit'));
    }
  });
});

// Toast notification
function showToast(message) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2600);
}

// 開啟法規原文抽屜
function openSourceArticle(key) {
  const item = ARTICLES_DB[key];
  if (!item) {
    showToast('查無法規對應條文');
    return;
  }
  drawerTitle.textContent = item.title;
  drawerBadge.textContent = item.isOfficial ? '正式管理辦法 (最高效力)' : '輔助說明文件 (僅供參考)';
  drawerBadge.className = `doc-tag ${item.isOfficial ? 'doc-official' : 'doc-faq'}`;

  drawerContent.innerHTML = `
    <h4>${item.doc}</h4>
    <div style="white-space: pre-wrap; font-size: 0.92rem; line-height: 1.7; margin-top: 12px; color: #f1f5f9;">${item.text}</div>
    <div class="drawer-highlight-box">
      <strong>📌 效力原則提示：</strong><br>
      ${item.isOfficial ? '本條文為公司正式有效規章，如有與舊版或 FAQ 衝突，以此條文為準。' : '本項為 FAQ 常見問題輔助說明，正式規定仍以《員工差旅管理辦法 2026年版》為準。'}
    </div>
  `;
  sourceDrawer.classList.remove('hidden');
}

// 將 Markdown 中的法規出處包裝為可點擊超連結
function decorateCitations(html) {
  // 匹配 2026 辦法條文
  html = html.replace(/(《員工差旅管理辦法[^》]*》[^\s，。、<]*)/g, (match) => {
    let key = '2026_1';
    if (match.includes('二') || match.includes('住宿')) key = '2026_2';
    else if (match.includes('三') || match.includes('餐費')) key = '2026_3';
    else if (match.includes('四') || match.includes('報帳') || match.includes('期限')) key = '2026_4';
    else if (match.includes('五') || match.includes('特殊') || match.includes('颱風')) key = '2026_5';
    else if (match.includes('六') || match.includes('未規定')) key = '2026_6';
    return `<span class="citation-badge citation-badge-official" onclick="openSourceArticle('${key}')" title="點擊查看此條文原始規章全文">${match}</span>`;
  });

  // 匹配 FAQ 出處
  html = html.replace(/(《差旅常見問題[^》]*》[^\s，。、<]*)/g, (match) => {
    let key = 'faq_1';
    if (match.includes('02') || match.includes('高鐵')) key = 'faq_2';
    else if (match.includes('03') || match.includes('計程車')) key = 'faq_3';
    else if (match.includes('04') || match.includes('餐費')) key = 'faq_4';
    else if (match.includes('05') || match.includes('期限') || match.includes('14')) key = 'faq_5';
    else if (match.includes('06') || match.includes('颱風')) key = 'faq_6';
    else if (match.includes('07') || match.includes('家人')) key = 'faq_7';
    return `<span class="citation-badge citation-badge-faq" onclick="openSourceArticle('${key}')" title="點擊查看 FAQ 原始說明全文">${match}</span>`;
  });

  return html;
}

// 暴露到 window 供 onclick 調用
window.openSourceArticle = openSourceArticle;

// 解析建議追問清單
function extractFollowUps(rawText) {
  const match = rawText.match(/<!--\s*FOLLOW_UPS:\s*(\[.*?\])\s*-->/s);
  let followUps = [];
  let cleanText = rawText;
  if (match) {
    try {
      followUps = JSON.parse(match[1]);
      cleanText = rawText.replace(match[0], '').trim();
    } catch (e) {
      console.warn('Failed to parse follow ups', e);
    }
  }
  return { cleanText, followUps };
}

// Form Submit with Streaming
chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text || isGenerating) return;

  // Append user message
  appendUserMessage(text);
  userInput.value = '';
  userInput.style.height = 'auto';

  // Set Loading
  isGenerating = true;
  sendBtn.disabled = true;

  // 建立串流 Bot 訊息氣泡
  const botRow = document.createElement('div');
  botRow.className = 'message-row bot-row';

  const avatar = document.createElement('div');
  avatar.className = 'avatar bot-avatar';
  avatar.textContent = '🤖';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble bot-bubble streaming-cursor';
  bubble.innerHTML = `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;

  botRow.appendChild(avatar);
  botRow.appendChild(bubble);
  chatMessages.appendChild(botRow);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  let fullReplyText = '';

  try {
    const key = localStorage.getItem('DAXIN_GEMINI_KEY') || '';
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        history: conversationHistory,
        apiKey: key || undefined,
        stream: true
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    // 讀取 SSE 串流
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') break;
          try {
            const data = JSON.parse(dataStr);
            if (data.error) throw new Error(data.error);
            if (data.text) {
              fullReplyText += data.text;
              // 串流過程中即時更新部分 Markdown
              if (typeof marked !== 'undefined') {
                bubble.innerHTML = marked.parse(fullReplyText);
              } else {
                bubble.textContent = fullReplyText;
              }
              chatMessages.scrollTop = chatMessages.scrollHeight;
            }
          } catch (err) {
            if (dataStr !== '[DONE]') console.warn(err);
          }
        }
      }
    }

    // 串流結束，完成渲染
    finalizeBotMessage(bubble, fullReplyText);

    // 存入對話歷史
    conversationHistory.push({ role: 'user', content: text });
    conversationHistory.push({ role: 'assistant', content: fullReplyText });

  } catch (error) {
    bubble.classList.remove('streaming-cursor');
    bubble.innerHTML = `<p style="color:#f87171;">⚠️ <strong>發生錯誤</strong>：${error.message}</p><p style="font-size:0.8rem; color:#94a3b8; margin-top:4px;">提示：請檢查 .env 檔案中 GEMINI_API_KEY 是否正確，或點擊右上角「設定」重新輸入。</p>`;
  } finally {
    isGenerating = false;
    sendBtn.disabled = false;
    userInput.focus();
  }
});

function appendUserMessage(text) {
  const row = document.createElement('div');
  row.className = 'message-row user-row';

  const avatar = document.createElement('div');
  avatar.className = 'avatar user-avatar';
  avatar.textContent = '👤';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble user-bubble';
  bubble.textContent = text;

  row.appendChild(avatar);
  row.appendChild(bubble);
  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function finalizeBotMessage(bubble, rawText) {
  bubble.classList.remove('streaming-cursor');

  const { cleanText, followUps } = extractFollowUps(rawText);

  let parsedHtml = typeof marked !== 'undefined' ? marked.parse(cleanText) : `<p>${cleanText}</p>`;
  parsedHtml = decorateCitations(parsedHtml);

  // 操作列 (Like / Dislike / Copy)
  const actionsHtml = `
    <div class="message-actions-bar">
      <button class="btn-action btn-like" title="讚！回答很準確">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
        <span class="like-label">實用</span>
      </button>
      <button class="btn-action btn-dislike" title="有疑慮">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"></path></svg>
      </button>
      <button class="btn-action btn-copy" title="複製回答內容">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        <span>複製</span>
      </button>
    </div>
  `;

  // 建議追問氣泡 (Follow-up Chips)
  let followUpHtml = '';
  if (Array.isArray(followUps) && followUps.length > 0) {
    const chips = followUps.map(q => `<button class="followup-chip" onclick="triggerFollowUp('${q.replace(/'/g, "\\'")}')">💬 ${q}</button>`).join('');
    followUpHtml = `
      <div class="followup-container">
        <div class="followup-header">💡 您可能還想問：</div>
        <div class="followup-chips-list">${chips}</div>
      </div>
    `;
  }

  bubble.innerHTML = parsedHtml + actionsHtml + followUpHtml;

  // 綁定操作按鈕
  const likeBtn = bubble.querySelector('.btn-like');
  const dislikeBtn = bubble.querySelector('.btn-dislike');
  const copyBtn = bubble.querySelector('.btn-copy');

  if (likeBtn) {
    likeBtn.addEventListener('click', () => {
      likeBtn.classList.toggle('active-like');
      dislikeBtn?.classList.remove('active-dislike');
      if (likeBtn.classList.contains('active-like')) {
        showToast('👍 感謝您的回饋！');
      }
    });
  }

  if (dislikeBtn) {
    dislikeBtn.addEventListener('click', () => {
      dislikeBtn.classList.toggle('active-dislike');
      likeBtn?.classList.remove('active-like');
      if (dislikeBtn.classList.contains('active-dislike')) {
        showToast('⚠️ 已記錄回饋，我們會持續調優知識庫！');
      }
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(cleanText);
        showToast('📋 已複製回答內容到剪貼簿！');
      } catch (err) {
        showToast('複製失敗，請手動選取複製');
      }
    });
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function triggerFollowUp(question) {
  if (isGenerating) return;
  userInput.value = question;
  userInput.style.height = 'auto';
  chatForm.dispatchEvent(new Event('submit'));
}

window.triggerFollowUp = triggerFollowUp;
