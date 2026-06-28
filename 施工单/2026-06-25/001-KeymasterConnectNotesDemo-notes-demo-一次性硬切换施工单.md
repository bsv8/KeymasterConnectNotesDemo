# KeymasterConnectNotesDemo Notes Demo 一次性硬切换施工单

> **本施工单已被取代（archived）**
>
> 本单描述的是 notes demo 的**首版设计**，其中：
> - 「登录能力走 `identity.get`」「`identity.get` = 登录真值」等条目代表的是 **旧模型** 的产品定位；
> - 旧模型已被后续两份硬切换施工单完全取代：
>   - [施工单/2026-06-28/001 connect-session-bound-key-integration 硬切换](../2026-06-28/001-KeymasterConnectNotesDemo-connect-session-bound-key-integration-硬切换施工单.md)（登录真值切到 `connectSessionId`）
>   - [施工单/2026-06-28/002 protocol-business-methods-bind-connect-session 硬切换](../2026-06-28/002-KeymasterConnectNotesDemo-protocol-business-methods-bind-connect-session-硬切换施工单.md)（`identity.get` 重新定位为「会话内身份断言能力」、其 contract 切到 session-bound）
>
> 本单仅作历史归档。当前 demo 的产品真值、协议真值、登录真值均以上述两份后续施工单为准。
>
> 验收口径：搜索本仓库时若仍命中本施工单中的 `identity.get` 字样，按"已归档的旧模型描述"处理，不计入"残留旧叙事"。

## 1. 本单目标

本次不是讨论稿，不是分阶段预案，不是“先做一个能跑的壳后面再修正”。

本次直接定义 **Notes Demo 的最终首版闭环**，一次性钉死：

- 登录能力走 `identity.get`
- 加密能力走 `cipher.encrypt`
- 解密能力走 `cipher.decrypt`
- 存储模型是本地 `key -> value`，但 `key` 必须模拟文件树路径
- `value` 的核心真值是**加密后的 markdown note**
- `tag` 明文存储，用于本地搜索
- UI / UE 真值参考 **Notion 的应用工作区**，不是参考现有 demo
- 编辑器不自研，直接集成 **BlockNote**

本单用于后续一次性施工与最终验收。后续若要改核心真值，必须先改本单，再改代码。

## 2. 参考真值

### 2.1 本地参考仓库

- `/home/david/Workspaces/KeymasterConnectDemo`
- `/home/david/Workspaces/keymaster.cc`

其中以这些内容为直接真值：

- `KeymasterConnectDemo/src/lib/connectClient.ts`
- `KeymasterConnectDemo/src/lib/popupSessionClient.ts`
- `KeymasterConnectDemo/src/lib/protocol.ts`
- `keymaster.cc/packages/contracts/src/protocol.ts`
- `keymaster.cc/docs/keymaster-identity-get-v1-draft.md`
- `keymaster.cc/docs/keymaster-cipher-v1-draft.md`

### 2.2 编辑器选型真值

本次编辑器固定选择 **BlockNote**。

截至 **2026-06-25**，公开真值如下：

- BlockNote 官方站直接把自己定义为 “Build a Notion-style editor in minutes.”
- 官方站显示 `100k+ weekly installs`
- 官方 GitHub 仓库显示 `9.9k stars`
- GitHub 当前最新 release 为 `v0.51.4`，发布日期 `2026-06-02`

来源：

- https://www.blocknotejs.org/
- https://github.com/TypeCellOS/BlockNote

## 3. 为什么必须硬切换

### 3.1 这不是线上迁移系统

当前仓库几乎是空仓，不存在必须兼容的旧 notes 产品，不需要做渐进迁移。

### 3.2 双轨真值会直接把 demo 做脏

如果同时保留：

- 自研编辑器 + BlockNote
- 纯文本存储 + BlockNote JSON 存储
- 明文 note + 密文 note
- 宽松 path + 严格 path

最终一定会出现：

- UI 看起来可用，但真实协议链路没被验证
- 一部分数据能被当前版本打开，另一部分只能靠兼容分支打开
- 路径、加密、树结构、tag 搜索分别各有一套“例外逻辑”

这与 demo 的目标相反。

### 3.3 connect 协议必须保持“真实、单路径、无遮蔽”

本次最重要的不是做一个“像 notes 的东西”，而是做一个：

- 真正调用 Keymaster 登录
- 真正调用 Keymaster 加解密
- 真正把树路径和密文落到本地
- 真正暴露错误

的外部调用方样板。

所以本次要求：

- 不做 mock
- 不做 fallback 协议
- 不做“失败后自动换明文存储”
- 不做“先临时存 BlockNote JSON，后续再转 markdown”
- 不做“先不校验 path，后面再补”

## 4. 最终产品定义

## 4.1 页面与交互

交付的是一个单页前端 demo，页面结构固定为：

- 左侧：树形笔记导航
- 顶部：工作区 header、连接状态、登录动作、搜索入口
- 中间：Notion 风格主编辑区
- 右侧：当前 note 元数据与存储操作区

页面不是营销页，不要 hero，不要卡片墙，不要 demo 控制台味道。

要做成像 Notion 工作区那样的：

- 低对比背景
- 极细分隔
- 大量留白
- 轻量 hover
- 主编辑区优先级最高

### 4.2 登录语义

登录固定走 `identity.get`，用于建立“当前工作区属于哪个 Keymaster 身份”。

至少请求以下 claims：

- `key.label`
- `profile.nickname`
- `wallet.bsv.address.main`

登录成功后，前端要拿到并显示：

- `subject.publicKey`
- 选到的 label / nickname
- 最近一次登录时间

### 4.3 编辑器语义

编辑器固定是 **BlockNote**，但文档真值不是 BlockNote 内部 JSON。

最终真值固定为：

- 编辑时：BlockNote 内存态
- 保存时：导出 markdown
- 加密时：加密 markdown UTF-8 字节
- 存储时：落库的是密文记录

因此：

- BlockNote 只承担编辑体验
- markdown 才是 note 内容真值
- 本地存储里不保存 BlockNote document JSON 作为第二真值

### 4.4 存储语义

存储是本地 S3-like KV，但 key 模拟文件树。

固定为：

```txt
key   = note path
value = note record
```

树结构不是单独一张 folder 表，不单独建目录实体，不维护 parentId 图结构。

树完全由 `key path` 派生。

## 5. 数据模型硬定义

### 5.1 路径 key 真值

每条 note 的 key 必须是一个**绝对路径字符串**，例如：

```txt
/workspace/inbox/daily-note
/workspace/product/prd/keymaster-notes-demo
/private/journal/2026-06-25
```

### 5.2 path 校验规则

path 校验不是建议，是强制规则。

必须全部满足：

1. 必须以 `/` 开头
2. 不能等于 `/`
3. 不能以 `/` 结尾
4. 不能包含连续 `//`
5. 每个 segment 不能为空
6. segment 不能是 `.` 或 `..`
7. path 总长度必须有上限
8. 单个 segment 长度必须有上限
9. segment 字符集必须受限，不能允许任意控制字符
10. 必须在写入前做 normalize，再做合法性校验

建议固定规则：

```txt
path length <= 240
segment length <= 64
segment regex = ^[a-z0-9][a-z0-9._-]*$
```

也就是说：

- key path 是工程键，不是用户自由文本标题
- 标题与 path 分离
- path 用稳定 slug

### 5.3 title 与 path 的关系

必须区分：

- `title`：给人看
- `path`：给系统做树和寻址

不允许把“用户显示标题”直接当 path 真值写入。

正确做法：

- `title` 可以有空格、有大小写、有自然语言
- `path` 必须是经 slug/规则收口后的稳定键

### 5.4 note value 结构

本次 note record 固定至少包含：

```ts
interface StoredNoteRecord {
  v: 1;
  key: string;
  title: string;
  tags: string[];
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

约束：

- `v` 是 record schema 版本
- `key` 是 path 真值
- `title` 明文
- `tags` 明文
- `createdAt` / `updatedAt` 明文
- `ownerPublicKeyHex` 明文
- 真正加密的内容只有 markdown note 本体

### 5.5 tag 规则

tag 明文存储，原因已经明确：需要本地搜索。

tag 规则固定为：

1. 写入前必须 trim
2. 必须转成统一大小写
3. 必须去重
4. 必须过滤空 tag
5. tag 数量必须有限制
6. 单个 tag 长度必须有限制

建议固定规则：

```txt
max tags per note = 24
tag length <= 32
normalized to lowercase
```

### 5.6 明文与密文边界

必须明确：

- `title` 明文
- `path` 明文
- `tags` 明文
- `createdAt/updatedAt` 明文
- `ownerPublicKeyHex` 明文
- `markdown content` 密文

不能做成：

- tag 也加密
- title 加密但又另外存一个 preview
- 明文 markdown 存 localStorage 方便下次秒开

因为这些都会破坏“密文是真值”的边界。

## 6. connect 协议接入硬定义

### 6.1 只保留三条能力

本项目只接入：

- `identity.get`
- `cipher.encrypt`
- `cipher.decrypt`

明确不接：

- `intent.sign`
- `p2pkh.transfer`
- `feepool.prepare`
- `feepool.commit`

原因不是这些能力没用，而是当前 notes demo 不需要。保留多余协议只会扩大 UI 与状态面。

### 6.2 popup 会话模型

直接复用 `KeymasterConnectDemo` 的 popup session 思路：

- 整页只维护一个 popup session client
- 第一次需要协议调用时开窗
- 收到 `ready` 后复用同一 popup
- popup 关闭后下次再开新窗
- 同时只允许一条在途 request

明确不做：

- request 队列
- 自动重试
- 多 popup 并发
- 每次请求都新开窗口

### 6.3 origin 语义

必须遵守 keymaster 的现有语义：

- `identity.get` 要传 `aud`
- `aud` 必须等于当前页面 origin
- `cipher.*` 不传 `aud`
- `cipher.*` 站点绑定依赖浏览器真实 `event.origin`

因此：

- 不能把 `targetOrigin` 填进 `aud`
- 不能对 `cipher` 的 origin 自己做归一化
- 不能把站点绑定改成“可选关闭”

## 7. 编辑器与 markdown 真值硬定义

### 7.1 BlockNote 的使用边界

本次只能使用 BlockNote 的**开源核心能力**与可直接商用的 UI 组件。

明确不引入：

- 需要额外商业授权的 XL 特性
- AI 写作
- 多栏布局
- 导出 PDF / Word / ODT

原因：

- 本次只需要 Notion 风格编辑能力
- 不能把首版 demo 绑到额外授权与复杂能力上

### 7.2 markdown 必须是单真值

必须做到：

1. 打开 note 时：解密拿到 markdown
2. 进编辑器时：把 markdown 转成 BlockNote 内容
3. 编辑中：BlockNote 驱动交互
4. 保存时：重新导出 markdown
5. 再调用 `cipher.encrypt`

明确不允许：

- 同时存 markdown 和 BlockNote JSON，当作双真值
- 首版先存 BlockNote JSON，后面再补 markdown
- 解密后把 markdown 永久缓存到 localStorage

### 7.3 markdown 兼容边界

BlockNote 是块编辑器，markdown 导出存在“能力交集”问题。

因此本次必须主动收口：

- 只允许使用 markdown 友好的核心块类型
- 对不稳定导出的块能力要关闭或限制

建议首版只保留：

- paragraph
- heading
- bulleted list
- numbered list
- checklist
- quote
- code block
- divider

谨慎处理：

- table
- image
- video
- audio
- file
- 多列布局

如果 BlockNote 默认打开了上述高阶块，必须明确裁掉或验证 markdown 往返不会丢失语义。

## 8. 特殊情况处理规则

### 8.1 popup 被浏览器拦截

处理方式固定为：

- 页面直接报错提示
- 不做自动重试
- 不偷偷退回本地明文模式

### 8.2 `ready_timeout`

处理方式固定为：

- 直接展示 transport 错误
- 当前 session 作废
- 用户可手动再试

不能做：

- 背景无限重连
- 不提示失败

### 8.3 `result_timeout`

处理方式固定为：

- 直接暴露错误
- 标记该次请求失败
- 允许用户再次发起新请求

### 8.4 `user_rejected`

处理方式固定为：

- UI 显示“用户在 Keymaster 中取消”
- 不写入本地 note
- 不保留半成功状态

### 8.5 `active_key_unavailable`

处理方式固定为：

- 明确提示当前 Keymaster 没有可用 active key
- 不做前端自救逻辑

### 8.6 `decrypt_failed`

这是非常关键的预期异常。

出现原因可能包括：

- 当前页面 origin 与加密时不同
- 用户当前 active key 与加密时不同
- 密文损坏
- `nonce` / `cipherbytes` 被改动

处理方式固定为：

- note 列表仍然显示
- 打开该 note 时进入“无法解密”错误态
- 不自动删除这条记录
- 不自动覆盖旧密文

### 8.7 path 非法

处理方式固定为：

- 前端保存前阻断
- 精确提示 path 哪条规则不满足
- 不允许带着非法 path 写入 store

### 8.8 path 冲突

如果创建或移动 note 时目标 path 已存在：

- 直接阻断
- 让用户改 path

不能做：

- 自动覆盖已有 note
- 悄悄改名后写入

### 8.9 切换 note 时存在未保存修改

处理方式固定为：

- 直接要求用户确认是否放弃未保存修改
- 若不放弃，则取消切换

不能做：

- 静默丢弃
- 静默自动保存明文草稿到本地

### 8.10 当前身份切换

如果用户重新登录，拿到的 `subject.publicKey` 与当前工作区身份不同：

- 必须切换到新身份对应的数据视图
- 旧身份数据不能继续挂在当前工作区里

推荐做法：

- 存储按 `ownerPublicKeyHex` 分区
- 登录后只加载当前 owner 的 notes

## 9. 不能怎么做

以下做法本次一律禁止：

1. 不能自研 Notion 编辑器。
2. 不能把 `intent.sign` 伪装成登录方案。
3. 不能引入后端、云存储或 mock server。
4. 不能做“明文存一份，密文存一份”的双写。
5. 不能做“tag 也一起加密，搜索时再全量解密”。
6. 不能为树结构额外维护 folder 表作为主真值。
7. 不能放宽 path 规则让任何字符串都能落库。
8. 不能把显示标题直接当 path。
9. 不能把 BlockNote JSON 落成本地第二真值。
10. 不能用 IndexedDB / localStorage 永久缓存解密后的 markdown。
11. 不能在 `cipher.decrypt` 失败时自动清空或重写旧密文。
12. 不能在同一页面同时维护多套 connect client。
13. 不能自动重试用户拒绝类错误。
14. 不能为了“更像 Notion”而引入一大堆无关复杂能力。
15. 不能做多用户协作、评论、版本历史、分享链接。

## 10. 文件级施工清单

当前仓库几乎为空，因此本次允许直接把项目骨架一次性建齐。

## 10.1 基础工程文件

### `package.json`

内容必须包含：

- `dev`
- `build`
- `preview`
- `typecheck`

依赖必须最小化，至少包括：

- `react`
- `react-dom`
- `typescript`
- `vite`
- `@blocknote/core`
- `@blocknote/react`
- `@blocknote/mantine`

可选依赖只允许围绕：

- 编码
- 样式
- 类型支持

不引入：

- 全局状态库
- 路由库
- UI 大而全组件库
- 富文本替代编辑器

### `tsconfig.json`

要求：

- 严格模式开启
- 浏览器前端配置
- 不保留宽松 any 化配置

### `vite.config.ts`

要求：

- 最小配置
- 不加无关插件

### `index.html`

要求：

- 单一根节点
- 页面标题指向 Notes Demo

## 10.2 文档文件

### `README.md`

必须写清楚：

- 项目定位
- 启动方式
- 依赖的 keymaster 能力
- 为什么 tag 明文、markdown 密文
- path 规则
- 手工验收步骤

## 10.3 源码文件

### `src/main.tsx`

职责：

- 挂载应用
- 引入全局样式

### `src/App.tsx`

职责：

- 页面总布局
- 登录状态
- note 列表与树
- 当前 note 编辑生命周期
- 搜索与筛选
- 保存/删除/移动
- connect 调用收口

要求：

- 允许拆少量局部组件
- 但状态真值必须集中，不要过度组件化

### `src/styles.css`

职责：

- 落地 Notion 风格工作区
- 左侧树、中间编辑区、右侧元数据面板
- BlockNote 的样式压平到统一视觉

要求：

- 轻色背景
- 极细边界
- 大留白
- 不做炫技动画

### `src/lib/protocol.ts`

职责：

- 收口本项目需要的最小协议类型
- 只保留 `identity.get` 与 `cipher.*`

### `src/lib/connectClient.ts`

职责：

- popup transport 基础能力

要求：

- 对齐现有 demo 行为
- 不发明新 transport

### `src/lib/popupSessionClient.ts`

职责：

- 页面级 popup session 复用

要求：

- 同一时刻只允许一条在途请求
- popup 生命周期与 request 生命周期分离

### `src/lib/encoding.ts`

职责：

- UTF-8 / base64 / hex 转换

### `src/lib/keymaster.ts`

职责：

- 组装 `identity.get`
- 组装 `cipher.encrypt`
- 组装 `cipher.decrypt`
- 统一把业务对象转换成协议对象

### `src/lib/path.ts`

职责：

- `normalizeNotePath`
- `validateNotePath`
- `slugifyPathSegment`
- 树构建辅助

要求：

- path 规则唯一收口
- UI 与 store 不能各自再写一套 path 校验

### `src/lib/storage.ts`

职责：

- 当前 owner 视角下的 notes KV 读写
- record schema 校验
- list / get / put / delete / move
- tag 搜索索引

要求：

- 树由 key 派生
- 不额外引入 folder 真值

### `src/lib/notes.ts`

职责：

- note record 与 editor draft 的转换
- markdown 密文与明文态转换
- 保存流程拼装

### `src/components/NotesSidebar.tsx`

职责：

- 树渲染
- 搜索结果与选中态

### `src/components/NoteEditor.tsx`

职责：

- 包装 BlockNote
- markdown <-> BlockNote 文档转换
- 编辑 change 上抛

要求：

- 只暴露 markdown 真值给上层

### `src/components/NoteInspector.tsx`

职责：

- path/title/tag 编辑
- 保存、删除、移动动作
- 显示创建/更新时间、owner、加密状态

### `src/components/ConnectStatus.tsx`

职责：

- 显示 popup 连接态
- 显示最近错误

## 11. 实施顺序要求

虽然是硬切换，但仍然要按一个**单次连续落地顺序**执行，不能边做边改真值。

顺序固定为：

1. 先建工程骨架
2. 直接搬最小 connect client
3. 直接钉死 path 规则与 record schema
4. 直接接 BlockNote，并只暴露 markdown 真值
5. 直接完成左树 + 中间编辑区 + 右侧面板
6. 直接完成加密保存与解密打开
7. 最后统一跑 typecheck/build 和手工验收

不能变成：

- 先糊 UI
- 再补 connect
- 再补 path
- 再补加密

那样最后只会返工。

## 12. 最终验收清单

### 12.1 工程验收

- `npm install` 成功
- `npm run dev` 成功启动
- `npm run build` 成功
- `npm run typecheck` 成功

### 12.2 登录验收

- 点击登录可真实拉起 Keymaster popup
- `identity.get` 成功后页面显示当前身份
- `aud` 使用的是当前页面 origin，不是 target origin
- 用户拒绝时页面明确显示失败原因

### 12.3 编辑器验收

- 主编辑区使用 BlockNote，不是原生 textarea
- 交互有 Notion 风格的块编辑体验
- 编辑内容可以稳定导出为 markdown

### 12.4 存储验收

- 新建 note 时必须生成合法 path
- 非法 path 无法保存
- 同 path 冲突无法覆盖已有 note
- notes 以本地 KV 方式持久化
- 树结构完全由 key path 派生

### 12.5 加密验收

- 保存 note 时调用 `cipher.encrypt`
- 本地落库的是 `nonce + cipherbytes`
- localStorage / IndexedDB 中不存在明文 markdown 真值
- 打开 note 时调用 `cipher.decrypt`
- 解密成功后可回到编辑态

### 12.6 tag 搜索验收

- tag 明文持久化
- 可按 tag 本地搜索
- 搜索不依赖解密所有 note

### 12.7 异常验收

- popup 被拦截时有明确错误
- `ready_timeout` 有明确错误
- `result_timeout` 有明确错误
- `user_rejected` 有明确错误
- `active_key_unavailable` 有明确错误
- `decrypt_failed` 时 note 不会被自动删掉

### 12.8 视觉验收

- 第一眼是 Notion 风格工作区，不是协议测试台
- 左侧树、中间编辑区、右侧面板层级清楚
- 桌面端布局稳定
- 移动端至少可以查看、登录、打开、编辑、保存

## 13. 收口结论

本次 Notes Demo 的首版真值已经固定为：

- 登录：`identity.get`
- 加解密：`cipher.encrypt` / `cipher.decrypt`
- 编辑器：`BlockNote`
- 内容真值：`markdown`
- 存储真值：本地 `key(path) -> noteRecord`
- 树真值：由 key path 派生
- 搜索真值：明文 `tags`
- UI 真值：Notion 工作区风格

如果后续施工过程中发现某个点实现困难，允许：

- 缩减非核心 UI 细节
- 缩减非 markdown 友好块类型
- 缩减动画和次要交互

但不允许动以下核心边界：

- 不能去掉真实 Keymaster 登录
- 不能去掉真实 Keymaster 加解密
- 不能把 markdown 真值改成 BlockNote JSON
- 不能把 path 树改成额外 folder 真值
- 不能把密文存储改成明文存储
