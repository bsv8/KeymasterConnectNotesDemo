# Keymaster Connect Notes Demo

基于 Keymaster Connect V1 协议的加密笔记 demo。

## 项目定位

这是一个**外部调用方 demo**：单页前端，真值由 Keymaster 提供。它**不是**产品原型，
**不是**协作工具，**不是**离线缓存容器，**不是**某个 Keymaster 厂商的专属产品。

我们只做一件事：证明一个最小外部站点能

- 用 `connect.login` 拉起 Keymaster popup 完成首次登录并选定 key；
- 用 `connect.resume` 在页面刷新、popup 关闭重开、transport 抖动时恢复已授权的 session；
- 用 `connect.logout` 显式吊销 session 并退回登录壳；
- 用 `cipher.encrypt` / `cipher.decrypt` 真实加解密笔记正文（按 session 绑定 key 执行，**不**依赖全局 active key）；
- 用 folder/note 显式实体管理笔记结构；
- 把密文 + 元数据落到本地 KV（按 session 绑定 owner 分区）；
- 在不缓存明文的前提下，仍能保持"打开 → 编辑 → 保存"的闭环；
- 让用户选择**任意实现相同协议**的登录器（不再写死 Keymaster）。

## 登录真值：connect session（硬切换后的明确产品定义）

登录真值 = `connectSessionId`。owner 真值 = session 绑定的 `ownerPublicKeyHex`。
**不再**把 `identity.get` 当长期登录真值；**不再**靠 popup 窗口是否活着判断是否已登录。

### 行为定义

- 首次登录 → `connect.login`：popup 解锁 → 选 key → 返回 sessionId + ownerPublicKeyHex。
- 页面刷新 / popup refresh / transport 断线 → `connect.resume`：若 session
  仍在，只要求输入密码恢复 unlock，**不**重新选 key，**不**重新登录。
- 用户主动退出 → `connect.logout`：服务端吊销 + 清本地 session，回登录壳。
- 任何**非显式**路径（transport 抖动、popup 关闭、主站切 active key）都**不**清
  session；只把 transport 状态置为 `disconnected`，下次协议请求时优先 `resume`。

### 持久化边界

- 本地**只**持久化 `connectSessionRecord = { sessionId, ownerPublicKeyHex, targetOrigin, claimsSnapshot, resolvedAt }`。
- **不**持久化 popup transport 句柄、popup 解锁运行时、用户密码。
- popup 当前文档刷新后必须重新输入密码恢复 unlock。

## 页面结构（硬切换后）

页面顶层固定两态：

- 未登录：渲染 `LockScreen`（登录壳 / 恢复中 / 恢复失败 三种 mode）。
- 已登录：渲染 `Notes` 工作区。

不允许出现"未登录但显示 notes 工作区外壳"或"已登录但不渲染任何笔记内容"的
中间态。

### LockScreen

只承担三件事：

- 产品介绍 + 协议能力说明；
- 用户输入或确认 `target origin / url`；
- **根据 `mode` 区分**三种状态：
  - `"login"`：没有本地 session，显示真正登录入口；
  - `"resume"`：有本地 session，正在自动 / 手动 resume，提示用户等待；
  - `"resumeFailed"`：resume 失败 / 跨 origin / 本地记录损坏，显示"会话已失效，
    请重新登录"。
- 主按钮文案由"是否存在本地 session"决定（**不**由 `mode` 决定）：
  - 无本地 session → `登录`；
  - 有本地 session → `重新登录`。
- 有本地 session 且 targetOrigin 一致时，额外提供"恢复 session"入口；
  **不**再展示"忘掉当前 session"按钮（施工单 2026-06-28 003）：
  想换 key / 换 provider / 放弃当前本地 session 的用户，直接点"重新登录"。
- 大号主按钮 + 最近错误展示。

明确不展示任何 owner 数据摘要、文件树预览、最近登录记录。

#### 锁屏页 popup_closed 语义（硬切换硬约束）

- 锁屏页的 `popup_closed` **不**算用户可见错误：
  - 真实发生场景：用户手动关闭 popup / popup 在锁屏 / 用户这次不想继续；
  - 锁屏页**不**展示"popup 在协议完成前被关闭"横幅；
  - 锁屏页**不**清本地 session；
  - 用户下次再点主按钮时重新开 popup。
- 真实 `popup_blocked`（`window.open(...) === null`）仍必须展示给用户。
- transport 层对 `popup_blocked` / `popup_closed` 的判定**不**被改坏：
  - `popup_blocked` = `window.open(...)` 返回 `null`；
  - `popup_closed` = popup 曾经存在，但在协议完成前被关闭、刷新或失联。
- 收口只发生在 App 层的锁屏态 login / resume 流程；**不**下沉到 transport。

#### 重新登录 ≠ 先忘掉再登录

- 点击"重新登录"**不**预先调用 `clearConnectSession()`；
- 直接发起一次新的 `connect.login`：
  - 成功：用新 session 覆盖旧 session；
  - 失败：旧 session 不动，锁屏页仍可继续显示"恢复 session"。
- "重新登录"也**不**复用旧 sessionId 偷偷走 `connect.resume`——这是与"恢复 session"
  的明确边界。

### Notes 工作区

只在 `session !== null` 时渲染。硬切换后的页面结构：

```
app-header
app-banner        ← 应用级提示（error / decrypt / move）
workspace         ← 二栏 grid：sidebar | document-panel
  ├ sidebar
  │   ├ header（+ note / + 文件夹）
  │   ├ 搜索
  │   ├ tag 过滤
  │   ├ 简化 folder 工具条（仅 folder 选中时显示）
  │   └ 根目录 + folder/note 树 + 右键菜单 + 拖拽
  └ document-panel
      ├ document-toolbar   ← Notion 风格两排工具条
      ├ document-head      ← 大号 title
      └ document-editor    ← BlockNote 正文 / 失败态 / 空态
```

**不再**存在独立的右栏 `NoteInspector`：tag / 状态 / 保存 / 删除 / 放弃
修改全部上收至 `document-toolbar`。`title` 回到 `document-head`，与正文
视觉上是同一条文档。

页头 `ConnectStatus` 不再展示错误横条（已上收至 `app-banner`），仅承担：

- `page origin` / `target origin` / `publicKey` / `sessionId` / `last login` 信息；
- **恢复 session** 按钮（用本地 sessionId 调 `connect.resume`）；
- **重新登录** 按钮（从头走一次 `connect.login`，放弃当前 resume 尝试）；
- **退出登录** 按钮（调 `connect.logout` 吊销 session 并清本地，回 LockScreen）；
- **切换身份 / 更换登录器** 按钮，点击后立即退回 LockScreen，并清空内存中
  notes 工作区态（selection / draft / drag / move / 解密缓存 / pendingDrafts 等），
  但**不**删除 localStorage 中已有 owner 分区数据。
- **删除当前本地数据** 按钮，点击后走二次确认；确认后删除当前 `publicKey`
  对应的整个本地 notes 空间（folders + notes + 密文 + 明文 metadata），
  立即退回 LockScreen。**不会**删除 Keymaster 身份本身。

### 应用级 banner

`app-banner` 位于 `app-header` 与 `workspace` 之间，用于统一承接应用级提示：

- 错误（`lastError`，最高优先级）
- 解密失败摘要
- 移动模式提示
- 普通提示

同一时刻只显示最高优先级的一条；移动模式 / 错误横条右侧可带一个轻量操作
按钮（如"取消"）。`saveOverlay` 仍是阻塞遮罩，**不**被降级成 banner。

### 文档区结构

`document-panel` 内部固定为三段：

1. `document-toolbar`：Notion 风格两排工具条；轻量、克制，视觉权重**弱于** `title` 与正文。
   - 第一排：tag（`TagInput`） + 弱化说明；
   - 第二排：状态信息（`created` / `updated` / `contentType` / 密文长度 /
     未保存标记）+ 动作按钮（`加密保存` / `放弃修改` / `删除`）。
2. `document-head`：仅大号 `title` 输入框；与正文同轴线，视觉权重**强于**工具条，让标题看起来像文档本体的一部分。
3. `document-editor`：BlockNote 正文 / 失败态 / 空态。

### sidebar 结构

`sidebar` 从上到下为：

1. 顶部标题与新建按钮
2. 搜索框
3. tag 过滤
4. 当前选中 folder 的**简化**工具条（标题 + `updated` + 删除文件夹）
5. 根目录条目 + folder / note 树 + 右键菜单 + 拖拽

**不**在 sidebar 中重复显示 note 工具条——避免与 `document-toolbar` 形成
双入口。**不**在 sidebar 内显示移动模式横条（已挪至 `app-banner`）。

### 窄屏

窄屏（< 720px）下文件树支持手工展开 / 收起：

- `app-header` 出现"目录 / 收起目录"按钮；
- 用户点目录按钮：展开文件树；
- 用户再点：收起；
- 选中 root / folder / note 后文件树自动收起；
- 收起后正文区域不被多余空白占位；
- 工具条在窄屏下允许换行，但状态与按钮仍属同一排（`row--actions`），不会被
  拆回右侧独立栏。

## 删除当前本地数据（硬切换硬约束）

已登录态页头提供**唯一**删除入口：

- 删除对象 = `localStorage["notes-demo:owner:{publicKeyHex}"]`，**不**递归遍历
  note / folder；底层 key 本来就不存在时视为成功；
- 删除成功**后**才执行内存态清空并退回 `LockScreen`，顺序硬约束；
- 删除失败时**不**退回 `LockScreen`、**不**清空 `identity`、**不**清空工作区，
  仅展示 `删除当前本地数据失败，请重试。` 错误；
- 仅删除当前 owner 的本地数据；不删除 Keymaster 身份 / provider 账号 /
  链上身份 / 其它站点数据；
- 未登录态 `LockScreen` **不**展示任何删除入口。

`切换身份 / 更换登录器` 与 `删除当前本地数据` 的边界：

- 切换身份：只退回登录壳，**不**删数据；
- 删除当前本地数据：删当前 owner 整空间，再退回登录壳。

不引入 owner 列表、回收站、软删除、恢复机制、`targetOrigin + owner` 双因子分区、
IndexedDB / 多数据库方案。

## 启动方式

```bash
npm install
npm run dev          # 本地开发，http://localhost:5173
npm run typecheck    # 严格 typecheck
npm run build        # 生产构建（含 typecheck 前置）
npm run preview      # 预览生产构建
```

要求 Node 18+。

## 依赖的 Keymaster 能力

本 demo 调用以下协议方法：

| 方法 | 用途 |
|---|---|
| `connect.login` | 首次登录入口；用户选 key；返回 `connectSessionId + ownerPublicKeyHex + claimsSnapshot` |
| `connect.resume` | 恢复已授权的 session；不重新选 key；命中"需要解锁"时只要求输入密码 |
| `connect.logout` | 显式吊销 session；服务端吊销后回登录壳 |
| `cipher.encrypt` | 保存 note 时把 markdown UTF-8 字节加密为 nonce + cipherbytes；按 session 绑定 key 执行 |
| `cipher.decrypt` | 打开 note 时把密文还原为 markdown 明文；按 session 绑定 key 执行 |

不接入 `intent.sign` / `p2pkh.transfer` / `feepool.*` 等其它能力。

## 自定义登录器（target origin）

LockScreen 上允许用户输入任意 `target origin / url`：

- 输入框可填 `https://keymaster.cc` 之类的完整 URL，也可填可被 `new URL().origin`
  归一的字符串；
- 系统最终只使用 `URL().origin`；
- 默认值仍是 `https://keymaster.cc`，提供"使用默认地址"快捷入口；
- 非法 URL / 无法归一 → 直接阻断登录，提示 `Target origin 非法。`，
  不做自动修正、自动 fallback、自动重试。

本 demo 不维护：

- provider 列表 / 收藏夹；
- 最近使用记录；
- 协议能力自动探测；
- popup path 之外的路由发现。

## 刷新行为（硬切换后的明确产品定义）

刷新页面后：

- notes demo 读取本地 `connectSessionRecord`；
- 若**有**本地 sessionId 且 `targetOrigin` 与当前一致 → 自动 `connect.resume`：
  - session 仍在 → 直接进入工作区；
  - popup 当前未解锁 → 只要求输入密码；
  - 不重新选 key，不重新登录。
- 若**无**本地 sessionId / session 无效 / 跨 origin → 退回 `LockScreen`。

popup refresh 后只丢 unlock runtime：

- 不丢 connect session；
- 下次 notes 触发协议请求时 `connect.resume`，要求输入密码；
- 不回登录壳。

transport 断开后：

- 仅更新 transport 状态为 `disconnected`；
- **不**立即清本地 sessionId；
- **不**立即清 owner 分区；
- 下次需要协议请求时优先重建 popup 并 `resume`。

这是硬切换后的明确产品定义，不是缺陷。本 demo **不**支持：

- 把 `identity.get` 当长期登录真值；
- 把 popup transport 窗口是否还活着当成 auth session 是否还活着；
- "未登录但显示上次 owner 文件树"的半状态；
- 跨 origin 复用 session（必须重新 login）。

## owner 分区边界

notes 数据空间只按 session 绑定的 `ownerPublicKeyHex` 分区：

```txt
notes-demo:owner:{publicKeyHex}
```

`target origin` **不**参与分区：

- 同一个 owner 在不同登录器下命中同一份本地数据；
- 不同登录器返回同一个 owner 时，会看到同一棵树；
- 不同登录器返回不同 owner 时，看到对应 owner 的数据或空树。

"同 owner"仅保证本地命中同一分区，**不**保证一定能成功解密：

- 同 owner + 同私钥 + 协议兼容 → 正常打开 / 保存正文；
- 同 owner + 不能解密 → 左侧树仍可见，点击 note 进入"无法解密"态；
- 原密文不会被覆盖，note 仍允许删除。

## 数据模型

笔记结构由**显式 folder / note 实体**组成，**不再**用完整 path 作主键。

### folder

```ts
interface StoredFolderRecord {
  v: 1;
  id: string;
  parentId: string | null; // 根目录下文件夹为 null
  title: string;
  createdAt: number;
  updatedAt: number;
}
```

### note

```ts
interface StoredNoteRecord {
  v: 2;
  id: string;
  folderId: string | null; // 根目录下 note 为 null
  title: string;           // UI 心智上 = "文件名"
  tags: string[];          // 明文
  createdAt: number;
  updatedAt: number;
  cipher: {
    contentType: "keymaster.notes.markdown.v1";
    nonceBase64: string;
    cipherbytesBase64: string;
  };
}
```

### 容器

```ts
interface StoredNotesSpace {
  v: 1;
  folders: Record<string, StoredFolderRecord>;
  notes: Record<string, StoredNoteRecord>;
}
```

容器按 `ownerPublicKeyHex` 分区（`localStorage` key = `notes-demo:owner:{publicKeyHex}`）；
record 自身不重复携带 owner。

### 根目录

根目录是虚拟节点，用 `parentId: null` / `folderId: null` 表示，不落库。

### 唯一性

- 同一父文件夹下 folder title 不可重名；
- 同一文件夹下 note title 不可重名；
- 重名时**阻断**，不静默覆盖、不自动改名。

## 文件名 / title 语义

- 用户看到的是"文件名"；
- 内部字段仍是 `title`，与编辑器顶部输入框语义一致；
- title 允许任意字符串，**仅**保留底线约束：trim 后非空；
- 不做 slug 化、不限制字符集、不限制长度。

## 为什么 tag 明文、markdown 密文

- `tag` 是搜索键，存密文意味着每次本地搜索都要先全量解密 note 才能查 tag，
  与"密文是真值"的边界不符。所以 tag 明文落库。
- `markdown` 是正文真值，必须加密。它在内存中以 BlockNote 文档 + 导出后的
  markdown 形式存在；落库前经 `cipher.encrypt`，落库后只剩 nonce + cipherbytes。
- `title` / 时间戳是路径寻址、列表展示、时间排序的最小元数据，明文即可。
- BlockNote 内部 JSON **不**落库。导出 markdown 才是 note 内容的真值。

## 标签分隔规则

输入支持以下分隔符：

- 半角逗号 `,`
- 全角逗号 `，`
- 空格 / 换行

写入前必须：

1. 按分隔符拆分；
2. `trim`；
3. 过滤空值；
4. 转小写；
5. 去重；
6. 单 note 最多 24 个 tag；
7. 单 tag ≤ 32 字符。

## 交互模型

### 选中

- 三种互斥的选中态：`folder` / `note` / `root`（`root` 是显式真值；硬切换后不再保留 `none` 这套旧叙述）；
- 选中文件夹：右侧聚焦文件夹，新建 / 删除默认在此处进行；
- 选中 note：中间打开编辑器，顶部显示文件名输入框；
- 选中根目录：默认态；新建默认落到根目录下；右侧无 folder / note 焦点时显示"未选中实体"占位。

### 打开 note 解密（硬切换后的产品定义）

- popup session **并行**接受多条 request；transport 不再做"同一时刻只允许
  一条在途"的 single-flight 限制；
- 内部执行串行由 Keymaster 自行负责，demo 前端**不**再做 note 打开排队；
- 用户从未打开的 note A 切到未打开的 note B 时：
  - 立即对 A 发顶层 `cancel(A.requestId)`（fire-and-forget，不等 ack）；
  - 立即为 B 发新的 `cipher.decrypt` 请求；
  - 不论 cancel 是否生效，B 不需要等 A 跑完；
  - A 晚回来的结果按代际隔离丢弃，不会覆盖 B 的 editor。
- 用户从 note 切到 folder / root 时同样 cancel 当前 pending decrypt，再清空
  editorState；
- 同一 note 重复点击是 no-op（即便处于 loading / decryptFailed 也不自动重试）；
- save / login 仍按显式按钮触发，不复用 note 打开队列，也不依赖
  `session_busy` 作为前端控制手段；
- `cancel` 没有独立 ack；旧请求可能仍按 `request.id` 回结果——UI 一律按
  "是否仍是当前代际 + 是否仍是当前 note"判定写回。

### 右键菜单

- 根目录 `/`（含目录框架空白区域 / 空树提示块）：`新建 note / 新建文件夹`；
- folder：`新建 note / 新建文件夹 / 重命名 / 移动… / 删除`；
- note：`重命名 / 移动… / 删除`。

`移动…` 进入"移动模式"：再点击目标 folder 或根目录触发 move；与拖拽共用同一份 `handleMoveFolder` / `handleMoveNote` 真值（也共用 `checkDragLegality` 校验），不会被拖拽分支绕过。

### 拖拽

- folder / note 都可拖到 folder 或根目录上；
- 拖拽与右键菜单**共用**同一套 move 真值（同一份 `handleMoveFolder` / `handleMoveNote`）；
- 不允许：拖到 note 上；folder 拖到自己 / 自己后代。

### 删除

- 空文件夹：可删除；
- 非空文件夹：**弹提示框阻断**，首版不支持递归删除；
- note：可删除；解密失败的 note **仍允许删除**。

## 手工验收步骤

1. `npm run dev` 启动；
2. 打开页面，应**只**看到 `LockScreen`：没有文件树、没有编辑器、没有 inspector；
3. LockScreen 上有 `target origin / url` 输入框 + "使用默认地址" 按钮 + 大号登录按钮；
4. 输入默认 `https://keymaster.cc` → 点击 **登录** → 浏览器弹出 Keymaster popup；
5. 在 Keymaster 弹窗里若未解锁先输入密码 → 解锁后选 key 并确认；
6. 回到页面 → 已进入 notes 工作区，看到 `publicKey` 摘要 + `sessionId` 摘要 +
   last login 时间 + 当前 `target origin`；
7. 左侧点击 **+ 文件夹** → 根目录下出现新文件夹；
8. 在文件夹上右键 → 选 `新建 note`；
9. 编辑区顶部输入文件名；正文输入段落与列表；
10. 右侧面板把 tags 字段填入 `demo, keymaster`；
11. 点击 **加密保存** → 触发 `cipher.encrypt`（带 `connectSessionId`）；
12. **刷新页面** → 锁屏层短暂显示"正在恢复 session"，然后自动进入工作区；
13. 重新进入工作区后，左侧树仍显示原 owner 的 folder + note 树；
14. 点击 note → 触发 `cipher.decrypt`（带 `connectSessionId`）→ 编辑器回到原内容；
15. 右键 note → `删除` → 从树消失；
16. 在 popup 内取消身份请求 → 页面应显示 `user_rejected` 错误；
17. 切换 target origin 模拟 `decrypt_failed`：在 Keymaster 内切走 active key
    或在不同 origin 重新打开 → note 列表仍显示，但点击后进入"无法解密"态；
18. 在根目录放一个文件夹 + 它的子 note，拖拽 note 到另一文件夹 → 应移动成功；
19. 输入 `not a url` 这种非法值 → 登录按钮应被禁用，提示 `Target origin 非法。`；
20. 已登录态点击 **退出登录** → 调 `connect.logout` → 服务端吊销 session →
    退回 `LockScreen`，本地 session 已清；notes 工作区态清空但 owner 本地数据仍保留；
21. 已登录态点击 **切换身份 / 更换登录器** → 立即回到 `LockScreen`，
    当前编辑区 / 选中态 / draft / 拖拽态全部清空，但 localStorage 原 owner 数据仍保留；
22. 已登录态点击 **删除当前本地数据** → 弹二次确认框（明确说明只删本地数据、
    不删 Keymaster 身份）→ 确认 → 退回 `LockScreen`；再次登录同一 owner 应看到空树，
    原数据**不**再恢复；
23. 自定义 origin：在 LockScreen 输入 `https://demo.example.com`（假设对方实现
    相同协议）→ 登录 → 应能进入 notes 工作区，与默认 origin 行为一致；
24. note 打开链路验收：连续快速点击未解密 note A → B → C，前端应**立即**对
    A、B 各发一条 `cancel`（在浏览器 devtools / `console.debug` 里能看到
    `cancel_sent` 日志），并立即为每条目标发新的 `cipher.decrypt`；
    最终停留在 C 的 editor；A、B 的晚回结果不应出现在 UI 上；
25. note → folder / root 切换：当前 note 还在 loading 时点 folder / root，
    应触发 `cancel_sent`、清空 editor、回到 folder / root 占位；
26. popup refresh 后恢复：刷新 popup 触发 unlock runtime 失效 → 锁屏层 / 页头
    显示 transport `disconnected` → 用户点 **恢复 session** → popup 要求输入密码
    → 解锁后继续工作区，**不**回到登录壳，**不**重新选 key；
27. 跨 origin 处理：登录后改 `targetOrigin` → 锁屏层显示"恢复失败，请重新登录"
    → 旧 session 已清 → 用户重新 login；
28. active key 切换：在 Keymaster 主站切换 active key → notes 不受影响 →
    继续用 session 绑定 owner → 打开 / 保存 / 解密都不漂移到新 active key。

## 异常行为对照表

| 情况 | 行为 |
|---|---|
| popup 被浏览器拦截 | 顶栏明确报错；不做自动重试 |
| `ready_timeout` | 当前 transport 作废；用户可手动点 "恢复 session" 再试 |
| `result_timeout` | 单条 request 失败；用户可再次发起 |
| `user_rejected`（login / resume / logout / cipher） | UI 明确显示；不写入任何半成功状态；**不**清本地 session（除非是 logout） |
| `active_key_unavailable`（cipher 路径） | 顶栏显示原因；不写本地；session 仍保留，提示用户去 Keymaster 主站激活 |
| `decrypt_failed` | note 仍显示；点击进入"无法解密"页；**不**清空密文 |
| `connect.resume` 返回 session 无效（吊销 / 绑定 key 已删） | 清本地 session；锁屏显示"恢复失败，请重新登录" |
| `connect.resume` 命中"需要解锁" | popup 走 unlock UI；解锁后继续原 session；**不**回登录壳 |
| popup 在多个 pending request 存在时被关闭 | transport 批量 reject **全部** pending；只有仍属于"当前 note + 当前代际"的那条会被展示为解密失败，其它一律静默 |
| 快速切 note 时 `cancel` 被协议忽略（旧请求已 `executing`） | 新 note 仍正常打开；旧请求晚回结果按代际隔离丢弃；**不**把新 note 误标失败 |
| title（文件名）为空 | 保存前阻断；精确提示 |
| folder / note 重名 | 保存 / 移动前阻断；提示用户改名或换目标 |
| 非空文件夹删除 | 弹提示框阻断；不递归强删 |
| 拖到非法目标 | 不执行移动；轻量错误提示 |
| 用户在 popup 关闭期间点 "退出登录" | 走 best-effort `logout`；失败时本地先清，按"无法确认服务端吊销"分支让用户后续 resume 收敛 |
| 切换 `targetOrigin`（已在登录态改 origin） | 旧 connect session 视为跨 origin 失效；清本地 session；退回登录壳 |

## 项目结构

```
src/
  lib/
    protocol.ts          # 协议类型收口（connect.* + cipher.* + 可选 session-bound identity.get）
    connectClient.ts     # popup transport 原子能力 + normalizeOrigin
    popupSessionClient.ts# 页面级 popup session client（仅 transport 真值）
    encoding.ts          # UTF-8 / base64 / hex
    binary.ts            # BinaryField 转换
    keymaster.ts         # 业务 ↔ 协议收口（含 connect.* builder / parser）
    path.ts              # 树构建 / 拖拽合法性 / 根虚拟节点
    notes.ts             # folder/note record schema + tag/title 规则
    storage.ts           # owner 分区 KV + folder/note CRUD + 冲突检查
                         # + connect session 本地记录存取
  components/
    LockScreen.tsx       # 登录壳 + 恢复中 + 恢复失败（mode 三态）
    ConnectStatus.tsx    # 已登录态顶栏 + sessionId / 恢复 / 退出登录 按钮
    NotesSidebar.tsx     # 左侧 folder/note 树 + 右键菜单 + 拖拽 + 简化 folder 工具条
    NoteEditor.tsx       # BlockNote 包装（markdown 单真值）
    DocumentToolbar.tsx  # 文档区顶部 Notion 风格两排工具条（tag + 状态 + 动作）
  App.tsx                # connect session 状态机 + LockScreen / Notes 二段式渲染
                         # + 自动 resume 流程 + app-banner + 窄屏文件树开合状态
  main.tsx               # 挂载入口
  styles.css             # LockScreen 样式 + 工作区样式 + banner / toolbar / 响应式
```

## 不允许的事

施工单硬定义了一组核心边界，本 demo 严格遵守：

- 不自研 Notion 编辑器（用 BlockNote）；
- 不做 mock / fallback；
- 不缓存明文 markdown 到 localStorage / IndexedDB；
- 不再以完整 path 作为 note 主真值；
- 不把 `folderPath` 再塞回 `StoredNoteRecord`；
- 不在 folder / note record 里重复存 `ownerPublicKeyHex`；
- 不让 title（文件名）承担底层 key 唯一性；
- 不做 `Workspace` / `inbox` 概念；
- 不在 `cipher.decrypt` 失败时自动清空或重写密文；
- 不做自动重试、自动覆盖、重名时静默改名；
- 不删非空文件夹；
- 不让右键菜单和拖拽走两套 move 真值逻辑；
- 不做协作 / 评论 / 版本历史 / 分享链接；
- 不在未登录态继续渲染 notes 工作区外壳；
- 不为"刷新后不断片"而持久化 identity 快照；
- 不做"未登录但先展示上次 owner 文件树"的半状态；
- 不把 notes space 改成按 `targetOrigin + owner` 双维度分区；
- 不把自定义登录器理解成新账号体系；
- 不把 provider URL 写进 folder / note record；
- 切换登录器时**不**自动迁移 / 复制 / 重写已有密文；
- 不会因为 owner 相同就假定一定能解密；
- 不做自动重试、自动回退默认 origin、自动修正 URL；
- 不在登录失败后偷偷保留旧工作区继续可见；
- 不引入多 provider 管理 / 收藏 / 最近记录；
- 不再做 note 打开的串行排队（`openChainRef` 已删除）；
- 不依赖 `session_busy` / 单 `inFlight` 作为 note 打开链路的前端控制手段；
- 不把"cancel 已发送"误当成"旧请求一定不会再回结果"；
- 不在 `executing` 阶段尝试"半取消"或"结果反转"；
- 不为了"业务完整"顺手引入 note 打开的请求池 / 优先级 / 批处理 / 重试 / 恢复；
- 不做三栏工作区（不再保留 `NoteInspector` 右侧独立面板）；
- 不把 `title` 塞进 toolbar（`title` 属于 `document-head`，与正文同轴线）；
- 不在 sidebar 根目录上方同时显示 note 工具条和 folder 工具条（仅 folder 时显示简化工具条）；
- 不把 `saveOverlay` 降级为普通 banner（仍是阻塞遮罩）；
- 不顺手做 Office 式富文本工具条（粗体 / 标题 / 列表等按钮不进 `document-toolbar`）；
- 不为窄屏另造一套业务状态机（开合态与桌面共用同一份 selection / editor 真值）。

### connect session 硬切换的额外边界（2026-06-28 001）

- 不继续把 `identity.get` 当 notes demo 的长期登录真值。
- 不继续把 popup transport 窗口是否还活着当成 auth session 是否还活着。
- 不在本地持久化用户密码或 popup 解锁运行时材料。
- 不让 `cipher.*` 不带 `connectSessionId`（必须按 session 绑定 key 执行）。
- 不在 popup transport 抖动时直接清掉本地 `connectSessionId`。
- 不在 session 绑定 key 失效时自动换成另一把 key 继续工作。
- 不让 `resume` 重新选 key / 重新走 login。
- 不让 logout 只做本地清空而不调 `connect.logout`。