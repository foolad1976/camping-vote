# 億載金城露營投票

以億載金城為中心、車程 1 到 4 小時的露營區介紹、地圖與投票網頁。
朋友打開網址就能投票、新增或編輯清單外的營區，**不需要任何帳號**。

- 網頁：GitHub Pages（這個資料夾）
- 票數與同伴新增的營區：主揪的 Google 試算表（透過 Google Apps Script）

## Google 網站入口（GitHub Pages 連線異常時）

現在原本的 Apps Script 部署也提供完整網站：在 `config.js` 的 `apiUrl` 後加上 `?page=camp` 即可開啟。網頁樣式、營區清單與程式已打包進 `apps-script/Site.html`，不依賴 `github.io`，投票與網址讀取使用同一套驗證規則及原試算表。

更新此入口：先執行 `node dev/build-hosted-page.js` 與 `node dev/build-backend.js`，將產生的後端程式與 `Site.html` 同步到 Apps Script，然後更新既有部署的新版本。Google 網頁內部以 `google.script.run` 呼叫 `campRequest`，避免跨來源傳輸問題。更換網站網域不會刪除既有票數，但瀏覽器的裝置識別碼各網域獨立。

## 第一次設定（約 10 分鐘）

### 第 1 步：建立試算表和後端

1. 到 Google 試算表建立一份新的空白試算表，名稱取「露營投票資料」。
2. 選單「擴充功能」→「Apps Script」。
3. 執行 `node dev/build-backend.js`，把產生的 `dev/backend-release.gs` 全部內容貼到 Apps Script 編輯器，取代原程式並存檔。它包含 `Catalog.gs`、`Code.gs` 與 `Importer.gs`，支援完整營區清單與公開網址辨識。
4. 上方函式選單選 `setup`，按「執行」。第一次會跳出授權視窗：
   - 選你的 Google 帳號。
   - 出現「Google 尚未驗證這個應用程式」時，點「進階」→「前往（不安全）」→「允許」。
     這是因為程式是你自己寫的、沒送 Google 審查，程式只會讀寫這一份試算表。
   - 執行紀錄出現「設定完成」就好，試算表會多出 votes、proposals、history 三個工作表。
5. 右上角「部署」→「新增部署作業」→ 左邊齒輪選「網頁應用程式」：
   - 說明：`露營投票`
   - 執行身分：**我**
   - 誰可以存取：**所有人**
   - 按「部署」（若又跳出授權，照上一步允許）。
6. 複製「網頁應用程式」網址（`https://script.google.com/macros/s/.../exec`）。
7. 把網址貼到瀏覽器打開，看到 `{"ok":true,...}` 就表示後端正常。

工作表由 `setup` 自動建立，**不用自己建**，也不要改欄位順序。

### 第 2 步：填網址

打開 `config.js`，把上一步的網址貼進 `apiUrl`：

```js
window.CAMP_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/xxxxxxxx/exec',
};
```

### 第 3 步：發布到 GitHub Pages

1. 在 GitHub 建一個新的 repository（例如 `camp-vote`，Public）。
2. 把這個資料夾推上去（`git push`）。
3. repository 的「Settings」→「Pages」→ Source 選「Deploy from a branch」→ Branch 選 `main`、資料夾 `/ (root)` → Save。
4. 一兩分鐘後網址會是 `https://你的帳號.github.io/camp-vote/`，把這個網址貼到 LINE 群組就好。

## 日常管理

- **看票數**：直接開試算表。
- **刪掉亂投的票或亂加的營區**：在試算表刪掉那一列。網頁上任何人都不能刪除營區。
- **營區被亂改**：`history` 工作表有每次修改前（`before`）和修改後（`after`）的內容，照 `before` 改回 `proposals` 那一列即可。
- **改了 `Code.gs` 之後**：Apps Script「部署」→「管理部署作業」→ 編輯（鉛筆）→ 版本選「新版本」→ 部署。這樣網址不會變，不用改 `config.js`。

## 規則與限制

- 同一支手機（同一個瀏覽器）算一票，改票會覆蓋舊的。換手機或清除瀏覽器資料就能再投一次，主揪可以在試算表刪掉重複的票。
- 投票要填暱稱，名單上會顯示。
- 任何人都能新增營區（每支手機最多 5 個）、編輯同伴新增的營區；精選清單由主揪維護，目前1／2／3／4小時圈各有10／10／11／10個營區，另外保留1個彩蛋。
- 「推薦私房營地」不受篩選影響，手機底部也有「推薦」入口。可直接填寫，或貼上公開 HTTPS 網址，先預覽辨識結果、帶入空白欄位，再確認新增。自動讀取不會覆蓋已填內容，也不會直接新增營區；需登入、拒絕讀取或無可用內容的網站可手動填寫。
- 網址辨識使用公開頁面的結構化資料、標題與描述，不使用生成式 AI 推測營地資料。後端使用 UrlFetchApp，首次更新時需授權外部網頁讀取；保留原本的試算表與部署網址。
- 防灌票：每支手機每分鐘最多送出 12 次、全站每分鐘 150 次；票最多 300 筆、同伴營區最多 60 個。數字可在 `Code.gs` 開頭調整。

## 本機測試（開發用）

```
node dev/mock-server.js
```

打開 <http://localhost:8787>，會用記憶體裡的假試算表執行 `apps-script/Code.gs`，不會動到真的試算表。

執行 `node dev/verify-api.js` 驗證全部營區投票、私房營地新增／修改／投票，以及網址辨識的成功與失敗情境。本機網址讀取使用固定測試網頁，不會向外部網站送出測試請求。

營地研究資料放在 `dev/research/`，每筆保留回饋與來源年代。修改後執行 `node dev/build-catalog.js`，同時更新 `camps.js` 與後端 `apps-script/Catalog.gs`；再執行 `node dev/build-backend.js` 更新 Apps Script 並以新版本部署，最後發布 GitHub Pages。兩端營區ID必須一致，舊ID要保留以延續既有票數。
