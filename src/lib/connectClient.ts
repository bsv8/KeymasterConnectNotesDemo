// src/lib/connectClient.ts
// 协议 transport 底层 helper。
//
// 设计缘由（施工单第 6 章 + 2026-06-27 note-open-cancel-and-transport-hard-switch
//          第 4.2 / 8.2 章 +
//          施工单 2026-06-29 001 open-app-appview-connect-launch 硬切换
//          第 4.4 / 6.四 章 +
//          施工单 2026-06-30 002 launch sessionWindowOrigin 显式注入硬切换
//          第 4.1 / 4.2 / 5 / 6 章）：
//   - popup 复用策略与当前应用对齐：单页只维护一个 popup session client。
//   - 本文件只暴露 transport 原子：开窗、消息监听、close 轮询、
//     targetOrigin 校验、消息分发、window.opener 探测 / URL 启动 token
//     与 sessionWindowOrigin 解析。session 生命周期由 session client 拥有。
//   - **保留** `result` 派发到 `requestId` 的回调注册：分发器**永远**按
//     `result.id` 路由，不做"只认最后一条 requestId"的退化。
//   - `cancel` 是 fire-and-forget，**不**等待 ack；上层不要从分发器
//     期待 cancel 的回包。
//   - appView 启动期：JustNote 必须能复用 `window.opener` 指向的 Session
//     Window 作为 transport 对端，**不**在新窗口里重复开 popup。这里提供
//     `getReusableOpener()` 让上层判断"是否有一扇已存在的 Keymaster
//     Session Window 可以被收养"；不允许在 opener 已存在时还偷偷
//     `window.open` 一扇新的 popup。
//   - **两种 origin 真值不再混用**（施工单 2026-06-30 002 第 4.1 章）：
//       - popup / direct 模式 transport target = `targetOrigin`
//       - appView / launch 模式 transport target = `sessionWindowOrigin`
//     `readSessionWindowOriginFromUrl()` 只在 launchToken 模式下提供，缺失
//     / 非法一律返回 null，由 caller 走 appView 失败态——不允许 fallback
//     到 `targetOrigin` 也不允许 fallback 到默认 `https://keymaster.cc`。

import type {
  PopupConnectionState,
  ProtocolMethod,
  ProtocolReadyMessage,
  ProtocolRequestMessage,
  ProtocolResultMessage
} from "./protocol";
import { PROTOCOL_POPUP_PATH, PROTOCOL_VERSION } from "./protocol";

export type ProtocolLogStage =
  | "popup_opened"
  | "popup_reused"
  | "waiting_ready"
  | "ready_received"
  | "ready_sent"
  | "request_sent"
  | "waiting_result"
  | "result_received"
  | "popup_closed"
  | "closing_received"
  | "cancel_sent"
  | "busy_rejected"
  | "timeout"
  | "session_closed"
  | "no_opener"
  | "opener_adopted";

export interface ProtocolLogEvent {
  at: number;
  stage: ProtocolLogStage;
  method?: ProtocolMethod;
  requestId?: string;
  message?: string;
  detail?: unknown;
}

export interface PopupOpenOptions {
  targetOrigin: string;
  popupWidth: number;
  popupHeight: number;
  /** 关闭轮询间隔。默认 500ms。 */
  closePollMs?: number;
}

export interface ProtocolClientEnv {
  now: () => number;
  open: (url: string, name: string, features: string) => Window | null;
  addMessageListener: (handler: (event: MessageEvent) => void) => void;
  removeMessageListener: (handler: (event: MessageEvent) => void) => void;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
}

export class ProtocolTransportError extends Error {
  constructor(
    public readonly code:
      | "popup_blocked"
      | "popup_closed"
      | "ready_timeout"
      | "result_timeout"
      | "invalid_origin"
      | "session_busy"
      | "no_session"
      | "no_opener",
    message: string
  ) {
    super(message);
    this.name = "ProtocolTransportError";
  }
}

/** 计算 popup URL 与 features；暴露给 session client 复用。 */
export function buildPopupUrl(targetOrigin: string): string {
  return `${normalizeOrigin(targetOrigin)}${PROTOCOL_POPUP_PATH}`;
}

export function buildPopupFeatures(width: number, height: number): string {
  return `popup=yes,width=${Math.max(320, Math.trunc(width))},height=${Math.max(320, Math.trunc(height))}`;
}

/** 探测一个 popup 句柄是否还活着（浏览器给的兜底真值）。 */
export function isPopupClosed(popup: Window | null): boolean {
  if (!popup) return true;
  try {
    return (popup as Window & { closed?: boolean }).closed === true;
  } catch {
    return true;
  }
}

export function normalizeOrigin(value: string): string {
  return new URL(value).origin;
}

/* ============== appView 启动期 transport 复用 ============== */

/**
 * 检测当前 JustNote 页面是否能"收养"已有的 `window.opener` 作为 transport 对端。
 *
 * 设计缘由（施工单 2026-06-29 001 open-app-appview-connect-launch 硬切换
 *          第 4.4 / 6.四 章）：
 *   - appView 启动期，Keymaster Session Window 已经主动打开了 JustNote；
 *     此时 `window.opener` 指向那扇 Session Window；
 *   - JustNote 必须**优先**复用这扇已存在的窗口，**不**主动 `window.open`
 *     出一扇新 popup——否则一次 Open App 会变成两扇协议窗口、首次
 *     `connect.launch` 也无处发送；
 *   - 但运行期若这扇窗口被用户关闭，下次请求仍允许重新开 popup 走
 *     `connect.resume`，**不**要求永远绑定同一扇窗口；
 *   - 因此这里只判断"是否有一扇仍存活的、targetOrigin 一致的 opener"；
 *     **不**判断"现在是否处于 appView 模式"——模式由 URL 中的 `launchToken`
 *     决定，本函数只是 transport 层的"能否复用"判定。
 *
 * 返回值：
 *   - `null` ⇒ 当前没有可复用的 Session Window；
 *   - 非 null ⇒ 返回一个真值对象，caller 可直接把它当作 popup 句柄 + targetOrigin
 *     一并传给 transport；
 *
 * 注意：
 *   - 这里**不**读 `opener.location.href`（会触发跨 origin 安全异常），
 *     只读 `closed` + 自身 `location.origin` 与 `targetOrigin`；
 *   - `targetOrigin` 与 `window.opener` 之间的"具体协议身份"判定由
 *     Session Window 在 `ready` / `closing` / `result` 报文中继续走
 *     origin 校验；
 *   - `closed` 探测失败（部分浏览器 / 沙盒抛异常）按"不可用"处理。
 */
export function getReusableOpener(
  targetOrigin: string
): { opener: Window; targetOrigin: string } | null {
  if (typeof window === "undefined") return null;
  const opener = window.opener;
  if (!opener) return null;
  if (isPopupClosed(opener)) return null;
  let normalized: string;
  try {
    normalized = normalizeOrigin(targetOrigin);
  } catch {
    return null;
  }
  return { opener, targetOrigin: normalized };
}

/**
 * appView child app 在自身 listener 就绪后，向 `window.opener`（Session Window）
 * 发送顶层 `ready`。
 *
 * 设计缘由（施工单 2026-06-30 001 appView child ready + opener launch
 *          硬切换第 4.2 / 4.3 / 5.一 / 6.一 / 6.不能怎么做 章）：
 *   - appView 启动期 JustNote 是被 Session Window 打开的 child app；
 *     由 child app 自己在 listener 装好之后向 opener 发 `ready`，让
 *     Session Window 知道"child 已就绪，可以进入传统 popup";
 *   - 这条消息与传统 popup 启动期 "Session Window → client web 发 ready"
 *     完全对称——只是方向在 appView 下反过来：传统 popup 是 Session Window
 *     当 child，在自己 listener 就绪后向 opener 发 ready；appView 下 Session
 *     Window 是 opener，JustNote 当 child，所以由 JustNote 发 ready；
 *   - **继续复用现有顶层 `ready`**——施工单 2026-06-30 001 第 4.2 / 6.不能
 *     怎么做 章明确禁止新增 `child_ready` / `app_ready` 等专用消息，让上游
 *     Session Window 可以用同一个 handler 同时处理两种入口方向下的 ready 收包；
 *   - 这是一个**最小原子**：只校验 opener、组装顶层 `ready`、`postMessage`；
 *     **不**在这里发 `connect.launch`，**不**启动任何新 session client，
 *     **不**做任何重试风暴——这一切都由调用方统一收口；
 *
 * 关键约束：
 *   1. 只校验 `window.opener` 存在且未关闭，**不**调用 `window.open(...)`
 *      新开 popup；
 *   2. 通过 `postMessage` 发送严格 `{ v: PROTOCOL_VERSION, type: "ready" }`；
 *   3. targetOrigin = `normalizeOrigin(targetOrigin)`，与协议会话 origin 自洽；
 *   4. 发送失败 → 返回 `false`，由调用方按"appView 启动失败"统一收口；
 *   5. 只在 appView 启动期使用，direct 模式不会调到这里；
 *
 * 返回值：
 *   - `true`  ⇒ 已成功发送 `ready` 给 opener；
 *   - `false` ⇒ window.opener 不存在 / 已关 / 不可用 / 发送失败。
 */
export function postReadyToOpener(targetOrigin: string): boolean {
  if (typeof window === "undefined") return false;
  const opener = window.opener;
  if (!opener) return false;
  if (isPopupClosed(opener)) return false;
  let normalized: string;
  try {
    normalized = normalizeOrigin(targetOrigin);
  } catch {
    return false;
  }
  const ready: ProtocolReadyMessage = {
    v: PROTOCOL_VERSION,
    type: "ready"
  };
  try {
    opener.postMessage(ready, normalized);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从当前 URL 中解析 `launchToken`。
 *
 * 设计缘由（施工单 2026-06-29 001 第 4.2 / 4.3 章）：
 *   - 启动模式 `appView` 的**唯一**真值 = URL `?launchToken=`；
 *   - 调用方拿到后**必须**自己负责消费 + 清理（`history.replaceState` 移除）；
 *   - 本函数只做解析，**不**做任何副作用、**不**写 localStorage；
 *   - 缺失 / 空字符串 / 多个同名参数 → 一律返回 null，由 caller 走 direct mode。
 */
export function readLaunchTokenFromUrl(search?: string): string | null {
  if (typeof window === "undefined") return null;
  const raw = search ?? window.location.search;
  if (raw.length === 0) return null;
  try {
    const params = new URLSearchParams(raw);
    const value = params.get("launchToken");
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * 从当前 URL 中移除 `launchToken`，保留其它 query 参数；用 `history.replaceState`
 * 改地址，不整页刷新。
 *
 * 设计缘由（施工单 2026-06-29 001 第 6.七 / 7.3 / 9.4 章）：
 *   - launchToken 是一次性凭证，留在 URL 里没有长期价值；
 *   - 成功后立即清掉，刷新后走 `connect.resume` 而不是再次消费 token；
 *   - **不**允许通过 `location.href = ...` 触发整页刷新——会丢失内存态。
 *
 * 返回：是否真的做了修改（便于上层记录日志）。
 */
export function stripLaunchTokenFromUrl(search?: string): boolean {
  if (typeof window === "undefined") return false;
  const raw = search ?? window.location.search;
  if (raw.length === 0) return false;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return false;
  }
  if (!params.has("launchToken")) return false;
  params.delete("launchToken");
  const nextSearch = params.toString();
  const nextUrl =
    window.location.pathname +
    (nextSearch.length > 0 ? `?${nextSearch}` : "") +
    window.location.hash;
  try {
    window.history.replaceState(null, "", nextUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * 从当前 URL 中解析 `sessionWindowOrigin`。
 *
 * 设计缘由（施工单 2026-06-30 002 launch sessionWindowOrigin 显式注入硬切换
 *          第 4.1 / 4.2 / 4.3 / 5 / 6 章 +
 *          依赖项目 keymaster.cc 施工单 2026-06-30 004 第 4.2 / 5 章）：
 *   - appView / launch 模式 transport target 的**唯一**真值 = URL
 *     `?sessionWindowOrigin=`；
 *   - 这个值由 Session Window 在 `openClientApp()` 时显式注入；
 *     下游 child app **不**读 `window.opener.location.origin`、
 *     **不**读 `document.referrer`、**不**用 `postMessage(..., "*")`；
 *   - 必须是完整 `origin`（`scheme + host + port`），仅 `domain:port`
 *     也按非法处理；
 *   - 缺失 / 空字符串 / 非 URL / 非 origin 形式 → 一律返回 null，由 caller
 *     走 appView fail-closed 路径，**不**回退到 `targetOrigin` 也**不**
 *     回退到默认 `https://keymaster.cc`；
 *   - popup / direct 模式不会被调用，无需特别关心其它模式下此函数的副作用。
 *
 * 返回值：
 *   - `string`：合法 origin（已 normalize），caller 直接用于 `postMessage`
 *     的 targetOrigin 与 `PopupSessionClient` 的 transport origin；
 *   - `null`：缺失 / 非法 / 非 origin 形式。
 */
export function readSessionWindowOriginFromUrl(search?: string): string | null {
  if (typeof window === "undefined") return null;
  const raw = search ?? window.location.search;
  if (raw.length === 0) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }
  const value = params.get("sessionWindowOrigin");
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  // 只接受完整 origin（scheme + host + port）；`domain:port` 这类不完整形态
  // 直接按非法处理。
  if (parsed.protocol.length === 0 || parsed.host.length === 0) return null;
  // 额外一道 `=== parsed.origin` 校验：把"主串 + 额外 path/query"这类形态
  // 截掉（例如 `https://x.com/some/path` → parsed.origin 是 `https://x.com`，
  // 与 trimmed 不相等，按非法处理）。
  if (trimmed !== parsed.origin) return null;
  return parsed.origin;
}

/**
 * 从当前 URL 中移除 `sessionWindowOrigin`，保留其它 query 参数；用
 * `history.replaceState` 改地址，不整页刷新。
 *
 * 设计缘由（施工单 2026-06-30 002 launch sessionWindowOrigin 显式注入
 *          硬切换第 5.一 / 6 章）：
 *   - `sessionWindowOrigin` 在 `connect.launch` 成功后**必须**清掉：
 *       * 该值只在 appView 启动期有意义；
 *       * launch 成功后 JustNote 进入 direct / resume 模型；
 *       * URL 里留着它会误导后续 reload 误判"还在 appView 模式"；
 *   - 与 `stripLaunchTokenFromUrl()` 配对使用：launchToken 是凭证、
 *     sessionWindowOrigin 是 transport 真值，都不应该长期留在 URL；
 *   - 与 `stripLaunchTokenFromUrl()` 一样，仅做 URL 改写，**不**触发整页
 *     刷新。
 *
 * 返回：是否真的做了修改（便于上层记录日志）。
 */
export function stripSessionWindowOriginFromUrl(search?: string): boolean {
  if (typeof window === "undefined") return false;
  const raw = search ?? window.location.search;
  if (raw.length === 0) return false;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return false;
  }
  if (!params.has("sessionWindowOrigin")) return false;
  params.delete("sessionWindowOrigin");
  const nextSearch = params.toString();
  const nextUrl =
    window.location.pathname +
    (nextSearch.length > 0 ? `?${nextSearch}` : "") +
    window.location.hash;
  try {
    window.history.replaceState(null, "", nextUrl);
    return true;
  } catch {
    return false;
  }
}

export function browserEnv(): ProtocolClientEnv {
  return {
    now: () => Date.now(),
    open: (url, name, features) => window.open(url, name, features),
    addMessageListener: (handler) => window.addEventListener("message", handler),
    removeMessageListener: (handler) => window.removeEventListener("message", handler),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis)
  };
}

/** message 派发器：把 popup 发来的 `result` 落到对应 `requestId` 的回调上。 */
export interface ResultDispatcher {
  handler: (event: MessageEvent) => void;
  /** 注册一个"等待 requestId 匹配的 result"的回调。回调只被调用一次。 */
  awaitResult(requestId: string, callback: (msg: ProtocolResultMessage) => void): () => void;
  /** 通知 dispatcher 关闭（解绑所有 pending）。通常用于 session 结束。 */
  close(): void;
}

export function createResultDispatcher(targetOrigin: string): ResultDispatcher {
  const pending = new Map<string, (msg: ProtocolResultMessage) => void>();
  const expected = normalizeOrigin(targetOrigin);
  const handler = (event: MessageEvent) => {
    const data = event.data as unknown;
    if (!isPlainObject(data) || data.v !== PROTOCOL_VERSION || typeof data.type !== "string") {
      return;
    }
    if (typeof event.origin === "string" && normalizeOrigin(event.origin) !== expected) {
      console.error("[justnote] invalid message origin", {
        eventOrigin: event.origin,
        expectedOrigin: expected
      });
      return;
    }
    if (data.type === "result" && typeof data.id === "string") {
      const cb = pending.get(data.id);
      if (cb) {
        pending.delete(data.id);
        cb(data as ProtocolResultMessage);
      }
    }
  };
  return {
    handler,
    awaitResult(requestId, callback) {
      pending.set(requestId, callback);
      return () => pending.delete(requestId);
    },
    close() {
      pending.clear();
    }
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 兼容旧测试 stub。
export type { ProtocolRequestMessage, ProtocolResultMessage };
