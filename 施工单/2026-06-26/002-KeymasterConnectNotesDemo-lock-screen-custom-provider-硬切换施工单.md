# KeymasterConnectNotesDemo LockScreen 与自定义登录器硬切换一次性施工单

> **本施工单已被取代（archived）**
>
> 本单描述的是「LockScreen + 自定义登录器」硬切换的**当时设计**，其中：
> - 「用同样的 `identity.get` / `cipher.*` 登录与操作」等条目属于 **旧模型** 下的产品定位；
> - 旧模型已被后续两份硬切换施工单完全取代：
>   - [施工单/2026-06-28/001 connect-session-bound-key-integration 硬切换](../2026-06-28/001-KeymasterConnectNotesDemo-connect-session-bound-key-integration-硬切换施工单.md)（登录真值切到 `connectSessionId`）
>   - [施工单/2026-06-28/002 protocol-business-methods-bind-connect-session 硬切换](../2026-06-28/002-KeymasterConnectNotesDemo-protocol-business-methods-bind-connect-session-硬切换施工单.md)（`identity.get` 重新定位为「会话内身份断言能力」、其 contract 切到 session-bound）
>
> 本单仅作历史归档。LockScreen 当前形态、登录入口协议真值均以上述两份后续施工单为准；本单中关于「用同样的 `identity.get` 登录」的表述不构成对当前 demo 行为的描述。
>
> 验收口径：搜索本仓库时若仍命中本施工单中的 `identity.get` 字样，按"已归档的旧模型描述"处理，不计入"残留旧叙事"。

## 1. 本单定位

本单不是补丁说明，不是“先加个恢复 identity 的小修”，也不是分阶段迁移方案。

本单定义一次**硬切换**：

- 未登录态不再进入 notes 工作区
- 页面顶层改成 `LockScreen -> NotesApp` 二段式结构
- 登录入口支持用户自定义 `target origin / url`
- notes 数据空间仍然只按 `ownerPublicKeyHex` 分区
- 不做 identity 本地恢复
- 不做“未登录先展示上次文件树”的半状态

后续实现、测试、验收都以本单为单真值。若与旧施工单冲突，以本单为准。

## 2. 简述缘由

### 2.1 现在的问题不在“树丢了”，而在“状态机不干净”

当前实现里：

- folder / note 数据是按 `ownerPublicKeyHex` 落到 localStorage
- 但页面刷新后 `identity` 会回到内存空态
- UI 又仍然保留 notes 页框架
- 于是用户看到的是“左侧树消失了”

这会制造一个坏心智：

- 用户以为数据丢了
- 实际上只是没有当前 owner 身份

这不是存储问题，是页面分层问题。

### 2.2 为什么不建议做 identity 恢复补丁

如果为了解决“刷新后树不见了”去补：

- identity 快照持久化
- 页面启动自动恢复 identity
- 再自动回填 owner 空间

会把一个本来很简单的 demo 做成半登录态系统：

- 视觉上像已登录
- 但协议会话其实没恢复
- `cipher.decrypt` / `cipher.encrypt` 是否真可用还得再次碰运气

这会让“登录”和“已拿到 owner”混成一坨，边界变脏。

### 2.3 为什么改成 LockScreen 更合理

更合理的页面语义应该是：

- 未登录：只有登录入口与协议能力说明
- 已登录：才允许进入 notes 工作区

这样做的收益：

1. notes space 明确依赖当前 owner 身份
2. 页面状态机变成二段式，逻辑更干净
3. 刷新后回到 lock 页面是可解释行为，不是假装“还在工作区里”
4. 不需要引入 identity 恢复、会话恢复、幽灵登录态

### 2.4 为什么要支持自定义登录器

这个 demo 本质上不是“Keymaster 官网专属产品”，而是：

- 一个使用既定协议的外部调用方

因此登录入口只写死 `https://keymaster.cc` 不够完整。

应该允许用户：

- 输入任意 `target origin`
- 只要对方实现相同协议
- 就用同样的 `identity.get` / `cipher.encrypt` / `cipher.decrypt` 登录与操作

这才符合“协议调用方 demo”的真实定位。

## 3. 最终产品模型

页面顶层固定分为两态：

### 3.1 LockScreen

只在 `identity === null` 时显示。

内容只包含：

- 产品标题与简述
- 当前 demo 依赖的协议能力说明
- `target origin / url` 输入框
- 一个“使用默认地址”快捷入口
- 一个大号登录按钮
- 最近一次登录错误提示

明确不要：

- 文件夹树
- 笔记列表
- 编辑器
- 右侧 inspector
- 任何 owner 数据摘要

### 3.2 Notes 页面

只在 `identity !== null` 时显示。

内容基本沿用当前主页面：

- 顶部连接信息 / owner 摘要 / 当前 target origin
- 左侧文件夹树与 note 树
- 中间编辑器
- 右侧 inspector

新增一个明确动作：

- `切换身份 / 更换登录器`

点击后直接退回 `LockScreen`。

## 4. 顶层状态机

## 4.1 状态定义

本次页面状态必须明确分成两层：

1. 登录壳层
2. notes 工作区层

推荐心智：

- `locked`
- `unlocked`

但实现上不必强制额外引枚举；只要保证：

- `identity === null` 时只渲染 `LockScreen`
- `identity !== null` 时才渲染 notes 工作区

## 4.2 刷新行为

刷新页面后：

- 回到 `LockScreen`
- 不恢复 identity
- 不直接加载某个 owner 的 notes space

这是本次硬切换的明确产品定义，不是缺陷。

## 4.3 登录成功行为

登录成功后：

1. 解析 `identity.get` 返回结果
2. 写入内存态 `identity`
3. 按 `identity.publicKeyHex` 调 `loadOwnerSpace`
4. 进入 notes 页面

## 4.4 切换身份 / 更换登录器

点击后必须：

- 清空 `identity`
- 清空当前 `space`
- 清空 `pendingDrafts`
- 清空 `selection`
- 清空 `draft`
- 清空右键菜单 / 拖拽 / move 态
- 清空解密缓存
- 回到 `LockScreen`

但不删除 localStorage 中已有 owner 分区数据。

## 5. 自定义登录器模型

## 5.1 输入语义

`LockScreen` 上允许用户输入：

- 完整 URL，或
- 至少能被 `new URL(...).origin` 归一出的字符串

最终系统只使用其 `origin` 部分。

例如：

- `https://keymaster.cc`
- `https://keymaster.cc/popup`
- `https://demo.example.com/anything?a=1`

最终都归一为对应的 `origin`。

## 5.2 真正参与协议的是 target origin

本次必须明确：

- 登录器配置真值是 `targetOrigin`
- 不是“整条用户输入字符串”
- 更不是某个 provider id

所以页面里应该用：

- 输入框承载用户输入
- `normalizeOrigin` 负责归一与校验

## 5.3 默认值

默认值仍然是：

```txt
https://keymaster.cc
```

LockScreen 上需要提供一个明确动作：

- `使用默认地址`

用于快速回填默认值。

## 5.4 不做什么

本次不做：

- provider 列表管理
- 多登录器收藏夹
- 最近使用记录
- 自动探测协议能力
- 自动发现 popup path 之外的路由

也就是说：

- 用户输入 origin
- 系统按现有协议路径规则拼 popup URL
- 能通就登录
- 不能通就报错

## 6. owner 分区与跨登录器语义

## 6.1 存储分区规则不变

notes 数据空间继续只按：

```txt
ownerPublicKeyHex
```

分区。

仍然类似：

```txt
notes-demo:owner:{publicKeyHex}
```

## 6.2 为什么不能按 target origin 再分一层

本次明确不要把 storage key 改成：

- `origin + owner` 双因子
- 或 provider 维度分桶

原因很直接：

- 本 demo 的业务真值是“owner 的 notes 空间”
- 不是“某个登录器厂商下的 notes 空间”

如果两个登录器返回同一个 owner：

- 就应该命中同一份本地数据

否则会把同一个人的数据人为拆成两份。

## 6.3 必须提前说清楚的边界

“同一个 owner”只保证：

- 本地命中同一个数据分区

不自动保证：

- 一定能成功解密旧 note
- 一定能成功保存新 note

要想后续操作完全一致，要求：

- 对方登录器里也导入了同一把私钥
- `cipher.encrypt` / `cipher.decrypt` 语义兼容

所以产品解释必须固定成：

1. 同 owner：能看到同一棵树
2. 同私钥且协议兼容：才能正常打开和保存正文
3. owner 一样但解密失败：树还在，note 进入解密失败态

## 7. 特殊情况处理

## 7.1 自定义 URL 非法

例如：

- 不是合法 URL
- 不能归一出合法 origin

处理：

- 阻断登录
- 在 LockScreen 明确提示 `Target origin 非法。`

不做自动猜测与自动修正。

## 7.2 popup 被拦截 / provider 不可达

处理保持现有 transport 语义：

- popup 被拦截：显示错误
- ready timeout：显示错误
- result timeout：显示错误

不做自动重试。

## 7.3 登录器切换后 owner 相同

处理：

- 登录成功后进入相同 owner 分区
- 文件树应与之前一致

这是正常行为，不需要额外提示“数据迁移成功”之类文案。

## 7.4 登录器切换后 owner 不同

处理：

- 进入另一个 owner 分区
- 若该 owner 没有历史数据，则显示空树

这是正常行为，不是数据丢失。

## 7.5 登录器切换后 owner 相同但解密失败

处理：

- 左侧树照常显示
- note 点击后进入解密失败态
- 不自动覆盖密文
- 仍允许删除
- 仍允许切换回别的登录器重试

这类情况必须提前认定为正常边界，而不是异常补丁场景。

## 7.6 刷新页面

处理：

- 回到 `LockScreen`
- 用户重新输入或确认 `target origin`
- 重新登录后再进入 notes

明确不做：

- 刷新后自动显示上次 owner 树
- 刷新后自动恢复为“看起来已登录”

## 7.7 已有未保存 draft 时切换身份

处理从简：

- 直接退回 `LockScreen`
- 内存 draft 丢弃

原因：

- drafts 本来就不持久化
- 切换身份本质就是退出当前工作区

不建议为此增加复杂的跨身份草稿保护机制。

## 8. 不能怎么做

本次明确禁止：

1. 不能在未登录态继续渲染 notes 工作区外壳。
2. 不能为了“刷新后不断片”去持久化 identity 快照。
3. 不能做“未登录但先展示上次 owner 文件树”的半状态。
4. 不能把 notes space 改成按 `targetOrigin + owner` 双维度分区。
5. 不能把自定义登录器理解成新的账号体系。
6. 不能把 provider URL 写进 folder / note record。
7. 不能在 localStorage 里缓存明文 markdown。
8. 不能在切换登录器时自动迁移、复制、重写已有密文。
9. 不能因为 owner 相同就假定一定可解密。
10. 不能做自动重试、自动回退默认 origin、自动修正 URL。
11. 不能做“登录失败后偷偷保留旧工作区继续可见”。
12. 不能引入多 provider 管理、收藏、最近记录等额外系统。

## 9. 文件级施工清单

## 9.1 `src/App.tsx`

改造内容：

- 顶层渲染从“永远显示主工作区”改成“LockScreen / Notes 页面二选一”
- `identity === null` 时只渲染 `LockScreen`
- 登录成功后再加载 `loadOwnerSpace(identity.publicKeyHex)`
- `onForget` 语义改成“切换身份 / 更换登录器”，退回 `LockScreen`
- 清理 notes 工作区内存态时统一收口
- 保持 `commitSpace` 仍只按 `identity.publicKeyHex` 落库

明确不要：

- 在初始化时自动恢复上次 identity
- 在未登录态提前读取 owner 空间

## 9.2 `src/components/LockScreen.tsx`

新增文件。

职责：

- 显示产品介绍
- 显示协议能力说明
- 提供 `target origin / url` 输入
- 提供“使用默认地址”动作
- 提供大号登录按钮
- 展示最近错误

注意：

- 这里只是登录壳，不承载任何 notes 数据
- 不展示文件树预览
- 不展示最近 owner

## 9.3 `src/components/ConnectStatus.tsx`

改造内容：

- 缩小职责到 notes 页头状态展示
- 已登录态继续显示：
  - `page origin`
  - `target origin`
  - `publicKey`
  - `last login`
- 按钮文案调整成更符合新模型：
  - `重新登录`
  - `切换身份 / 更换登录器`

不要继续承担未登录主入口页面职责。

## 9.4 `src/lib/connectClient.ts`

原则上不改协议边界。

只需确认并复用：

- `normalizeOrigin`
- popup URL 拼接
- transport 错误语义

不要在这里增加：

- provider 探测逻辑
- 自动 fallback origin
- origin 历史缓存

## 9.5 `src/lib/popupSessionClient.ts`

原则上只维持现有 session client 职责。

如需改动，只允许围绕：

- 切换 `targetOrigin` 后重建 session

不要把登录壳页面逻辑塞进 session client。

## 9.6 `src/lib/storage.ts`

原则上不改 owner 分区模型。

只需保证：

- 仍按 `ownerPublicKeyHex` 分区
- 不引入 `targetOrigin` 维度

## 9.7 `src/styles.css`

改造内容：

- 增加 LockScreen 样式
- 保持 notes 工作区现有视觉结构
- 区分登录壳页与工作区页的布局层次

注意：

- 不要做成“工作区空态 + 一个登录按钮”那种混合界面
- 要明确看起来就是单独一页 lock 页面

## 9.8 `README.md`

改造内容：

- 更新产品定位说明
- 更新页面结构说明：`LockScreen -> Notes`
- 更新自定义登录器说明
- 更新 owner 分区边界说明
- 更新刷新页面后的预期行为
- 更新手工验收步骤

## 9.9 `施工单/`

本单落地后，后续关于登录壳、自定义 provider、owner 分区边界的迭代，都以本单为准，不再回到“刷新后偷偷恢复 identity”的路线。

## 10. 推荐实现顺序

本次虽然是硬切换，但实现时建议按下面顺序一次完成：

1. 先抽出 `LockScreen` 组件
2. 再把 `App.tsx` 改成顶层二态渲染
3. 再收口“登录成功后加载 owner space”的时机
4. 再调整 `ConnectStatus` 文案与退出动作
5. 最后补样式与 README

这是编码顺序，不是分阶段上线。

## 11. 最终验收清单

## 11.1 工程验收

- `npm install` 成功
- `npm run typecheck` 成功
- `npm run build` 成功

## 11.2 LockScreen 验收

- 首次打开页面，只看到 `LockScreen`
- LockScreen 上没有文件树、编辑器、inspector
- LockScreen 上有 `target origin / url` 输入框
- LockScreen 上有“使用默认地址”动作
- LockScreen 上有大号登录按钮
- LockScreen 上能展示最近一次登录错误

## 11.3 登录成功验收

- 输入默认 `https://keymaster.cc` 可正常拉起登录
- 登录成功后进入 notes 页面
- notes 页面显示当前 owner 摘要
- notes 页面显示当前 `target origin`
- 登录成功后才读取并展示对应 owner 的 folder/note 树

## 11.4 刷新行为验收

- 在 notes 页面刷新
- 页面回到 `LockScreen`
- 不显示旧文件树
- 重新登录后，再次显示对应 owner 的树

## 11.5 自定义登录器验收

- 输入合法自定义 URL，能归一到正确 origin
- 若对方实现相同协议，可正常登录
- 若 provider 不可达或协议不通，页面明确报错
- 非法 URL 时，不允许发起登录

## 11.6 owner 分区验收

- 用 provider A 登录 owner X，创建 folder/note 并保存
- 切换到 provider B
- 若 provider B 返回 owner X：
  - 应看到同一份树
- 若 provider B 返回 owner Y：
  - 应看到 owner Y 自己的空间或空树

## 11.7 解密边界验收

- provider A 登录 owner X 后创建并保存 note
- 切换到另一个 provider
- 若 owner 相同但对方不能解密：
  - 左侧树仍可见
  - 点击 note 后进入解密失败态
  - 原密文不被覆盖
  - note 仍允许删除

## 11.8 切换身份验收

- 点击“切换身份 / 更换登录器”
- 页面立即回到 `LockScreen`
- 当前编辑区、选中态、draft、拖拽态全部清空
- localStorage 中原 owner 数据仍保留

## 11.9 回归验收

- 已登录态下原有 folder/note 树功能仍正常
- 新建 note 首次保存前仍不落库
- 保存仍调用 `cipher.encrypt`
- 打开 note 仍调用 `cipher.decrypt`
- 非空文件夹仍不可删除
- 右键菜单与拖拽仍共用同一套 move 真值

## 12. 收口结论

本次硬切换后的最终页面模型固定为：

- 未登录：`LockScreen`
- 已登录：`Notes 页面`
- 登录器：用户可输入自定义 `target origin`
- 数据分区：只按 `ownerPublicKeyHex`
- 刷新行为：回到 `LockScreen`
- 同 owner：命中同一份树
- 同 owner 但不可解密：树存在，正文可能失败

如果后续要裁剪范围，允许裁剪：

- LockScreen 的视觉装饰
- 说明文案的长短
- 默认地址快捷入口的表现形式

但不允许动以下核心边界：

- 不能恢复“未登录也显示 notes 工作区”的旧页面结构
- 不能走 identity 本地恢复路线
- 不能把数据分区改成 `targetOrigin + owner`
- 不能因为同 owner 就假定一定可解密
- 不能在未登录态暴露任何 owner 文件树
