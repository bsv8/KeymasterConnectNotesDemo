// src/lib/popupSessionClient.ts
// 页面级 popup session client。
//
// 设计缘由（施工单第 6 章 + 2026-06-27 note-open-cancel-and-transport-hard-switch
//          第 4.2 / 5.5 / 8.3 章）：
//   - 同一 demo 页面，对同一 `targetOrigin`，只维护一个 popup 会话。
//   - 首次 `ensureSession()` 时若没有 popup 句柄就开窗、等一次 `ready`。
//   - 后续 `runRequest()` 复用现有 popup 句柄：不再 `window.open`。
//   - popup 会话**并行**接受多条 request；不再做"同一时刻只允许一条在途"的
//     single-flight 限制——Keymaster 自己负责内部串行执行与排队。
//   - transport 层只保留最薄的 pending request 注册表（key = `request.id`），
//     用来：
//       * 把 `result(id)` 分发给对应 promise；
//       * 给每条 request 单独挂 timeout；
//       * 在 session 断开时批量 reject。
//   - 它**不**是业务状态机；不判断"当前 note 是谁"。
//   - `cancelRequest(id)`：fire-and-forget 顶层 `cancel` 报文，**不**等 ack；
//     旧请求晚回来的结果由业务层做代际隔离丢弃。
//   - popup 关闭 / 刷新后，下次 `runRequest()` 重新开窗。
//   - 不做客户端业务队列；不做自动重试；不做跨 opener 编排。
//
// 这一层拥有：
//   - 长期 `message` 监听（ResultDispatcher）；
//   - popup 句柄；
//   - popup 关闭轮询；
//   - 连接状态机（`opening` / `connected` / `disconnected`）；
//   - 最薄的 pending request 注册表（仅做收尾）。
//
// 这一层**不**拥有：
//   - 任何业务方法（identity.get / cipher.*）；
//   - 任何 UI；只通过回调与日志暴露；
//   - "当前 note 是谁"的判断（那是业务层的活）。

import type {
  PopupConnectionState,
  ProtocolCancelMessage,
  ProtocolMethod,
  ProtocolRequestMessage,
  ProtocolResultMessage
} from "./protocol";
import { PROTOCOL_VERSION } from "./protocol";
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
  /**
   * 最薄的 pending request 注册表。
   * - key = `request.id`；
   * - value = 该 request 的 resolve / reject / timer。
   *
   * 业务层**不**直接读它。业务层只通过 `runRequest()` 拿 promise、通过
   * `cancelRequest(id)` 触发取消。session 断开时 transport 自己批量 reject。
   */
  private pendingRequests: Map<string, PendingRequest> = new Map();
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
   *
   * 不再因已有 pending 就拒绝——session 允许并行持有任意条 pending request；
   * 业务层负责"当前 note 是谁"的判断与旧请求淘汰。
   */
  async runRequest<M extends ProtocolMethod>(request: ProtocolRequestMessage<M>): Promise<ProtocolResultMessage> {
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
        this.pendingRequests.delete(request.id);
        this.log("result_received", msg, undefined);
        resolve(msg);
      });
    });
    this.pendingRequests.set(request.id, pending);
    try {
      popup.postMessage(request, targetOrigin);
      this.log("request_sent", sanitizeRequest(request), undefined);
      this.log("waiting_result", undefined, undefined);
    } catch (err) {
      unsubscribe?.();
      this.clearResultTimer(pending);
      this.pendingRequests.delete(request.id);
      this.log("busy_rejected", err, "Failed to send request");
      throw new ProtocolTransportError("invalid_origin", err instanceof Error ? err.message : "Failed to send request");
    }
    pending.resultTimer = this.env.setTimeout(() => {
      unsubscribe?.();
      this.pendingRequests.delete(request.id);
      this.log("timeout", { stage: "result", requestId: request.id }, "result timeout");
      pending.reject(new ProtocolTransportError("result_timeout", "Timed out waiting for result"));
    }, this.opts.resultTimeoutMs);
    return promise;
  }

  /**
   * 通知 popup 取消一条进行中的 request。
   *
   * 语义（施工单第 4.3 / 5.1 / 8.3 章）：
   *   - fire-and-forget：仅 postMessage 顶层 `cancel`，**不**等 ack；
   *   - session 不在 `connected` / popup 句柄丢失时直接 no-op；
   *   - 协议层允许 cancel 被忽略（executing 阶段、id 未命中），上层必须靠
   *     代际隔离丢弃旧结果，**不**假设 cancel 后旧请求一定消失；
   *   - 该方法**不**碰 `pendingRequests` 注册表——旧 request 的 promise 由业务层
   *     通过代际隔离丢弃，timer 自然会在 timeout 时清掉；session 断开时
   *     由 transport 自己批量 reject。
   */
  cancelRequest(id: string): void {
    if (this.state !== "connected" || !this.popup || !this.currentTargetOrigin) {
      // session 已经断开：什么都不发，让旧结果走批量 reject 收尾。
      return;
    }
    const cancelMessage: ProtocolCancelMessage = {
      v: PROTOCOL_VERSION,
      type: "cancel",
      id
    };
    try {
      this.popup.postMessage(cancelMessage, this.currentTargetOrigin);
      this.log("cancel_sent", { requestId: id }, undefined);
    } catch (err) {
      // best-effort：吞掉发送失败。
      this.log("cancel_sent", { requestId: id, error: formatError(err) }, "cancel postMessage failed");
    }
  }

  /**
   * 主动关闭 session：批量 reject 所有 pending、解绑 listener、关闭 popup。
   * 外部再次 `ensureSession()` 时会重新开窗。
   */
  closeSession(): void {
    this.rejectAllPending("popup_closed", "Popup session was closed");
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
    this.rejectAllPending("popup_closed", "Popup session ended by server (closing)");
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
        this.rejectAllPending("popup_closed", "Popup was closed before the protocol completed");
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

  /**
   * 批量 reject 所有 pending request。
   * 用于 session 整体作废时（closeSession / 服务端 closing / popup 被用户关闭）。
   * - 清掉每条的 timer；
   * - 清空注册表。
   */
  private rejectAllPending(
    code: "popup_closed",
    message: string
  ): void {
    if (this.pendingRequests.size === 0) return;
    const error = new ProtocolTransportError(code, message);
    for (const [id, pending] of this.pendingRequests) {
      this.clearResultTimer(pending);
      pending.reject(error);
    }
    this.pendingRequests.clear();
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

function formatError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
