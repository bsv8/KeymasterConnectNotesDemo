// src/lib/popupSessionClient.ts
// 页面级 popup session client。
//
// 设计缘由（施工单第 6 章）：
//   - 同一 demo 页面，对同一 `targetOrigin`，只维护一个 popup 会话。
//   - 首次 `ensureSession()` 时若没有 popup 句柄就开窗、等一次 `ready`。
//   - 后续 `runRequest()` 复用现有 popup 句柄：不再 `window.open`。
//   - 同一时刻只允许**一条在途** request；第二条再点会抛 `session_busy`。
//   - popup 关闭 / 刷新后，下次 `runRequest()` 重新开窗。
//   - 不做客户端请求队列；不做自动重试；不做跨 opener 编排。
//
// 这一层拥有：
//   - 长期 `message` 监听（ResultDispatcher）；
//   - popup 句柄；
//   - popup 关闭轮询；
//   - 连接状态机（`opening` / `connected` / `disconnected`）。
//
// 这一层**不**拥有：
//   - 任何业务方法（identity.get / cipher.*）；
//   - 任何 UI；只通过回调与日志暴露。

import type {
  PopupConnectionState,
  ProtocolMethod,
  ProtocolRequestMessage,
  ProtocolResultMessage
} from "./protocol";
import {
  ProtocolTransportError,
  buildPopupFeatures,
  buildPopupUrl,
  browserEnv,
  createResultDispatcher,
  isPopupClosed,
  normalizeOrigin,
  type ProtocolClientEnv,
  type ProtocolLogEvent,
  type ProtocolLogStage
} from "./connectClient";

const POPUP_NAME = "keymaster-notes-demo";

export interface PopupSessionClientOptions {
  targetOrigin: string;
  popupWidth: number;
  popupHeight: number;
  readyTimeoutMs: number;
  resultTimeoutMs: number;
  /** 关闭轮询间隔。默认 500ms。 */
  closePollMs?: number;
  onLog?: (event: ProtocolLogEvent) => void;
  onConnectionStateChange?: (state: PopupConnectionState) => void;
  /** 自定义 env（测试用）。生产路径走 `browserEnv()`。 */
  env?: ProtocolClientEnv;
}

export type PopupSessionState = PopupConnectionState | "idle";

interface PendingRequest {
  resolve: (value: ProtocolResultMessage) => void;
  reject: (reason?: unknown) => void;
  resultTimer: ReturnType<typeof setTimeout> | null;
}

export class PopupSessionClient {
  private state: PopupSessionState = "idle";
  private popup: Window | null = null;
  private currentTargetOrigin: string | null = null;
  private listenerInstalled = false;
  private dispatcher: ReturnType<typeof createResultDispatcher> | null = null;
  private combinedListener: ((event: MessageEvent) => void) | null = null;
  private closePoller: ReturnType<typeof setInterval> | null = null;
  private inFlight: PendingRequest | null = null;
  private env: ProtocolClientEnv;
  private opts: PopupSessionClientOptions;
  private readyPromise: Promise<void> | null = null;

  constructor(opts: PopupSessionClientOptions) {
    this.opts = opts;
    this.env = opts.env ?? browserEnv();
  }

  getConnectionState(): PopupSessionState {
    return this.state;
  }

  /**
   * 确保 session 处于 connected 状态：
   *   - 若 state === connected 且 popup 还活着：直接返回；
   *   - 若 popup 句柄丢了 / 关闭了：重开；
   *   - 首次调用：开窗、等 ready。
   */
  async ensureSession(): Promise<void> {
    const targetOrigin = normalizeOrigin(this.opts.targetOrigin);
    if (this.state === "connected" && this.currentTargetOrigin === targetOrigin && !isPopupClosed(this.popup)) {
      return;
    }
    if (!this.readyPromise) {
      this.readyPromise = this.openAndAwaitReady(targetOrigin);
    }
    try {
      await this.readyPromise;
    } catch (err) {
      // ready 失败：清掉 readyPromise，让下一次 ensureSession() 重试。
      this.readyPromise = null;
      throw err;
    }
  }

  /**
   * 发送一条 request 并等待 result。会先确保 session ready。
   * 同时只允许一条在途 request；并发会被立即拒绝。
   */
  async runRequest<M extends ProtocolMethod>(request: ProtocolRequestMessage<M>): Promise<ProtocolResultMessage> {
    if (this.inFlight) {
      this.log("busy_rejected", { requestId: request.id, method: request.method }, "Popup session is busy with another request");
      throw new ProtocolTransportError("session_busy", "Popup session is busy with another request");
    }
    await this.ensureSession();
    const targetOrigin = this.currentTargetOrigin!;
    const popup = this.popup!;
    let unsubscribe: () => void = () => undefined;
    const pending: PendingRequest = {
      resolve: () => undefined,
      reject: () => undefined,
      resultTimer: null
    };
    const promise = new Promise<ProtocolResultMessage>((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
      unsubscribe = this.dispatcher!.awaitResult(request.id, (msg) => {
        this.clearResultTimer(pending);
        this.inFlight = null;
        this.log("result_received", msg, undefined);
        resolve(msg);
      });
    });
    this.inFlight = pending;
    try {
      popup.postMessage(request, targetOrigin);
      this.log("request_sent", sanitizeRequest(request), undefined);
      this.log("waiting_result", undefined, undefined);
    } catch (err) {
      unsubscribe?.();
      this.clearResultTimer(pending);
      this.inFlight = null;
      this.log("busy_rejected", err, "Failed to send request");
      throw new ProtocolTransportError("invalid_origin", err instanceof Error ? err.message : "Failed to send request");
    }
    pending.resultTimer = this.env.setTimeout(() => {
      unsubscribe?.();
      this.inFlight = null;
      this.log("timeout", { stage: "result", requestId: request.id }, "result timeout");
      pending.reject(new ProtocolTransportError("result_timeout", "Timed out waiting for result"));
    }, this.opts.resultTimeoutMs);
    return promise;
  }

  /**
   * 主动关闭 session：清空 pending、解绑 listener、关闭 popup。
   * 外部再次 `ensureSession()` 时会重新开窗。
   */
  closeSession(): void {
    if (this.inFlight) {
      this.clearResultTimer(this.inFlight);
      const p = this.inFlight;
      this.inFlight = null;
      p.reject(new ProtocolTransportError("popup_closed", "Popup session was closed"));
    }
    if (this.dispatcher) {
      this.dispatcher.close();
      this.dispatcher = null;
    }
    if (this.combinedListener) {
      this.env.removeMessageListener(this.combinedListener);
      this.combinedListener = null;
    }
    if (this.closePoller) {
      this.env.clearInterval(this.closePoller);
      this.closePoller = null;
    }
    this.listenerInstalled = false;
    if (this.popup && !isPopupClosed(this.popup)) {
      try {
        this.popup.close();
      } catch {
        // ignore
      }
    }
    this.popup = null;
    this.currentTargetOrigin = null;
    this.readyPromise = null;
    this.transitionTo("disconnected", "popup_closed");
  }

  /* ============== 内部 ============== */

  private async openAndAwaitReady(targetOrigin: string): Promise<void> {
    const url = buildPopupUrl(targetOrigin);
    const features = buildPopupFeatures(this.opts.popupWidth, this.opts.popupHeight);
    this.transitionTo("opening");
    const popup = this.env.open(url, POPUP_NAME, features);
    if (!popup) {
      this.log("busy_rejected", { url, features }, "Popup was blocked by the browser");
      this.transitionTo("disconnected", "popup_closed");
      throw new ProtocolTransportError("popup_blocked", "Popup was blocked by the browser");
    }
    this.popup = popup;
    this.currentTargetOrigin = targetOrigin;
    this.log("popup_opened", { url, features });
    this.installMessageListenerOnce(targetOrigin);
    this.startClosePoller();
    const ready = new Promise<void>((resolve, reject) => {
      const readyTimer = this.env.setTimeout(() => {
        this.log("timeout", { stage: "ready" }, "ready timeout");
        reject(new ProtocolTransportError("ready_timeout", "Timed out waiting for ready"));
      }, this.opts.readyTimeoutMs);
      const onReady = (event: MessageEvent) => {
        if (event.source !== popup) return;
        if (normalizeOrigin(event.origin) !== targetOrigin) return;
        const data = event.data as unknown;
        if (!isPlainObject(data) || data.v !== 1 || data.type !== "ready") return;
        this.env.clearTimeout(readyTimer);
        this.env.removeMessageListener(onReady);
        this.log("ready_received", undefined, undefined);
        this.transitionTo("connected", "ready");
        resolve();
      };
      this.env.addMessageListener(onReady);
    });
    this.log("waiting_ready", undefined, undefined);
    try {
      await ready;
    } catch (err) {
      this.log("session_closed", err, "session aborted while waiting for ready");
      throw err;
    }
  }

  private installMessageListenerOnce(targetOrigin: string): void {
    if (this.listenerInstalled) return;
    this.dispatcher = createResultDispatcher(targetOrigin);
    const combinedHandler = (event: MessageEvent) => {
      const data = event.data as unknown;
      if (!isPlainObject(data) || data.v !== 1 || typeof data.type !== "string") return;
      if (data.type === "result") {
        this.dispatcher!.handler(event);
        return;
      }
      if (data.type === "closing") {
        if (typeof event.origin === "string" && normalizeOrigin(event.origin) !== targetOrigin) {
          return;
        }
        this.log("closing_received", undefined, undefined);
        this.handleSessionClosedByServer("closing");
      }
    };
    this.combinedListener = combinedHandler;
    this.env.addMessageListener(combinedHandler);
    this.listenerInstalled = true;
  }

  private handleSessionClosedByServer(_reason: "closing"): void {
    if (this.inFlight) {
      this.clearResultTimer(this.inFlight);
      const p = this.inFlight;
      this.inFlight = null;
      p.reject(new ProtocolTransportError("popup_closed", "Popup session ended by server (closing)"));
    }
    if (this.dispatcher) {
      this.dispatcher.close();
      this.dispatcher = null;
    }
    if (this.combinedListener) {
      this.env.removeMessageListener(this.combinedListener);
      this.combinedListener = null;
    }
    if (this.closePoller) {
      this.env.clearInterval(this.closePoller);
      this.closePoller = null;
    }
    this.listenerInstalled = false;
    this.popup = null;
    this.currentTargetOrigin = null;
    this.readyPromise = null;
    this.transitionTo("disconnected", "closing");
  }

  private startClosePoller(): void {
    if (this.closePoller) return;
    const closePollMs = this.opts.closePollMs ?? 500;
    this.closePoller = this.env.setInterval(() => {
      if (isPopupClosed(this.popup)) {
        this.log("popup_closed", undefined, undefined);
        if (this.inFlight) {
          this.clearResultTimer(this.inFlight);
          const p = this.inFlight;
          this.inFlight = null;
          p.reject(new ProtocolTransportError("popup_closed", "Popup was closed before the protocol completed"));
        }
        this.transitionTo("disconnected", "popup_closed");
        if (this.dispatcher) {
          this.dispatcher.close();
          this.dispatcher = null;
        }
        if (this.combinedListener) {
          this.env.removeMessageListener(this.combinedListener);
          this.combinedListener = null;
        }
        if (this.closePoller) {
          this.env.clearInterval(this.closePoller);
          this.closePoller = null;
        }
        this.listenerInstalled = false;
        this.popup = null;
        this.currentTargetOrigin = null;
        this.readyPromise = null;
      }
    }, closePollMs);
  }

  private clearResultTimer(p: PendingRequest): void {
    if (p.resultTimer) {
      this.env.clearTimeout(p.resultTimer);
      p.resultTimer = null;
    }
  }

  private transitionTo(next: PopupSessionState, reason: "ready" | "closing" | "popup_closed" = "popup_closed"): void {
    if (this.state === "disconnected" && next === "disconnected") return;
    if (this.state === next) return;
    this.state = next;
    if (reason === "closing" && next === "disconnected") {
      this.log("closing_received", undefined, undefined);
    }
    this.opts.onConnectionStateChange?.(next as PopupConnectionState);
  }

  private log(stage: ProtocolLogStage, detail?: unknown, message?: string): void {
    this.opts.onLog?.({
      at: this.env.now(),
      stage,
      message,
      detail
    });
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeRequest(request: ProtocolRequestMessage<ProtocolMethod>): unknown {
  return {
    ...request,
    params: sanitizeValue(request.params)
  };
}

function sanitizeValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer) {
    return { $type: "binary", byteLength: value.byteLength };
  }
  if (value instanceof Uint8Array) {
    return { $type: "binary", byteLength: value.byteLength };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = sanitizeValue(entry);
    }
    return out;
  }
  return value;
}
