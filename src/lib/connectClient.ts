// src/lib/connectClient.ts
// 协议 transport 底层 helper。
//
// 设计缘由（施工单第 6 章）：
//   - popup 复用策略与现有 demo 对齐：单页只维护一个 popup session client，
//     同一时刻只允许一条在途 request。
//   - 本文件只暴露 transport 原子：开窗、消息监听、close 轮询、
//     targetOrigin 校验、消息分发。session 生命周期由 session client 拥有。
//   - 保留 `result` 派发到 `requestId` 的回调注册；错误码与现有 demo 一致。

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
  | "busy_rejected"
  | "timeout"
  | "session_closed";

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
      | "no_session",
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
      console.error("[notes-demo] invalid message origin", {
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
