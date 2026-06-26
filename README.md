# Keymaster Connect Notes Demo

基于 Keymaster Connect V1 协议的加密笔记 demo。

## 项目定位

这是一个**外部调用方 demo**：单页前端，真值由 Keymaster 提供。它**不是**产品原型，
**不是**协作工具，**不是**离线缓存容器。

我们只做一件事：证明一个最小外部站点能

- 用 `identity.get` 拉起 Keymaster popup 并取回身份；
- 用 `cipher.encrypt` / `cipher.decrypt` 真实加解密笔记正文；
- 用 folder/note 显式实体管理笔记结构；
- 把密文 + 元数据落到本地 KV；
- 在不缓存明文的前提下，仍能保持"打开 → 编辑 → 保存"的闭环。

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

本 demo 只调用三个方法：

| 方法 | 用途 |
|---|---|
| `identity.get` | 登录入口；拿到 `subject.publicKey` + 选定的 profile claims |
| `cipher.encrypt` | 保存 note 时把 markdown UTF-8 字节加密为 nonce + cipherbytes |
| `cipher.decrypt` | 打开 note 时把密文还原为 markdown 明文 |

不接入 `intent.sign` / `p2pkh.transfer` / `feepool.*` 等其它能力。

target origin 默认为 `https://keymaster.cc`；本地调试可在 Keymaster popup
部署到自己的 target 后修改。

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
2. 打开页面，点击右上角 **登录** → 浏览器应弹出 Keymaster popup；
3. 在 Keymaster 弹窗里确认身份请求；
4. 回到页面，看到 `subject.publicKey` 摘要 + last login 时间；
5. 左侧点击 **+ 文件夹** → 根目录下出现新文件夹；
6. 在文件夹上右键 → 选 `新建 note`；
7. 编辑区顶部输入文件名；正文输入段落与列表；
8. 右侧面板把 tags 字段填入 `demo, keymaster`；
9. 点击 **加密保存** → 触发 `cipher.encrypt`；
10. 刷新页面 → 左侧树应出现 folder + note；
11. 点击 note → 触发 `cipher.decrypt` → 编辑器回到原内容；
12. 右键 note → `删除` → 从树消失；
13. 在 popup 内取消身份请求 → 页面应显示 `user_rejected` 错误；
14. 切换 target origin 模拟 `decrypt_failed`：在 Keymaster 内切走 active key
    或在不同 origin 重新打开 → note 列表仍显示，但点击后进入"无法解密"态；
15. 在根目录放一个文件夹 + 它的子 note，拖拽 note 到另一文件夹 → 应移动成功；
16. 在 popup 内取消身份请求 → 页面应显示 `user_rejected` 错误。

## 异常行为对照表

| 情况 | 行为 |
|---|---|
| popup 被浏览器拦截 | 顶栏明确报错；不做自动重试 |
| `ready_timeout` | 当前 session 作废；用户可手动再试 |
| `result_timeout` | 当前 request 失败；用户可再次发起 |
| `user_rejected` | UI 明确显示；不写入任何半成功状态 |
| `active_key_unavailable` | 顶栏显示原因；不写本地 |
| `decrypt_failed` | note 仍显示；点击进入"无法解密"页；**不**清空密文 |
| title（文件名）为空 | 保存前阻断；精确提示 |
| folder / note 重名 | 保存 / 移动前阻断；提示用户改名或换目标 |
| 非空文件夹删除 | 弹提示框阻断；不递归强删 |
| 拖到非法目标 | 不执行移动；轻量错误提示 |

## 项目结构

```
src/
  lib/
    protocol.ts          # 协议类型收口（仅 identity.get + cipher.*）
    connectClient.ts     # popup transport 原子能力
    popupSessionClient.ts# 页面级 popup session client
    encoding.ts          # UTF-8 / base64 / hex
    binary.ts            # BinaryField 转换
    keymaster.ts         # 业务 ↔ 协议收口
    path.ts              # 树构建 / 拖拽合法性 / 根虚拟节点
    notes.ts             # folder/note record schema + tag/title 规则
    storage.ts           # owner 分区 KV + folder/note CRUD + 冲突检查
  components/
    ConnectStatus.tsx    # 顶栏连接状态 + 登录按钮
    NotesSidebar.tsx     # 左侧 folder/note 树 + 右键菜单 + 拖拽
    NoteEditor.tsx       # BlockNote 包装（markdown 单真值）
    NoteInspector.tsx    # 右侧元数据 + 保存/删除
  App.tsx                # 状态真值集中地
  main.tsx               # 挂载入口
  styles.css             # 工作区样式 + 右键菜单 / 拖拽视觉态
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
- 不做协作 / 评论 / 版本历史 / 分享链接。