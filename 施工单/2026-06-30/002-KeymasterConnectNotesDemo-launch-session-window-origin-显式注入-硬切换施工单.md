# 002 KeymasterConnectNotesDemo launch sessionWindowOrigin 显式注入硬切换施工单

## 参考文档与依赖项目

本次施工、联调、验收以下文档与代码为准：

- 本仓库：
  - `src/App.tsx`
  - `src/lib/connectClient.ts`
  - `src/lib/popupSessionClient.ts`
- 本仓库既有施工单：
  - `施工单/2026-06-29/001-KeymasterConnectNotesDemo-open-app-appview-connect-launch-硬切换施工单.md`
  - `施工单/2026-06-30/001-KeymasterConnectNotesDemo-appview-child-ready-and-opener-launch-硬切换施工单.md`
- 依赖项目 `keymaster.cc`：
  - `施工单/2026-06-30/004-appview-launch-session-window-origin-explicit-injection-hard-switch.md`

发生冲突时：

1. 本单关于 NotesDemo launch 模式 origin 真值来源的定义优先。
2. `001-...child-ready-and-opener-launch...` 里关于 child `ready`、`connect.launch` 顺序的定义继续有效。

---

## 1. 本单定位

本单不是把 `DEFAULT_TARGET_ORIGIN = "https://keymaster.cc"` 换个常量名。

本单定义的是：

- NotesDemo 的 `targetOrigin` 只属于 popup / direct 模式
- appView / launch 模式不再使用它
- appView / launch 模式改为使用父窗口显式注入的：
  - `sessionWindowOrigin`

---

## 2. 简述缘由

当前 NotesDemo 的 appView 启动链路里：

1. `adoptOpener()` 用 `normalizedTargetOrigin`
2. `postReadyToOpener()` 用 `normalizedTargetOrigin`
3. 成功后持久化 session 也把这份值当 target origin

而 `normalizedTargetOrigin` 的源头却是：

- 默认值 `https://keymaster.cc`
- 或用户在 direct 模式手工输入的值

这说明 launch 模式错误复用了 popup 模式真值。

---

## 3. 最终目标

本次完成后，NotesDemo 必须达到以下状态：

1. direct 模式继续使用 `targetOrigin`。
2. appView / launch 模式不再使用默认 `https://keymaster.cc`。
3. appView / launch 模式改为读取 URL 中显式注入的 `sessionWindowOrigin`。
4. `adoptOpener()` 只认这份 `sessionWindowOrigin`。
5. `postReadyToOpener()` 只认这份 `sessionWindowOrigin`。
6. `connect.launch` 的 transport 也只认这份 `sessionWindowOrigin`。
7. 若 URL 有 `launchToken` 但没有合法 `sessionWindowOrigin`，直接启动失败。
8. 不 fallback 到页面 state 里的 `targetOrigin`。

---

## 4. 单真值定义

### 4.1 NotesDemo 两种 origin

本次固定：

```txt
direct/popup
  -> targetOrigin

appView/launch
  -> sessionWindowOrigin
```

### 4.2 `sessionWindowOrigin` 的读取位置

本次固定：

```txt
sessionWindowOrigin
  = 从当前 child URL query 读取
```

关键约束：

1. 只在 `launchToken` 模式下读取
2. 必须是完整 `origin`
3. 缺失 / 非法直接 fail-closed

---

## 5. 怎么做

### 一、把 appView 启动链路从 `targetOrigin` 解耦

`performAppViewLaunch()` 下的这几步统一改成只读 `sessionWindowOrigin`：

1. `getSessionClient()`
2. `adoptOpener()`
3. `postReadyToOpener()`
4. `popup.runRequest(connect.launch)`

### 二、保留 `targetOrigin` 给 direct 模式

本单不改：

1. 锁屏页输入框
2. “使用默认地址”
3. 本地 session / resume 的 `targetOrigin`

### 三、失败策略简单收口

若 launch 模式下：

- `sessionWindowOrigin` 缺失
- `sessionWindowOrigin` 非法

则：

1. 直接进入 appView failed
2. 提示用户从 Keymaster 重新启动
3. 不走 direct login

---

## 6. 不能怎么做

1. 不能继续让 appView / launch 模式读取 `DEFAULT_TARGET_ORIGIN`。

2. 不能在 launch 模式下 fallback 到用户输入的 `targetOrigin`。

3. 不能靠 `window.opener.location.origin` 推断。

4. 不能因为 `ready` 看起来无害，就把 `connect.launch` 也放宽成无 origin 真值。

---

## 7. 验收标准

1. NotesDemo 在 launch 模式下不再依赖 `https://keymaster.cc` 默认值。
2. launch 模式下 `ready` 与 `connect.launch` 都走 `sessionWindowOrigin`。
3. direct 模式下原有 `targetOrigin` 工作流保持不变。
4. 缺少 `sessionWindowOrigin` 的 launch URL 会明确失败。

