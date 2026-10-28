# Grey — 雨天玻璃風聊天前端

純 HTML / CSS / JS，不需要建置。模糊的雨天窗外背景、毛玻璃泡泡、頭像、時間戳，以及可展開的「思考摘要」。

## 執行

```bash
python3 -m http.server 8000
# 打開 http://localhost:8000
```

（要用本機伺服器開，直接雙擊 `index.html` 的話 ES module 會被瀏覽器擋。）

## 功能

- **示範模式**：沒填 API Key 時用內建的回覆，可以先看效果。
- **接上 Claude**：右上角 ⚙ → 填入 API Key。預設模型 `claude-opus-5-5`，
  串流輸出，開啟 adaptive thinking 並顯示思考摘要；被安全分類器擋下時伺服器會自動換模型重試（`fallbacks: "default"`）。
- 對方的回覆會**一行拆成一個泡泡**，像一則一則傳訊息；可以連發好幾則，停下來約一秒後對方才回。
- 設定裡可以改對方名字、人設（system prompt）、思考強度、對方頭像、我的頭像、背景照片、模糊程度、黑白、雨滴動畫。
- 對話與設定都存在瀏覽器的 localStorage。

> API Key 只存在你的瀏覽器裡，並從瀏覽器直接呼叫 API。請只在自己的裝置上使用，不要部署成公開網站給別人用。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 版面與設定面板 |
| `style.css` | 毛玻璃泡泡與整體樣式 |
| `app.js` | 對話流程、Claude API 串流、設定 |
| `rain.js` | 背景街景與玻璃上的雨滴動畫 |
| `vendor/anthropic-sdk.js` | `@anthropic-ai/sdk` 1.3.0 打包成瀏覽器單檔（Apache-2.0） |
