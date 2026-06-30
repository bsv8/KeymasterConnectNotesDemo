# 001 KeymasterConnectNotesDemo appView child ready + opener launch 硬切换施工单

## 参考文档与依赖项目

本次施工、联调、验收以下文档与代码为准：

- 本仓库：
  - `src/App.tsx`
  - `src/components/AppViewLaunchShell.tsx`
  - `src/lib/protocol.ts`
  - `src/lib/connectClient.ts`
  - `src/lib/popupSessionClient.ts`
  - `src/lib/keymaster.ts`
- 本仓库既有施工单：
  - `施工单/2026-06-29/001-KeymasterConnectNotesDemo-open-app-appview-connect-launch-硬切换施工单.md`
- 依赖项目 `keymaster.cc`：
  - `施工单/2026-06-30/003-appview-child-ready-showapp-popup-two-stage-hard-switch.md`
  - `packages/contracts/src/protocol.ts`
  - `packages/plugin-protocol/src/ProtocolPopupPage.tsx`

发生冲突时：

1. 本单关于 JustNote 作为 appView child app 的 `ready` 发送职责优先。
2. `keymaster.cc` 里关于 Session Window 两段式 UI、命名窗口、统一 popup 收口的定义继续有效。
3. 后续若再改 JustNote 的 appView 启动链路，必须先改本单，再改实现。

---

## 1. 本单定位

本单不是在 JustNote 现有 `connect.launch` 上补一个 log。

本单定义的是一次硬切换：

- JustNote 作为被 Session Window 打开的 child app，在 appView 启动时承担 `ready` 发送方职责；
- 继续复用现有顶层 `ready`，不新增任何 app 专属消息；
- `launchToken` 仍然是 appView 首登唯一真值；
- JustNote 在 appView 下仍自动走 `connect.launch`，但顺序改成：
  1. 先把自己的 listener / transport 准备好
  2. 向 `window.opener`（Session Window）发 `ready`
  3. 再复用 opener transport 走 `connect.launch`
- direct 模式继续保留，不能被 appView 改坏。

本单目标不是让 JustNote 再变成“自己偷偷多开一扇 popup 的站点”，而是让它成为一个协议上自洽的 appView child client。

---

## 2. 简述缘由

### 2.1 现在 JustNote 还没有承担 child `ready` 发送职责

当前 JustNote 的 appView 路径已经能：

- 读 URL `launchToken`
- 复用 `window.opener`
- 发送 `connect.launch`

但它没有把“child app listener 已就绪”这件事主动告诉 Session Window。

这导致上游必须反向猜测 child app 是否 ready，甚至自己去给 child 发 `ready`。

这个抽象是反的。

### 2.2 `ready` 方向应该和传统 popup 对称

JustNote 在 direct 模式下是 opener：

- 它打开 Session Window；
- 等 Session Window 发来 `ready`。

而在 appView 下，JustNote 变成 child：

- Session Window 打开 JustNote；
- 因此应由 JustNote 在 listener 就绪后向 opener 发 `ready`。

本单不接受为了这个场景新增第二种消息。

### 2.3 `connect.launch` 仍然是 appView 首登唯一真值

虽然本单引入 child `ready`，但它不改变 `connect.launch` 的角色：

- `ready` 只表达 listener ready；
- `connect.launch` 才表达“消费 launcher 预建 session”。

因此：

1. `ready` 不能替代 `connect.launch`
2. `connect.launch` 也不能早于 `ready`
3. appView 失败仍然 fail-closed，不自动回退到 direct login

---

## 3. 最终目标

本次完成后，JustNote 必须达到以下状态：

1. 继续支持 `direct` 与 `appView` 两种启动模式。
2. `appView` 的唯一启动真值仍是 URL `launchToken`。
3. 检测到 `launchToken` 后，JustNote 必须把自己视为 appView child app。
4. appView child app 在自己的 message listener 就绪后，向 `window.opener` 发送顶层 `ready`。
5. 发送 `ready` 后，JustNote 继续复用 opener transport，并自动发 `connect.launch`。
6. `connect.launch` 成功后，JustNote 继续沿用当前 `connectSessionId` 持久化与工作区逻辑。
7. `connect.launch` 成功后仍要移除 URL 中的 `launchToken`。
8. appView 失败时不自动回退到 direct login / connect.login。
9. 若 `window.opener` 不存在、已关闭、或明显不可用，appView 直接失败，提示用户从 Keymaster 重新启动。
10. direct 模式下原有 `connect.login` / `connect.resume` 路径不被破坏。

---

## 4. 单真值定义

### 4.1 启动模式

本次固定：

```txt
startupMode = "direct" | "appView"
```

定义不变：

- `direct`
  = 无 `launchToken`
- `appView`
  = URL 带 `launchToken`

关键约束：

1. 本单不再新增第三种 “childReadyMode” 本地模式。
2. `launchToken` 仍是 appView 唯一真值。

### 4.2 child `ready`

本次固定：

```txt
JustNote 作为被 Session Window 打开的窗口
在自身 listener 就绪后
向 window.opener 发顶层 ready
```

关键约束：

1. 继续使用顶层 `ready`。
2. 不新增 `child_ready`。
3. 这是 appView 启动期行为，不是业务 request。

### 4.3 appView 首登顺序

本次固定：

```txt
appView 启动
  = 准备 transport
  -> 发 ready 给 opener
  -> connect.launch(launchToken)
```

关键约束：

1. `connect.launch` 不能早于 `ready`。
2. `ready` 不代替 `connect.launch`。
3. `connect.launch` 失败不自动 fallback 到 `connect.login`。

---

## 5. 怎么做

### 一、在 transport 层补一个 “向 opener 发 ready” 的最小原子

本仓库当前 transport 已有：

- 复用 opener
- 读 `launchToken`
- 去掉 URL 里的 `launchToken`

本次要补的不是第二套状态机，而是一个最小原子：

```txt
postReadyToOpener(targetOrigin)
```

职责只有：

1. 校验 `window.opener` 存在
2. 组装顶层 `ready`
3. `postMessage` 发给 opener

关键约束：

1. 不把它做成新 session client。
2. 不在这里做 `connect.launch`。
3. 不在这里做重试风暴。

### 二、appView 启动顺序改成 “先 ready，再 launch”

当前 `App.tsx` 的 appView 启动路径需要改序：

1. 先建立 / 复用 popup session client
2. `adoptOpener()`，安装 listener、绑定 opener 句柄
3. 向 opener 发顶层 `ready`
4. 再发 `connect.launch({ launchToken })`
5. 成功后清 URL token、写 session、本地进入已连接工作区

这样做的原因很直接：

- Session Window 应先知道 child 已起来；
- 然后再进入传统 popup，接受后续 `connect.launch` 与其它 request。

### 三、继续复用 opener，不新开 popup

本单不改变这条旧真值：

- appView 启动期，JustNote 必须优先复用 `window.opener`

因此：

1. `adoptOpener()` 继续保留
2. appView 路径里不得偷偷 `window.open(...)` 新 popup
3. opener 不可用时 fail-closed

### 四、保留 `AppViewLaunchShell`，但它不再承担协议握手真值

如果现有 `AppViewLaunchShell` 还要保留，可以继续保留。

但要明确：

1. 真正的握手真值是：
   - URL `launchToken`
   - 发给 opener 的顶层 `ready`
   - 后续 `connect.launch`
2. `AppViewLaunchShell` 只是启动态 UI，不是协议真值。

### 五、launch 成功后继续按现有路径收口

`connect.launch` 成功后仍按现有逻辑：

1. 写 `connectSessionId`
2. 写 owner / claims 摘要
3. 去掉 URL `launchToken`
4. 后续保存 / 读取 / 刷新继续走现有 `connect.resume` / `cipher.*`

本单不再为 appView 引入第二套本地 session 模型。

---

## 6. 不能怎么做

1. 不能新增 `child_ready` / `app_ready` 新协议消息。

2. 不能继续依赖 “Session Window 给 JustNote 发 ready” 才能启动。

3. 不能在 appView 下先发 `connect.launch`，之后才补发 `ready`。

4. 不能因为 appView 失败就自动降级成 direct login。

5. 不能因为要发 child `ready`，就把 direct 模式的 transport 改成第二套实现。

6. 不能把 `launchToken` 长期留在 URL。

7. 不能在 appView 下忽略 opener，自行新开 popup。

---

## 7. 特殊情况怎么办

### 7.1 app 窗口被复用并重新加载

处理原则：

1. 重新加载后，若 URL 里仍有 `launchToken` 且 opener 可用，继续按 appView 路径启动。
2. listener 就绪后重新发送一次 `ready`。
3. 然后继续发 `connect.launch`。

### 7.2 opener 不存在或已关闭

处理原则：

1. appView 直接失败。
2. 显示“请从 Keymaster 重新启动”。
3. 不自动切到 direct login。

### 7.3 child `ready` 发送失败

处理原则：

1. 视为 appView 启动失败。
2. 不做复杂重试。
3. 不假装已经 ready。

### 7.4 `connect.launch` 失败

处理原则：

1. appView 失败态收口。
2. 不自动 fallback 到 `connect.login`。
3. 保持 fail-closed。

---

## 8. 验收标准

1. appView 模式下，JustNote 会向 opener 发顶层 `ready`。
2. `ready` 发生在 `connect.launch` 之前。
3. appView 启动仍复用 opener，不新开 popup。
4. `connect.launch` 成功后，URL 中 `launchToken` 被移除。
5. appView 失败不会自动降级到 direct login。
6. direct 模式原有登录 / 恢复路径不被破坏。

