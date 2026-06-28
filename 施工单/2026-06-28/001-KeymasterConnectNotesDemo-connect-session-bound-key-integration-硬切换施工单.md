# 001 KeymasterConnectNotesDemo 接入 Connect Session 绑定 Key + Resume/Logout 硬切换一次性施工单

## 参考文档与依赖项目

本次施工、联调、验收以下列文档与代码为准：

- 本仓库：
  - `README.md`
  - `src/App.tsx`
  - `src/lib/keymaster.ts`
  - `src/lib/popupSessionClient.ts`
  - `src/lib/connectClient.ts`
  - `src/lib/storage.ts`
  - `src/components/LockScreen.tsx`
  - `src/components/ConnectStatus.tsx`
  - `src/i18n/messages.ts`
- 依赖项目：
  - `/home/david/Workspaces/keymaster.cc/施工单/2026-06-28/001-connect-session-bound-key-and-popup-unlock-runtime-hard-switch.md`

发生冲突时：

1. Keymaster 协议真值以依赖项目那份施工单为准。
2. 本单只定义 notes demo 如何接入与落地 caller 状态机。
3. 后续若再改 notes demo connect 行为，必须先同步改两边施工单，再改代码。

> **关于第 1 章「本单定位」中列出的旧模型条目**
>
> 本单第 1 章列出的"旧模型"项目（包括"`identity.get` = 登录真值"等）**仅作历史对照**，用于说明本次硬切换把 notes demo 从哪套边界切到哪套边界。**这些条目不是当前产品真值的描述**。
>
> 当前产品真值、协议真值、登录入口定义以本单第 3-5 章 + [施工单/2026-06-28/002](../2026-06-28/002-KeymasterConnectNotesDemo-protocol-business-methods-bind-connect-session-硬切换施工单.md) 为准。
>
> 验收口径：搜索本仓库时若命中本单第 1 章旧模型条目中的 `identity.get` 字样，按"已说明为旧模型的历史对照条目"处理，不计入"残留旧叙事"。

---

## 1. 本单定位

本单不是在现有 `identity.get` 登录壳上继续打补丁，也不是“继续保留 identity 内存态，只要 popup 断了就猜一把还能不能恢复”的过渡方案。

本单定义一次**硬切换**，目标是把当前 notes demo 从下面这套旧模型：

- `identity.get` = 登录真值；
- popup transport 断了，caller 也基本丢失稳定身份语义；
- popup 刷新/关闭后，caller 要重新登录；
- `cipher.*` 隐式依赖 Keymaster 当前 active key；

切到下面这套新定义：

- 登录真值 = `connectSessionId`
- owner 真值 = session 绑定的 `ownerPublicKeyHex`
- popup transport 断开 != 登录失效
- caller 页面刷新后优先 `resume`
- popup 刷新/关闭后只补解锁，不补登录
- 直到 caller 主动 `logout`，或 session/key 自身失效，才真正退回登录页

后续实现、联调、验收以本单为单真值。

---

## 2. 简述缘由

### 2.1 旧 `identity.get` 模型只适合一次性身份请求，不适合 note 的持续工作区

当前 notes demo 的登录真值是：

- 用户点击登录；
- 发一次 `identity.get`；
- 把 `publicKeyHex` 放进内存态 `identity`；
- 后续工作区都建立在这份快照上。

问题是：

- 这只是一次性身份断言；
- 不是持续登录 session；
- popup 断线、刷新、关闭后，caller 很难证明自己仍然绑定同一个 owner；
- 更糟的是 `cipher.*` 还受 Keymaster 全局 active key 影响。

### 2.2 note 需要的是“持续会话 + 必要时补解锁”

对 note 来说，更合理的行为是：

1. 第一次登录时选定一个 owner/key；
2. 之后尽量一直用这一把 key；
3. caller 刷新、popup 关闭重开、transport 抖动时，只要 session 还在，就恢复；
4. 如果只是 popup 当前文档解锁态丢了，只要求重新输入密码。

这正是 `connect.login / resume / logout` 模型能提供的能力。

### 2.3 active key 漂移会直接污染本地 owner 分区

当前本地数据按 `publicKeyHex` 分区保存。

若 caller 后续业务请求隐式命中另一把 active key，会直接导致：

- 解密失败；
- 保存写到错误 owner；
- 工作区身份漂移；
- caller 侧几乎无法收口。

所以 notes demo 必须停止依赖 active key，改为只认 connect session 绑定 key。

---

## 3. 最终目标

本次完成后，系统必须达到以下状态：

1. notes demo 不再把 `identity.get` 当长期登录真值。
2. 首次登录走 `connect.login`。
3. notes demo 本地持久化 `connectSessionId`。
4. 页面启动时若已有本地 sessionId，优先自动 `connect.resume`。
5. `resume` 成功则直接恢复工作区，不回登录页。
6. `resume` 命中“需要解锁”时，popup 只要求输入密码；caller 不应把它当成重新登录。
7. popup transport 断开后，caller 只把它视为 transport 断开；下次需要时走 `resume` 重建。
8. caller 主动 logout 时，调用 `connect.logout`，再清本地 sessionId 与工作区态。
9. notes 打开/保存使用的 `cipher.*` 都通过 sessionId 执行，不再隐式依赖 active key。

---

## 4. 本单补充定义

### 4.1 notes demo 自己也必须分三层状态

caller 侧固定分三层：

```txt
popup transport state
  idle / opening / connected / disconnected

connect auth state
  anonymous / resuming / authenticated / invalid

workspace state
  locked / restoring / unlocked
```

约束：

1. `transport disconnected` 不自动等于 `auth invalid`。
2. `auth authenticated` 但 popup 当前未解锁时，workspace 可以处于 `restoring`，不等于回登录页。
3. 只有真正 `auth invalid` 才退回“需要登录”的锁屏页。

### 4.2 本地持久化的真值不是 identity，而是 connectSession

本次 notes demo 本地持久化一条 connect session 记录，至少包含：

- `connectSessionId`
- `ownerPublicKeyHex`
- `targetOrigin`
- `claimsSnapshot`
- `resolvedAt`

关键约束：

1. 本地持久化这条记录；
2. 不持久化 popup transport 句柄；
3. 不持久化 popup unlock runtime；
4. 不持久化用户密码。

### 4.3 LockScreen 语义改成“无 session 才登录，有 session 优先恢复”

本次固定：

- 没有本地 `connectSessionId`：显示真正登录页
- 有本地 `connectSessionId`：优先自动恢复
- 只有恢复失败且确定 session 无效时，才回真正登录页

这意味着：

1. 刷新页面后，不再必然停在“重新登录”；
2. 更常见的路径是“恢复中 -> 需要解锁 -> 进入工作区”；
3. `LockScreen` 不再只代表“未登录”，而要区分：
   - `需要登录`
   - `正在恢复`
   - `恢复失败`

### 4.4 notes demo 的“logout”必须是显式动作

本次固定：

- 用户点击“切换身份 / 更换登录器”不再只是本地清空
- 它必须先发 `connect.logout`
- 成功后再清 caller 本地 session 与工作区态

只有下面这些情况允许直接本地清空并回登录页：

1. `connect.logout` 已成功
2. session 已被服务端判定无效
3. 本地 session 记录损坏/非法

单纯 popup transport 断开，不允许直接把用户登出。

---

## 5. 最终行为定义

## 5.1 首次登录

用户首次进入时：

1. `LockScreen` 显示登录入口；
2. 用户输入/确认 `targetOrigin`；
3. 点击登录；
4. notes demo 调 `connect.login`；
5. popup 若未解锁，先要求输入密码；
6. popup 显式让用户选择 key；
7. 成功后 caller 写本地 `connectSessionId`；
8. 以返回的 `ownerPublicKeyHex` 加载 owner 分区；
9. 进入工作区。

## 5.2 页面刷新

页面刷新后：

1. notes demo 读取本地 `connectSessionId`；
2. 若存在，自动进入 `resuming`；
3. 打开 popup，等待 `ready`；
4. 发 `connect.resume`；
5. 若 popup 当前未解锁，只要求输入密码；
6. 解锁成功后恢复原 session；
7. 加载同一个 `ownerPublicKeyHex` 分区；
8. 进入工作区；
9. 不重新登录，不重新选 key。

## 5.3 popup transport 断开

运行中 popup 关闭、刷新、transport 断开时：

1. notes demo 仅更新 transport 状态为 `disconnected`；
2. 不立即清本地 `connectSessionId`；
3. 不立即清本地 owner 分区；
4. 下次需要协议请求时，优先重建 popup 并 `resume`；
5. 若只是要求解锁，则补密码；
6. 若 session 已失效，才真正回登录页。

## 5.4 保存 / 打开 note

`cipher.encrypt/decrypt` 的调用语义改成：

1. 每次请求都带 `connectSessionId`；
2. Keymaster 根据 session 绑定 key 执行；
3. caller 不再猜当前 active key；
4. 解密失败只保留“session/key 不匹配或密文问题”等业务语义；
5. 不再出现“钱包主站切换 active key，notes 当前 owner 漂移”的路径。

## 5.5 logout

用户显式退出时：

1. notes demo 调 `connect.logout(connectSessionId)`；
2. 成功后清本地 session 记录；
3. 清空工作区内存态；
4. 回到真正登录页；
5. 后续只能重新 login。

---

## 6. 特殊情况提前定义

## 6.1 本地有 sessionId，但 `resume` 时 popup 要求解锁

处理：

1. caller 进入 `restoring`；
2. popup 显示解锁；
3. 用户输入密码；
4. 恢复成功后继续进入工作区；
5. 不回登录页；
6. 不显示“需要重新登录”错误。

## 6.2 本地有 sessionId，但 `resume` 返回 session 无效

处理：

1. caller 清掉本地 session 记录；
2. 清掉工作区态；
3. 回真正登录页；
4. 显示“会话已失效，请重新登录”。

## 6.3 本地有 sessionId，但绑定 key 已被删除

处理：

1. `resume` 失败；
2. caller 清本地 session；
3. 回登录页；
4. 不自动切其它 key。

## 6.4 用户在 Keymaster 主站切 active key

处理：

1. 不影响当前 notes session；
2. notes 继续使用 session 绑定 key；
3. 不清 session；
4. 不发生 owner 漂移。

## 6.5 popup 刷新

处理：

1. popup 当前解锁运行时丢失；
2. caller 下次请求时走 `resume`；
3. 若要求密码，则补解锁；
4. 不回真正登录页。

## 6.6 用户点击 logout，但 transport 中途断开

处理：

1. caller 不要直接乐观地保留会话；
2. 可以重试一次 `logout`；
3. 若无法确认服务端已吊销，caller 应保守地清本地并提示用户；
4. 下次启动时若服务端 session 仍在，可通过 `resume` 再恢复。

### 6.6.1 本次不做复杂 logout 补偿事务

按当前项目“简单优先”的原则：

1. logout 不做多步补偿；
2. 不维护“待吊销 logout 队列”；
3. 无法确认时允许本地先清掉，后续靠 `resume` 的实际结果收敛。

## 6.7 caller 有 sessionId，但 targetOrigin 改了

处理：

1. 当前本地 session 记录作废；
2. 不允许跨 origin 复用；
3. 用户必须在新 origin 上重新 login。

---

## 7. 不能怎么做

下面这些做法本单明确禁止：

1. 继续把 `identity.get` 当 notes demo 的持续登录真值。
2. 继续把 popup transport 是否还活着，当成登录态是否还活着。
3. 页面刷新后一律回真正登录页，忽略本地 sessionId。
4. `resume` 要求重新选 key。
5. `resume` 要求重新 login。
6. 在 notes demo 本地持久化用户密码或 popup 解锁态。
7. caller 继续假设 `cipher.*` 命中的是当前 active key。
8. popup transport 抖动就直接清掉本地 sessionId。
9. 当 session 绑定 key 失效时，自动换成另一把 key 继续工作。
10. logout 只做本地清空，不调用 Keymaster 吊销 session。

---

## 8. 文件级实施方案

## 8.1 `README.md`

目标：

- 更新产品定义，不再写“刷新后一定回 LockScreen 并重新登录”这套旧语义。

需要做的事：

1. 把登录真值从 `identity.get` 改为 `connect session`。
2. 明确“刷新页面后优先 resume”。
3. 明确 popup refresh 只丢 unlock，不丢 auth session。
4. 明确 caller 主动 logout 才是真正退出。

## 8.2 `src/lib/keymaster.ts`

目标：

- 收口新的协议请求/响应构造与解析。

需要做的事：

1. 新增 `buildConnectLoginRequest`
2. 新增 `buildConnectResumeRequest`
3. 新增 `buildConnectLogoutRequest`
4. 新增解析 connect session 结果的 helper
5. 修改 `buildCipherEncryptRequest`
6. 修改 `buildCipherDecryptRequest`
7. 为 `cipher.*` 增加 `connectSessionId` 参数

不能做的事：

1. 继续让 `cipher.*` 不带 sessionId
2. 继续让业务层隐式靠 active key

## 8.3 `src/App.tsx`

目标：

- 顶层状态机从 “identity null / non-null” 改成 “session null / resuming / active”。

需要做的事：

1. 新增本地持久化 `connectSessionRecord`
2. 启动时自动读取 session 记录
3. 若存在，自动走 `resume`
4. `handleLogin()` 改成 `connect.login`
5. 新增 `handleResume()`
6. `handleSwitchIdentity()` 改成显式 `logout`
7. 工作区 owner 真值改为 `connectSession.ownerPublicKeyHex`
8. `cipher.*` 请求都带 `connectSessionId`
9. transport disconnected 时不立刻清 session

关键收口：

1. `session invalid` 才回真正登录页；
2. `unlock required` 只表现为恢复中/等待 popup；
3. 工作区选择、搜索、编辑、decrypt/open/save 仍按原有业务态工作。

## 8.4 `src/lib/storage.ts`

目标：

- 继续按 owner 分区保存 notes 数据，但 owner 真值改为 connect session 绑定 key。

需要做的事：

1. 保持按 `ownerPublicKeyHex` 分区
2. 加一套 connect session 本地记录存取 helper
3. 不混入 popup transport 状态

## 8.5 `src/components/LockScreen.tsx`

目标：

- 从“纯登录页”改成“登录 / 恢复中 / 恢复失败”的入口壳。

需要做的事：

1. 增加 `resuming` 显示态
2. 增加“恢复失败，重新登录”提示
3. 文案区分“请输入 target origin 登录”与“正在恢复已授权会话”
4. 恢复中时禁用重复点击

## 8.6 `src/components/ConnectStatus.tsx`

目标：

- 已登录态页头展示 connect session 语义，而不是旧 identity 快照语义。

需要做的事：

1. 显示当前 `ownerPublicKeyHex`
2. 显示当前 `targetOrigin`
3. 显示 transport 状态
4. 提供“重新连接/恢复”入口
5. 提供真正的 `logout` 入口

关键约束：

1. `transport disconnected` 显示断线，但不自动变成“未登录”
2. logout 是强动作

## 8.7 `src/lib/popupSessionClient.ts`

目标：

- 保持它只做 transport，不再承载 auth 真值。

需要做的事：

1. 继续保留 `ready/closing/popup.closed` 的窗口级状态机
2. 不把 `disconnected` 升格成 logout
3. 允许 caller 在后续通过新的 `resume` 恢复 auth session

## 8.8 `src/i18n/messages.ts` / `src/i18n/types.ts`

目标：

- 增加 connect session / resume / logout / unlock required 文案。

需要做的事：

1. 登录成功
2. 正在恢复
3. 需要解锁
4. 会话失效
5. logout 成功/失败
6. transport 断开但 session 仍可恢复

## 8.9 `README.md` 验收步骤部分

目标：

- 用新的用户路径替换旧的“刷新后重新登录”叙述。

需要做的事：

1. 首次 login
2. 刷新后 auto-resume
3. popup refresh 后补密码恢复
4. logout
5. key 被删除后重新登录

---

## 9. 最终验收清单

### 9.1 首次登录

1. 打开 notes demo。
2. 无本地 session 记录时显示登录页。
3. 点击登录后走 `connect.login`。
4. popup 若未解锁，要求输入密码。
5. popup 选定 key 并确认。
6. notes demo 保存 `connectSessionId`。
7. 进入 owner 对应工作区。

### 9.2 页面刷新

1. 工作区内刷新页面。
2. notes demo 自动读取本地 session。
3. 自动发 `connect.resume`。
4. 若 popup 当前未解锁，只要求输入密码。
5. 解锁后直接恢复工作区。
6. 不重新登录，不重新选 key。

### 9.3 popup 刷新

1. 已登录并正常工作时刷新 popup。
2. unlock runtime 丢失。
3. 下次 notes 触发协议请求时，popup 要求输入密码。
4. 解锁后继续原工作区。
5. 不回登录页。

### 9.4 transport 断开

1. 手工关闭 popup。
2. notes 页头显示 transport 已断开。
3. 本地 session 仍保留。
4. 下次请求时重开 popup 并 `resume`。
5. 能恢复则继续工作。

### 9.5 active key 变化

1. 在 Keymaster 主站切换 active key。
2. 回到 notes。
3. notes 继续使用原 session 绑定 owner。
4. 打开、保存、解密不漂移到新 active key。

### 9.6 session 无效

1. 吊销服务端 session 或删除绑定 key。
2. notes 下次 `resume` 失败。
3. 本地 session 被清。
4. 页面回真正登录页。

### 9.7 logout

1. 用户点击退出/切换身份。
2. notes demo 调 `connect.logout`。
3. 本地 session 被清。
4. 工作区态清空。
5. 后续只能重新 login。

### 9.8 安全边界

1. 本地不存在持久化的用户密码。
2. 本地不存在持久化的 popup 解锁运行时材料。
3. popup 刷新/关闭后必须重新输入密码恢复 unlock。
4. popup transport 断开不自动等于 caller 被登出。

---

## 10. 本次落地完成的标志

满足以下全部条件，才算本单完成：

1. notes demo 登录真值已经从 `identity.get` 切换为 `connectSessionId`。
2. 页面刷新与 popup 刷新都能优先通过 `resume` 恢复，而不是重新 login。
3. `cipher.*` 已只通过 session 绑定 key 执行，不再依赖 active key。
4. popup transport 生命周期与 caller auth 生命周期已经彻底解耦。
5. logout 已成为唯一正常退出路径。
6. 文档、代码、验收口径全部收敛到这套新定义，不再保留旧路线。
