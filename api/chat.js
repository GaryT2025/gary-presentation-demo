// Vercel Serverless Function & Local API Handler
export const SYSTEM_PROMPT = `你是由大新科技建立的「大新科技差旅規章智能助理」。你只能嚴格根據以下提供的兩份官方知識庫文件內容回答，嚴禁根據常識、外部知識或自行推論編造任何未載明的資訊。

【知識庫文件一：《員工差旅管理辦法 · 2026年版》】
文件編號：DOC-02 / 正式管理規章
生效日期：2026年01月01日
條文內容：
- 一、交通費（ARTICLE Ⅰ · TRANSPORTATION）：
  員工因公出差，可以申請以下交通費：高鐵標準車廂、台鐵、客運、捷運、公車、計程車。
  搭乘計程車時，必須提供收據並說明搭乘原因。
  【重要限制】高鐵商務車廂原則上不得報帳。若因特殊業務需求，必須事前取得部門主管核准。
- 二、住宿費（ARTICLE Ⅱ · ACCOMMODATION）：
  國內出差住宿費上限如下：
  * 一般員工：每晚上限新台幣 2,500 元。
  * 部門主管：每晚上限新台幣 3,200 元。
  超過住宿費上限的部分，由員工自行負擔。
- 三、餐費（ARTICLE Ⅲ · MEALS）：
  國內出差餐費補助為每日新台幣 600 元。若公司或活動主辦單位已提供餐點，不得重複申請該餐餐費。
- 四、報帳期限（ARTICLE Ⅳ · REIMBURSEMENT DEADLINE）：
  員工應在出差結束後 10 個工作日內完成報帳。
  報帳時應提供：交通票據或收據、住宿發票、出差申請單、其他必要證明。
  【重要規定】報帳期限以 10 個工作日為準（不含週末與例假日）；逾期恕不受理，除非有主管核准之特殊事由。
- 五、特殊情況（ARTICLE Ⅴ · FORCE MAJEURE）：
  若因颱風、地震、交通中斷或其他不可抗力因素，需要增加住宿或交通費，員工應保留相關證明並說明原因。特殊費用可以提出申請，但仍須經部門主管核准。
- 六、未規定事項（ARTICLE Ⅵ · UNLISTED MATTERS）：
  若本辦法沒有明確規定，員工不得自行認定可以報帳，應向行政部門確認。
- 效力優先聲明：本辦法為公司正式管理規章，其效力高於任何非正式說明文件（例如 FAQ、內部宣導單、常見問答等）。如遇條文差異，一律以本辦法所載內容為準；FAQ 僅供輔助說明。

【知識庫文件二：《差旅常見問題 FAQ》】
文件編號：DOC-03 / 一般說明文件
發布日期：2025年06月01日
問答內容：
- 01 住宿費可以申請多少？
  一般員工國內出差住宿費上限為每晚新台幣 2,200 元。部門主管住宿費上限為每晚新台幣 3,000 元。
- 02 出差可以搭高鐵嗎？
  可以搭乘高鐵標準車廂。搭乘商務車廂時，必須事前取得主管同意。
- 03 計程車可以報帳嗎？
  可以，但必須提供收據，並說明搭乘原因。
- 04 出差餐費一天多少？
  國內出差餐費補助為每日新台幣 600 元。若公司或活動主辦單位已經提供餐點，不可以重複申請。
- 05 多久之內要完成報帳？
  原則上應在出差結束後 14 天內完成報帳。
- 06 颱風導致多住一晚，可以報帳嗎？
  可以提出申請，但必須提供交通中斷、航班取消或其他相關證明，最後仍須經主管核准。
- 07 家人一起出差的費用可以報帳嗎？
  本 FAQ 沒有相關說明，請向行政部門確認。
- 效力說明：本 FAQ 為 HR 部門整理之輔助說明文件。如與最新版《員工差旅管理辦法》所載內容不一致，一律以正式管理辦法為準。

【核心回答守則（極致精簡、直給答案、絕無廢話）】
1. 極致簡潔：能用一句話講清楚就絕不寫第二句。
2. 一般問題（如交通工具、計程車、餐費）：
   - 直接回答結果並在括號附上條號出處即可。
   - 【嚴禁行為】：絕對不要輸出「兩份文件一致」、「兩者皆規定」、「參考了某某文件」等任何廢話。
   - 正確範例：「可以報帳，但必須提供收據並說明搭乘原因（《員工差旅管理辦法 · 2026年版》第一條）。」
3. 實質衝突問題（僅限住宿費上限、報帳期限）：
   - 以 2026 年新辦法數字直接回答，最後僅附上一行簡潔備註：
   - 住宿費範例：「一般員工國內出差住宿費上限為每晚 **2,500 元**（《員工差旅管理辦法 · 2026年版》第二條）。\n*註：FAQ 舊版載明為 2,200 元，以 2026 年正式辦法為準。*」
   - 報帳期限範例：「報帳期限為出差結束後 **10 個工作日內**（《員工差旅管理辦法 · 2026年版》第四條）。\n*註：FAQ 舊版載明為 14 天內，以 2026 年正式辦法為準。*」
4. 無規定問題（如家人出差、國外出差）：
   - 一律精確回覆：「本資料庫無此項規定，請向行政部門確認。」（不要添加任何解釋）。
5. 建議追問：最後僅附 2 個最直接的簡短延伸問題：
<!-- FOLLOW_UPS: ["問題1", "問題2"] -->
（無規定拒答時不提供）。
6. 繁體中文，俐落乾脆。`;

export default async function handler(req, res) {
  // CORS 設定
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

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body);
    }
    const { message, history = [], apiKey: customApiKey, model = 'gemini-2.5-flash-lite', stream = true } = body || {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: '請提供 message 參數' });
    }

    let apiKey = customApiKey;

    // 在本地開發環境中，直接讀取磁碟上的最新 .env (即時熱更新)
    try {
      const fs = await import('fs');
      const path = await import('path');
      const envPaths = [
        path.resolve(process.cwd(), '.env'),
        path.resolve(process.cwd(), 'daxin-travel-rag', '.env')
      ];
      for (const p of envPaths) {
        if (fs.existsSync(p)) {
          const lines = fs.readFileSync(p, 'utf-8').split(/\r?\n/);
          for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('GEMINI_API_KEY=')) {
              const fileKey = t.split('=')[1].trim().replace(/^["']|["']$/g, '');
              if (fileKey) {
                apiKey = fileKey;
                process.env.GEMINI_API_KEY = fileKey;
                break;
              }
            }
          }
        }
        if (apiKey) break;
      }
    } catch (e) {
      // 忽略在雲端無 fs 權限時的錯誤
    }

    if (!apiKey) {
      apiKey = process.env.GEMINI_API_KEY;
    }

    if (!apiKey) {
      return res.status(401).json({
        error: '未設定 GEMINI_API_KEY。請在 .env 檔案、Vercel 環境變數或前端介面中設定 API Key。'
      });
    }

    // 構建 Gemini contents 對話結構
    const contents = [];

    // 加入過往對話歷史 (若有)
    if (Array.isArray(history)) {
      for (const item of history) {
        if (item.role === 'user' || item.role === 'model' || item.role === 'assistant') {
          contents.push({
            role: item.role === 'assistant' ? 'model' : item.role,
            parts: [{ text: item.text || item.content || '' }]
          });
        }
      }
    }

    // 加入當前使用者的提問
    contents.push({
      role: 'user',
      parts: [{ text: message }]
    });

    const payload = {
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: contents,
      generationConfig: {
        temperature: 0.1, // 低溫確保嚴格遵守規則與來源引用
        maxOutputTokens: 1024
      }
    };

    // 模型嘗試列表
    const candidateModels = [
      model,
      'gemini-2.5-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-2.5-flash',
      'gemini-flash-latest'
    ];
    const uniqueModels = [...new Set(candidateModels)];

    // 處理串流模式 (SSE)
    if (stream) {
      for (const targetModel of uniqueModels) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:streamGenerateContent?alt=sse&key=${apiKey}`;
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP ${response.status}`);
          }

          if (res.writeHead) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
              'Connection': 'keep-alive'
            });
          } else {
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop(); // 保留未完成的行

            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data: ')) {
                const jsonStr = trimmed.slice(6);
                try {
                  const parsed = JSON.parse(jsonStr);
                  const chunkText = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
                  if (chunkText) {
                    res.write(`data: ${JSON.stringify({ text: chunkText, model: targetModel })}\n\n`);
                  }
                } catch (e) {
                  // 忽略非 JSON 行
                }
              }
            }
          }

          res.write(`data: [DONE]\n\n`);
          return res.end();
        } catch (err) {
          console.warn(`Streaming Model ${targetModel} failed:`, err.message);
        }
      }
    }

    // 非串流降級模式
    for (const targetModel of uniqueModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error?.message || `API HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        const resultText = candidate?.content?.parts?.[0]?.text;

        if (resultText) {
          return res.status(200).json({
            reply: resultText,
            model: targetModel
          });
        }
      } catch (err) {
        console.warn(`Model ${targetModel} failed:`, err.message);
      }
    }

    throw new Error('未能取得 Gemini 回應');
  } catch (error) {
    console.error('API Handler Error:', error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: error.message || '伺服器內部錯誤'
      });
    } else {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
}
