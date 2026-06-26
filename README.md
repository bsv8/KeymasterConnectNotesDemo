# Keymaster Connect Notes Demo

基于 Keymaster Connect V1 协议的加密笔记 demo。

## 项目定位

这是一个**外部调用方 demo**：单页前端，真值由 Keymaster 提供。它**不是**产品原型，
**不是**协作工具，**不是**离线缓存容器。

我们只做一件事：证明一个最小外部站点能

- 用 `identity.get` 拉起 Keymaster popup 并取回身份；
- 用 `cipher.encrypt` / `cipher.decrypt` 真实加解密笔记正文；
- 把密文 + 路径元数据落到本地 KV；
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

## 为什么 tag 明文、markdown 密文

- `tag` 是搜索键，存密文意味着每次本地搜索都要先全量解密 note 才能查 tag，
  与"密文是真值"的边界不符。所以 tag 明文落库。
- `markdown` 是正文真值，必须加密。它在内存中以 BlockNote 文档 + 导出后的
  markdown 形式存在；落库前经 `cipher.encrypt`，落库后只剩 nonce + cipherbytes。
- `title` / `path` / `createdAt` / `updatedAt` / `ownerPublicKeyHex` 都是
  路径寻址、列表展示、时间排序的最小元数据，明文即可。
- BlockNote 内部 JSON **不**落库。导出 markdown 才是 note 内容的真值。

## path 规则

每条 note 的 key 是一个绝对路径字符串：

```txt
/workspace/inbox/daily-note
/workspace/product/prd/keymaster-notes-demo
/private/journal/2026-06-25
```

校验规则（强制）：

1. 必须以 `/` 开头；
2. 不能等于 `/`；
3. 不能以 `/` 结尾；
4. 不能含 `//`；
5. segment 不能为空、不能是 `.` 或 `..`；
6. 单 segment ≤ 64 字符，path 总长 ≤ 240；
7. segment 必须匹配 `^[a-z0-9][a-z0-9._-]*$`。

写入前先 `normalizeNotePath` 再 `validateNotePath`；非法 path 阻断保存，
UI 给出具体失败规则。

> 路径与标题分离：`title` 给人看（可含空格、大小写、自然语言）；
> `path` 是工程键（必须 slug 化）。

## tag 规则

- 写入前 `trim`、转小写、去重、过滤空；
- 单 note 最多 24 个 tag；
- 单 tag 最长 32 字符。

## 数据模型

```ts
interface StoredNoteRecord {
  v: 1;
  key: string;            // path 真值
  title: string;          // 明文
  tags: string[];         // 明文
  createdAt: number;
  updatedAt: number;
  ownerPublicKeyHex: string;
  cipher: {
    contentType: "keymaster.notes.markdown.v1";
    nonceBase64: string;
    cipherbytesBase64: string;
  };
}
```

存储按 `ownerPublicKeyHex` 分区；切换身份后只加载当前 owner 的 notes。

## 手工验收步骤

1. `npm run dev` 启动；
2. 打开页面，点击右上角 **登录** → 浏览器应弹出 Keymaster popup；
3. 在 Keymaster 弹窗里确认身份请求；
4. 回到页面，看到 `subject.publicKey` 摘要 + last login 时间；
5. 点击左侧 **+ 新建** → 编辑区出现空白 BlockNote；
6. 任意输入段落与列表；
7. 在右侧面板把 tags 字段填入 `demo, keymaster`；
8. 点击 **加密保存** → 触发 `cipher.encrypt`；
9. 刷新页面 → 左侧树应该出现新 note；
10. 点击新 note → 触发 `cipher.decrypt` → 编辑区回到原内容；
11. 点击 **删除** → note 从树消失；
12. 在 popup 内取消身份请求 → 页面应显示 `user_rejected` 错误；
13. 切换 target origin 模拟 `decrypt_failed`：在 Keymaster 内切走 active key
    或在不同 origin 重新打开 → note 列表仍显示，但点击后进入"无法解密"态。

## 异常行为对照表

| 情况 | 行为 |
|---|---|
| popup 被浏览器拦截 | 顶栏明确报错；不做自动重试 |
| `ready_timeout` | 当前 session 作废；用户可手动再试 |
| `result_timeout` | 当前 request 失败；用户可再次发起 |
| `user_rejected` | UI 明确显示；不写入任何半成功状态 |
| `active_key_unavailable` | 顶栏显示原因；不写本地 |
| `decrypt_failed` | note 仍显示；点击进入"无法解密"页；**不**清空密文 |
| path 非法 | 保存前阻断；精确提示哪条规则不满足 |
| path 冲突 | 保存前阻断；让用户改 path |
| 切换 note 时有未保存修改 | 弹窗让用户确认是否放弃 |

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
    path.ts              # path 校验/normalize/slugify/树构建
    notes.ts             # note record schema + tag/draft 规则
    storage.ts           # owner 分区 KV + 列表/搜索
  components/
    ConnectStatus.tsx    # 顶栏连接状态 + 登录按钮
    NotesSidebar.tsx     # 左侧树 + 搜索 + tag 筛选
    NoteEditor.tsx       # BlockNote 包装（markdown 单真值）
    NoteInspector.tsx    # 右侧元数据 + 保存/删除
  App.tsx                # 状态真值集中地
  main.tsx               # 挂载入口
  styles.css             # Notion 风格工作区样式
```

## 不允许的事

施工单硬定义了一组核心边界，本 demo 严格遵守：

- 不自研 Notion 编辑器（用 BlockNote）；
- 不做 mock / fallback；
- 不缓存明文 markdown 到 localStorage / IndexedDB；
- 不为树结构额外维护 folder 真值（树由 key path 派生）；
- 不把显示标题直接当 path；
- 不在 `cipher.decrypt` 失败时自动清空或重写密文；
- 不做自动重试、自动覆盖路径、悄悄改名；
- 不做协作 / 评论 / 版本历史 / 分享链接。
