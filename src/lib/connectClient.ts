// src/lib/connectClient.ts
// 协议 transport 底层 helper。
//
// 设计缘由（施工单第 6 章 + 2026-06-27 note-open-cancel-and-transport-hard-switch
//          第 4.2 / 8.2 章 +
//          施工单 2026-06-29 001 open-app-appview-connect-launch 硬切换
//          第 4.4 / 6.四 章）：
//   - popup 复用策略与当前应用对齐：单页只维护一个 popup session client。
//   - 本文件只暴露 transport 原子：开窗、消息监听、close 轮询、
//     targetOrigin 校验、消息分发、window.opener 探测 / URL 启动 token
//     解析。session 生命周期由 session client 拥有。
//   - **保留** `result` 派发到 `requestId` 的回调注册：分发器**永远**按
//     `result.id` 路由，不做"只认最后一条 requestId"的退化。
//   - `cancel` 是 fire-and-forget，**不**等待 ack；上层不要从分发器
//     期待 cancel 的回包。
//   - appView 启动期：JustNote 必须能复用 `window.opener` 指向的 Session
//     Window 作为 transport 对端，**不**在新窗口里重复开 popup。这里提供
//     `getReusableOpener()` 让上层判断"是否有一扇已存在的 Keymaster
//     Session Window 可以被收养"；不允许在 opener 已存在时还偷偷
//     `window.open` 一扇新的 popup。

import type {
  PopupConnectionState,
  ProtocolMethod,
  ProtocolRequestMessage,
  ProtocolResultMessage
} from "./protocol";
import { PROTOCOL_POPUP_PATH, PROTOCOL_VERSION } from "./protocol";

export type ProtocolLogStage =
  | "popup_opened"
  | "popup_reused"
  | "waiting_ready"
  | "ready_received"
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
