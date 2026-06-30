# 001 KeymasterConnectNotesDemo Open App + appView + connect.launch 硬切换一次性施工单

## 参考文档与依赖项目

本次施工、联调、验收以下列文档与代码为准：

- 本仓库：
  - `README.md`
  - `src/App.tsx`
  - `src/lib/protocol.ts`
  - `src/lib/keymaster.ts`
  - `src/lib/connectClient.ts`
  - `src/lib/popupSessionClient.ts`
  - `src/lib/storage.ts`
  - `src/components/LockScreen.tsx`
  - `src/components/ConnectStatus.tsx`
  - `src/i18n/messages.ts`
  - `src/i18n/types.ts`
- 本仓库既有施工单：
  - `施工单/2026-06-28/001-KeymasterConnectNotesDemo-connect-session-bound-key-integration-硬切换施工单.md`
  - `施工单/2026-06-28/002-KeymasterConnectNotesDemo-protocol-business-methods-bind-connect-session-硬切换施工单.md`
  - `施工单/2026-06-28/003-KeymasterConnectNotesDemo-lock-screen-popup-close-and-relogin-硬切换施工单.md`
- 依赖项目 `keymaster.cc`：
  - `施工单/2026-06-29/001-session-window-app-view-and-virtual-storage-hard-switch.md`
  - `施工单/2026-06-29/002-plugin-apps-appview-launcher-hard-switch.md`
  - `docs/keymaster-protocol-common-v1-draft.md`
  - `docs/keymaster-connect-v1-draft.md`
  - `packages/contracts/src/protocol.ts`

发生冲突时：

1. 本单关于 JustNote 的 `Open App`、`appView`、`connect.launch`、`window.opener` 复用与启动失败语义优先。
2. 依赖项目里关于 Session Window、`connect.launch`、launcher 预建 session 的公共协议语义继续有效；本单只定义 JustNote 如何接上这套能力。
3. 后续若再改 JustNote 的 appView 启动方式，必须先改本单与 README，再改代码；不允许只改实现。

---

## 1. 本单定位

本单不是“在现有登录壳上加一个 `connect.launch` 分支，以后再慢慢想清楚 appView transport”的过渡方案。

本单定义一次**硬切换**：

- JustNote 必须同时支持两种启动方式：
  - 用户直接打开 `https://justnote.apps.bsv8.com/`
  - 用户从 Keymaster 的 `Open App` 入口拉起
- 两种方式共用**同一套**工作区、同一套 `connect session` 真值、同一套 `cipher.*` 保存/读取路径；
- 区别只允许存在于**启动阶段**：
  - 直接打开：走现有 `connect.login` / `connect.resume`
  - Open App：走 `connect.launch`
- `connect.launch` 成功后，JustNote 必须落本地 `connectSessionId`，后续行为与 `connect.login` 成功完全对齐；
- JustNote 必须能复用 Keymaster Session Window 作为当前 transport 对端，而不是一上来又自己开一扇新的 popup；
- 首次成功接上 `connect.launch` 后，要去掉 URL 里的 `launchToken`，避免刷新后二次消费。

本单目标不是“支持多一种登录按钮”，而是把 JustNote 从“只能自己开 popup 的 client”升级成“既能直开，也能被 Keymaster 作为 appView 正确拉起的 client”。

---

## 2. 简述缘由

### 2.1 现在的 JustNote 还停留在“自己开 popup”的旧模型

当前代码的核心前提是：

1. `PopupSessionClient.ensureSession()` 负责 `window.open(...)`；
2. 首次登录只存在 `connect.login`；
3. 页面刷新后只存在 `connect.resume`；
4. client 永远把自己视为“主动去找 Keymaster 的一方”。

这套模型对“用户手工打开 JustNote，再去连 Keymaster”是成立的，但对 `Open App` 不成立。

在 `Open App` 模型里：

1. Keymaster 的 launcher 已经预建了 `connectSessionId`；
2. Keymaster 的 Session Window 已经存在；
3. Session Window 再主动打开 JustNote；
4. JustNote 首条请求必须是 `connect.launch({ launchToken })`。

因此，JustNote 再继续按“先自己开 popup，再决定登录/恢复”的思路走，就会和上游定义冲突。

### 2.2 `connect.launch` 不是“多一种登录按钮”，而是另一种启动入口

`connect.launch` 的语义不是“把 `connect.login` 复制一份”。

它的真实含义是：

- app 是被 Keymaster launcher 以 appView 模式拉起的；
- launchToken 已经由 launcher 放进 client app URL；
- Session Window 已经绑定了该 app 的 origin、预建 session、owner、claims；
- client app 只需要消费这个 token，把本地状态接上。

因此：

- `connect.launch` 成功后，本地应该生成的不是另一套 session 模型，而是**同一套** `connectSessionId + ownerPublicKeyHex + claims + resolvedAt`；
- 之后 JustNote 的保存、读取、刷新、恢复，仍然都走既有 `connect.resume` / `cipher.*`。

### 2.3 appView 模式下不能再盲目新开 popup

Open App 路径里，JustNote 的 `window.opener` 就是 Keymaster 的 Session Window。

如果 JustNote 在启动时忽略这扇已存在的窗口，立刻自己再开一扇新的 `/protocol/v1/popup`，会出现：

1. 一次 Open App 变成两扇协议窗口；
2. 首次 `connect.launch` 无处发送；
3. URL 里的 `launchToken` 与实际通信窗口脱节；
4. 调试和问题定位都会变脏。

因此 appView 启动期必须优先复用 `window.opener`，不能假装它不存在。

### 2.4 但 appView 成功后，也不能把整个系统永久绑死在 opener 上

系统还需要保持简单和粗暴可恢复。

更合理的收口是：

1. appView 启动期：优先复用 `window.opener` 这扇 Session Window；
2. 启动成功后：本地持久化 `connectSessionId`；
3. 运行期若对端窗口后来关闭，下次请求仍允许重新开一扇新的 Session Window，并走 `connect.resume` 续上。

也就是说：

- 启动期尊重现有 Session Window；
- 运行期不引入“必须长期绑死同一扇窗口”的复杂要求。

这比“永远只认 opener”或“永远忽略 opener”都更合理。

---

## 3. 最终目标

本次完成后，系统必须达到以下状态：

1. 用户直接打开 `https://justnote.apps.bsv8.com/` 时，JustNote 仍可走现有手工登录/恢复路径。
2. 用户从 Keymaster `Open App` 拉起 JustNote 时，JustNote 能识别 appView 启动上下文。
3. appView 启动上下文的最小真值是 URL 里的 `launchToken`。
4. 检测到 `launchToken` 后，JustNote 首条请求必须走 `connect.launch`，而不是 `connect.login`。
5. `connect.launch` 成功后，JustNote 本地持久化的 session 结构与 `connect.login` / `connect.resume` 成功结果完全一致。
6. appView 启动期，JustNote 优先复用 `window.opener` 指向的 Keymaster Session Window，不主动新开 popup。
7. appView 启动成功后，必须从 URL 中移除 `launchToken`，避免刷新后二次消费。
8. `connect.launch` 失败时，JustNote 不自动 fallback 到 `connect.login`。
9. appView 启动失败时，JustNote 显示明确的“请从 Keymaster 重新启动 app”错误态。
10. appView 成功进入工作区后，后续保存/读取/刷新/恢复仍共用现有 `connect session` 真值模型。
11. 运行期如果现有 Session Window 已失效，JustNote 后续请求允许重新开新的 popup，并通过 `connect.resume` 续上，不要求用户重新从 Keymaster 打开整个 app。

---

## 4. 单真值定义

### 4.1 启动模式

本次固定：

```txt
startupMode = "direct" | "appView"
```

定义：

- `direct`
  = 用户直接打开 JustNote URL
  = 没有 `launchToken`
  = 首登走 `connect.login`
- `appView`
  = Keymaster Session Window 打开 JustNote
  = URL 带 `launchToken`
  = 首登走 `connect.launch`

关键约束：

1. 这只是启动模式，不是两套业务系统。
2. 启动成功后，两种模式统一收口到同一套工作区与同一套 `connect session`。

### 4.2 appView 启动真值

本次固定：

```txt
URL query 中的 launchToken
  = JustNote 判断自己是不是被 Open App 拉起的唯一启动真值
```

关键约束：

1. 不额外引入第二个本地“open app mode”布尔存储。
2. 不要求 JustNote 自己持久化 appView 启动上下文。
3. `launchToken` 只用于首次 `connect.launch`，成功后必须从 URL 清掉。

### 4.3 首次连接入口

本次固定：

```txt
direct mode
  => connect.login / connect.resume

appView mode
  => connect.launch
```

关键约束：

1. `connect.launch` 成功前，不能先偷偷发 `connect.login`。
2. `connect.launch` 失败后，不能自动 fallback 到 `connect.login`。
3. `connect.launch` 的成功结果必须与 `connect.login` / `connect.resume` 用同一套解析与持久化结构。

### 4.4 transport 对端

本次固定：

```txt
appView 启动期 transport 对端
  = window.opener 指向的 Session Window
```

关键约束：

1. appView 启动期优先复用 opener，不新开 popup。
2. 运行期若 opener 后续丢失，不要求永远绑定它；后续请求可以重开 popup。

### 4.5 本地 session 真值

本次固定：

```txt
connectSessionId
ownerPublicKeyHex
claimsSnapshot
resolvedAt
targetOrigin
```

关键约束：

1. `connect.launch` 成功后持久化结构与旧路径完全一致。
2. `connect.launch` 不引入第二套“Open App 专用 session record”。

---

## 5. 不能怎么做

1. 不能把 Open App 做成第二个独立 app shell、第二套页面或第二套工作区状态机。

2. 不能检测到 `launchToken` 后，先走一遍 `connect.login`，失败了再试 `connect.launch`。

3. 不能在 `connect.launch` 成功后保留 URL 里的 `launchToken` 不清理。

4. 不能让 appView 启动期忽略 `window.opener`，一上来就自己 `window.open` 一扇新的 popup。

5. 不能把 `window.opener` 永久当作唯一 transport 真值，导致后续对端窗口关闭后整个 app 无法自愈。

6. 不能在 `connect.launch` 失败后自动退化成“锁屏页正常登录”，然后继续装作这是同一次 Open App。

7. 不能新增一份 “openAppSession” / “launchSession” 本地存储，与现有 `connectSessionRecord` 并存。

8. 不能把 `launchToken` 直接存到 localStorage 当长期真值。它是一性消费凭证，不是持久化身份。

9. 不能要求用户在 Open App 路径里手工填写 `targetOrigin`、手工点击“登录”来完成首登。这会把 launcher 价值打掉。

10. 不能为了支持 Open App 把“用户直接打开 URL 手工登录”这条既有路径一起删掉。

---

## 6. 应该怎么做

### 一、把启动模式收口成 `direct` / `appView`

JustNote 顶层启动逻辑先做一件事：

1. 解析当前 URL；
2. 如果存在非空 `launchToken`，则 `startupMode = "appView"`；
3. 否则 `startupMode = "direct"`。

这一步是唯一模式判断入口，后续逻辑都读它，不要各处自己再 parse URL。

### 二、在协议类型层补齐 `connect.launch`

`src/lib/protocol.ts` 必须补齐：

1. `connect.launch` method 名；
2. `ConnectLaunchParams`；
3. `ConnectLaunchResult`；
4. `MethodParamsMap` / `MethodResultMap` 对应项。

要求：

1. `ConnectLaunchResult` 形状与 `ConnectLoginResult` / `ConnectResumeResult` 对齐。
2. 不额外发明 JustNote 私有字段。

### 三、在 `keymaster.ts` 收口 `connect.launch` 构造与解析

`src/lib/keymaster.ts` 必须补：

1. `buildConnectLaunchRequest({ launchToken, requestId })`
2. `parseConnectLaunchResult(...)`

要求：

1. `parseConnectLaunchResult` 直接复用现有 `parseConnectSessionResult` 收口，避免第二套解析路径。
2. `connect.launch` 不带 `aud` / `iat` / `exp` / `text`。

### 四、让 `PopupSessionClient` 支持“收养现有 opener”

`src/lib/popupSessionClient.ts` 不能再只有“自己开 popup”一种模式。

必须补一种能力：

```txt
adopt existing session window
  = 复用当前 window.opener 作为 transport peer
```

最小要求：

1. 当调用方明确指定“尝试复用 opener”时：
   - 若 `window.opener` 存在且未关闭，则把它当作当前 popup 句柄；
   - 安装 message listener；
   - 等它发 `ready`；
   - 不调用 `window.open(...)`
2. 若 opener 不可用，再按原逻辑开新 popup。

设计缘由：

- appView 启动期必须优先复用现成 Session Window；
- 但运行期不强制永久依赖它。

### 五、App 顶层新增 appView 启动状态机

`src/App.tsx` 顶层要新增一层启动期状态，至少区分：

```txt
appViewLaunching
appViewLaunchFailed
```

行为固定：

1. `startupMode = "appView"` 且存在 `launchToken`
   - 不进入现有 `LockScreen`
   - 直接尝试复用 opener
   - 自动发 `connect.launch`
2. 成功
   - 写本地 session
   - 去掉 URL 中的 `launchToken`
   - 进入正常工作区
3. 失败
   - 进入 appView 专用失败态
   - 明确提示用户“请从 Keymaster 重新启动 app”
   - 不自动切到手工登录壳

### 六、成功后统一进入旧的 connect session 模型

不管是：

- `connect.login`
- `connect.resume`
- `connect.launch`

只要成功，后续都必须统一执行：

1. 生成同一份 `ConnectSessionSnapshot`
2. `saveConnectSession(record)`
3. `setSession(...)`
4. `setAuthFlow(null)`
5. 进入工作区

这一步必须共用代码路径，不要复制三份。

### 七、成功后去 token 化

`connect.launch` 成功后，必须立即做：

1. 从当前 URL 删除 `launchToken`
2. 保留其它 query 参数（如果将来有）
3. 用 `history.replaceState(...)` 改地址，不整页刷新

理由：

1. `launchToken` 是一次性凭证，留在 URL 里没有长期价值；
2. 刷新后若 token 还在，用户只会命中“token 已消费”失败；
3. 清掉后，后续刷新就能按正常的 `connect.resume` 路径工作。

### 八、保留 direct mode 的现有能力

这次不是“Open App 取代直开”。

因此 direct mode 下：

1. `LockScreen`
2. `targetOrigin`
3. `connect.login`
4. `connect.resume`
5. `connect.logout`

这些既有路径都必须保留。

Open App 只是新增一条更顺的启动入口，不是把原模式废掉。

---

## 7. 特殊情况应该怎么办

### 7.1 URL 带 `launchToken`，但 `window.opener` 不存在

处理：

1. 视为 appView 启动失败；
2. 进入“请从 Keymaster 重新启动 app”的失败态；
3. 不自动 fallback 到 `connect.login`。

理由：

- 这说明本次 Open App 链路已经断了；
- 自动改走手工登录会把“从 Keymaster 拉起”的语义搅脏。

### 7.2 URL 带 `launchToken`，但 `connect.launch` 返回失败

处理：

1. 进入 appView 专用失败态；
2. 显示明确错误；
3. 不自动重试；
4. 不自动 fallback 到 `connect.login`。

### 7.3 appView 启动成功后，用户刷新页面

处理：

1. 因为成功时已经去掉 `launchToken`，刷新后进入 direct mode 语义；
2. 优先读取本地 `connectSessionId`；
3. 走现有 `connect.resume`；
4. transport 优先尝试复用 `window.opener`；
5. 若 opener 已失效，则重新开 popup 继续 resume。

### 7.4 appView 启动成功后，Session Window 后来被用户关掉

处理：

1. 当前工作区不立刻强退；
2. 下次发协议请求时若发现对端已丢失：
   - 可以重开 popup
   - 用已持久化的 `connectSessionId` 走 `connect.resume`
3. 不要求用户必须回 Keymaster 再点一次 Open App。

### 7.5 用户直接把带 `launchToken` 的 URL 收藏或手工再次打开

处理：

1. 由于 token 一次性消费，这条路径应失败；
2. 失败态提示用户从 Keymaster 重新启动；
3. 不把一次性 token URL 当成可长期分享入口。

### 7.6 direct mode 下本地已有旧 session，但这次是被 Open App 拉起

处理：

1. 以当前 `launchToken` 语义优先；
2. 先跑 `connect.launch`；
3. 成功后用新 session 覆盖旧本地记录。

理由：

- Open App 是用户当前显式发起的新启动；
- 不应偷偷优先复用旧本地 session。

### 7.7 用户直接打开 URL，没有 `launchToken`

处理：

1. 完全按现有 direct mode 行为；
2. 不显示 appView 专用错误或等待态；
3. 仍允许手工登录、恢复 session、更换 provider。

---

## 8. 文件级施工清单

### 一、协议类型与 helper

#### 1. `src/lib/protocol.ts`

新增 / 调整：

1. 新增 `connect.launch`
2. 新增 `ConnectLaunchParams`
3. 新增 `ConnectLaunchResult`
4. 更新 `PROTOCOL_METHODS`
5. 更新 `MethodParamsMap` / `MethodResultMap`

要求：

1. 与上游 `keymaster.cc` contract 语义对齐；
2. 不引入多余业务方法。

#### 2. `src/lib/keymaster.ts`

新增 / 调整：

1. 新增 `buildConnectLaunchRequest(...)`
2. 新增 `parseConnectLaunchResult(...)`
3. 抽出 login / resume / launch 共用的 session 成功收口逻辑

### 二、transport

#### 3. `src/lib/connectClient.ts`

如有必要，补最小 transport helper：

1. 判断 `window.opener` 是否可复用
2. 构造“复用现有窗口”与“新开窗口”的统一上下文

要求：

1. 不在这一层做业务状态机；
2. 不把 appView 私有判断散到多个文件。

#### 4. `src/lib/popupSessionClient.ts`

新增 / 调整：

1. 支持复用 `window.opener`
2. 支持“优先收养 opener，失败再开新 popup”
3. 保持 direct mode 旧行为不变

关键要求：

1. appView 启动期不主动 `window.open(...)`
2. 运行期若 opener 丢失，仍允许开新 popup 自愈

### 三、持久化与启动模式

#### 5. `src/lib/storage.ts`

按需微调：

1. 继续复用现有 `StoredConnectSessionRecord`
2. 不新增第二套 appView 专用 session 存储

#### 6. `src/App.tsx`

新增 / 调整：

1. 解析 `launchToken`
2. 新增 `startupMode`
3. 新增 appView 启动态 / 失败态
4. appView 下自动发 `connect.launch`
5. 成功后统一写本地 session
6. 成功后 `history.replaceState` 去掉 `launchToken`
7. 失败后显示“请从 Keymaster 重新启动 app”

关键要求：

1. direct mode 与 appView mode 只在启动阶段分叉；
2. 成功后统一收口到旧工作区模型。

### 四、UI

#### 7. `src/components/LockScreen.tsx`

调整：

1. 仅 direct mode 使用现有 LockScreen
2. 不把 appView 失败态硬塞进原有 login / resume / resumeFailed 三态里

如果必要，可以新增一个专门的轻量启动壳组件，而不是污染 `LockScreen` 既有语义。

#### 8. `src/components/ConnectStatus.tsx`

按需微调：

1. 继续基于 `connectSessionId` 展示状态
2. 不增加 “Open App session” 第二套展示口径

### 五、i18n 与 README

#### 9. `src/i18n/types.ts`

新增 appView / Open App / launch failed 相关 key。

#### 10. `src/i18n/messages.ts`

新增三语文案：

1. 正在从 Keymaster 启动
2. 无法完成 Open App 启动
3. 请从 Keymaster 重新启动

#### 11. `README.md`

更新项目定位：

1. JustNote 既支持直接打开，也支持从 Keymaster Open App 拉起
2. `connect.launch` 是 appView 首登入口
3. 启动成功后仍统一走 `connect session` 模型

---

## 9. 最终验收清单

### 9.1 direct mode 不回退

- [ ] 用户直接打开 `https://justnote.apps.bsv8.com/` 时，仍可正常走 `connect.login`
- [ ] 直接打开模式下已有本地 session 时，仍可正常 `connect.resume`
- [ ] 直接打开模式下 `LockScreen` 现有能力仍可用

### 9.2 Open App 首登

- [ ] Keymaster 以带 `launchToken` 的 URL 打开 JustNote 时，JustNote 能识别 appView 启动
- [ ] appView 启动期优先复用 `window.opener`
- [ ] 首条请求是 `connect.launch`
- [ ] `connect.launch` 成功后能进入工作区

### 9.3 session 真值统一

- [ ] `connect.launch` 成功后，本地保存的 session 结构与 `connect.login` / `connect.resume` 完全一致
- [ ] 后续 `cipher.encrypt` / `cipher.decrypt` 继续只依赖 `connectSessionId`
- [ ] 没有新增第二套 Open App 专用 session 存储

### 9.4 token 处理

- [ ] `connect.launch` 成功后 URL 中的 `launchToken` 被移除
- [ ] 成功后刷新页面，不会再次尝试消费已用过的 token

### 9.5 失败语义

- [ ] `launchToken` 存在但 opener 不可用时，JustNote 显示“请从 Keymaster 重新启动 app”
- [ ] `connect.launch` 失败时，不自动 fallback 到 `connect.login`
- [ ] 带一次性 token 的 URL 被重复打开时，行为按失败态收口

### 9.6 运行期自愈

- [ ] appView 成功后，即使原 Session Window 后续关闭，下次请求仍可通过新 popup + `connect.resume` 自愈
- [ ] 不要求用户每次都必须重新从 Keymaster Open App

### 9.7 文档一致性

- [ ] README、注释、类型、UI 对“Open App = `connect.launch` 首登”表述一致
- [ ] README、注释、类型、UI 对“成功后统一回到同一套 connect session 模型”表述一致

---

## 10. 本次完成后的系统图

```txt
direct mode
  用户直开 JustNote
    -> LockScreen
    -> connect.login / connect.resume
    -> session 持久化
    -> 工作区

appView mode
  Keymaster Session Window 打开 JustNote(launchToken)
    -> 复用 window.opener
    -> connect.launch(launchToken)
    -> session 持久化
    -> 去掉 URL launchToken
    -> 工作区

成功后统一
  connectSessionId
  ownerPublicKeyHex
  cipher.encrypt / cipher.decrypt
  刷新后 connect.resume
```

本次硬切换完成后，JustNote 必须是一个既能直开、也能被 Keymaster Open App 拉起的同一套 app，而不是两套半兼容的启动模型并存。
