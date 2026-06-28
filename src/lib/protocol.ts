// src/lib/protocol.ts
// 本项目需要的最小 Keymaster Connect 协议类型收口。
//
// 设计缘由（施工单第 6 章 +
//          施工单 2026-06-28 001 connect-session-bound-key-integration 硬切换 +
//          施工单 2026-06-28 002 protocol-business-methods-bind-connect-session
//          硬切换）：
//   - 本项目接 `connect.login` / `connect.resume` / `connect.logout` 作为
//     持续登录的真值（**取代**旧的 `identity.get` 一次性身份断言）；
//   - 保留 `connect.*` / `cipher.encrypt` / `cipher.decrypt` 作为本 demo
//     实际主流程；`cipher.*` 必须按 session 绑定 key 执行，**不**依赖全局 active key。
//   - 保留 `identity.get` 作为可选业务方法壳，但其参数已显式包含
//     `connectSessionId`（与上游 002 对齐）。它的定位是"会话内身份断言能力"，
//     **不是**登录入口；本 demo 当前不把它接入 UI / 状态机。
//   - 砍掉 `intent.sign` / `p2pkh.*` / `feepool.*`——这些方法与本 demo 无关。
//   - 类型与依赖项目 (`keymaster.cc`) 的 contract 对齐，但只暴露本项目需要的
//     六种方法，避免 UI / 状态面被多余协议拉大。

export const PROTOCOL_VERSION = 1 as const;
export const PROTOCOL_POPUP_PATH = "/protocol/v1/popup" as const;

export interface BinaryField {
  $type: "binary";
  bytes: ArrayBuffer;
  mime?: string;
}

export const PROTOCOL_METHODS = [
  "identity.get",
  "connect.login",
  "connect.resume",
  "connect.logout",
  "cipher.encrypt",
  "cipher.decrypt"
] as const;

export type ProtocolMethod = (typeof PROTOCOL_METHODS)[number];

export type ProtocolErrorCode =
  | "invalid_request"
  | "invalid_origin"
  | "user_rejected"
  | "active_key_unavailable"
  | "decrypt_failed"
  | "internal_error";

export interface ProtocolError {
  code: ProtocolErrorCode;
  message: string;
}

export interface ProtocolReadyMessage {
  v: typeof PROTOCOL_VERSION;
  type: "ready";
}

export interface ProtocolClosingMessage {
  v: typeof PROTOCOL_VERSION;
  type: "closing";
}

/**
 * 顶层 `cancel` 报文：用于告知 popup 取消一条进行中的 request。
 *
 * 设计缘由（施工单 2026-06-27 note-open-cancel-and-transport-hard-switch 第 8.1 章）：
 *   - `cancel` 是顶层 message，**不**属于业务方法（不进 `ProtocolMethod`）；
 *   - `cancel` 不带独立 `result` 回包——协议层明确"无 ack"，旧请求的
 *     `result` 仍可能按 `request.id` 回来，前端靠代际隔离丢弃；
 *   - 不写 `method: "cancel"`。`cancel` 与 `request` 是平级 type。
 */
export interface ProtocolCancelMessage {
  v: typeof PROTOCOL_VERSION;
  type: "cancel";
  id: string;
}

export interface ProtocolRequestMessage<M extends ProtocolMethod = ProtocolMethod> {
  v: typeof PROTOCOL_VERSION;
  type: "request";
  id: string;
  method: M;
  params: MethodParams<M>;
}

export type ProtocolResultMessage =
  | {
      v: typeof PROTOCOL_VERSION;
      type: "result";
      id: string;
      ok: true;
      result: MethodResult;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "result";
      id: string;
      ok: false;
      error: ProtocolError;
    };

export type ProtocolMessage =
  | ProtocolReadyMessage
  | ProtocolRequestMessage
  | ProtocolResultMessage
  | ProtocolClosingMessage
  | ProtocolCancelMessage;

export type PopupConnectionState = "opening" | "connected" | "disconnected";

/* ============== identity.get ============== */

/**
 * `identity.get` 请求参数。
 *
 * 设计缘由（施工单 2026-06-28 002 protocol-business-methods-bind-connect-session
 *          硬切换第 4.1 章）：
 *   - 这是**会话内业务方法**，不是登录入口。subject 来自 session 绑定 owner；
 *   - 必填 `connectSessionId`：服务端按 session 找到绑定 key 来生成断言；
 *   - 缺 `connectSessionId` 的 `identity.get` 请求在协议层**不**成立——本 demo
 *     不接受任何"旧版 `identity.get`"降级路径；
 *   - 本 demo 当前不把它接入 UI / 状态机；这里只暴露 contract 同步上游 002。
 */
export interface IdentityGetParams {
  /** 业务 session id；按此找到绑定 owner。 */
  connectSessionId: string;
  /** 当前页面 origin，由调用方传入。 */
  aud: string;
  iat: number;
  exp: number;
  text: string;
  claims?: string[];
}

export type ResolvedClaimValue =
  | string
  | number
  | boolean
  | null
  | BinaryField
  | ResolvedClaimValue[]
  | { [key: string]: ResolvedClaimValue };

export interface IdentityGetResult {
  identityEnvelope: BinaryField;
  signature: BinaryField;
  subject: { publicKey: BinaryField };
  resolvedClaims: Record<string, ResolvedClaimValue>;
}

/* ============== connect.login / connect.resume / connect.logout ============== */

/**
 * `connect.login` 请求参数。
 *
 * 设计缘由（施工单 2026-06-28 001 connect-session-bound-key-integration
 *          第 4.2 / 5.1.1 章）：
 *   - 首次显式登录：用户必须在 popup 内选定一把 key；
 *   - 成功后 Keymaster 建立 connect session 记录并返回 `connectSessionId`；
 *   - 后续 `cipher.*` 都按这把 key 执行，**不**读钱包全局 active key；
 *   - `aud` 由调用方传入（popup 内仍按 `event.origin` 做最终校验）。
 */
export interface ConnectLoginParams {
  /** 目标站点 origin；必须等于 `event.origin`，否则拒绝。 */
  aud: string;
  /** 签发时间（unix seconds）。 */
  iat: number;
  /** 过期时间（unix seconds）；必须严格大于 iat。 */
  exp: number;
  /** 人类可读确认文案。 */
  text: string;
  /** 请求索要的 claim 名列表。 */
  claims?: string[];
}

/**
 * `connect.login` 成功结果。
 *
 * 与 `identity.get` 结果**不同**——`identity.get` 是会话内身份断言能力，
 * 而 `connect.login` 是登录真值；后者多出一个稳定 `connectSessionId`，
 * 它是后续 `resume` / `cipher.*` / 未来可能的会话内 `identity.get` 的真值 key。
 */
export interface ConnectLoginResult {
  /** 持续 session id；caller 必须本地持久化。 */
  connectSessionId: string;
  /** 该 session 绑定 key 的公钥 hex。 */
  ownerPublicKeyHex: string;
  /** Keymaster 本次实际返回的 claim 真值。 */
  resolvedClaims: Record<string, ResolvedClaimValue>;
  /** 解析时间（unix milliseconds）。 */
  resolvedAt: number;
}

/**
 * `connect.resume` 请求参数。
 *
 * 设计缘由（施工单 2026-06-28 001 第 5.1.2 章）：
 *   - 用于 caller 刷新页面 / popup 关闭重开 / transport 断线重建；
 *   - popup 当前文档若未解锁：走 unlock UI，**不**重新登录 / 不重新选 key；
 *   - session 无效（吊销 / origin 不匹配 / 绑定 key 已删）：失败回
 *     caller，由 caller 决定是否清掉本地 sessionId 并回登录页。
 */
export interface ConnectResumeParams {
  /** 已知 session id；浏览器 `event.origin` 必须等于 session.origin。 */
  connectSessionId: string;
  /** 请求索要的 claim 名列表（用于刷新 session 真值；可选）。 */
  claims?: string[];
}

/** `connect.resume` 成功结果。 */
export interface ConnectResumeResult {
  /** 原 session id（继续使用）。 */
  connectSessionId: string;
  /** 该 session 绑定 key 的公钥 hex。 */
  ownerPublicKeyHex: string;
  resolvedClaims: Record<string, ResolvedClaimValue>;
  /** 本次 resume 时间（unix milliseconds）。 */
  resolvedAt: number;
}

/** `connect.logout` 请求参数。 */
export interface ConnectLogoutParams {
  /** 要吊销的 session id。 */
  connectSessionId: string;
}

/** `connect.logout` 成功结果：服务端吊销成功后回空对象。 */
export interface ConnectLogoutResult {
  /** 吊销的 session id；与请求一致。 */
  connectSessionId: string;
}

/* ============== cipher.encrypt / cipher.decrypt ============== */

/**
 * `cipher.encrypt` 请求参数（施工单 2026-06-28 001 第 5.2.1 章）。
 *
 * 设计缘由：
 *   - 必填 `connectSessionId`：服务端按 session 绑定 key 执行加密；
 *   - 服务端**不再**读取钱包全局 active key；
 *   - 失败关闭：session 无效 / 绑定 key 不可用 / popup 未解锁 → 走
 *     unlock / 失败分支，**不**静默 fallback 到另一把 key。
 */
export interface CipherEncryptParams {
  /** 业务 session id；按此找到绑定 key。 */
  connectSessionId: string;
  text: string;
  contentType: string;
  content: BinaryField;
}

/** `cipher.encrypt` 成功结果。 */
export interface CipherEncryptResult {
  nonce: BinaryField;
  cipherbytes: BinaryField;
}

/**
 * `cipher.decrypt` 请求参数（施工单 2026-06-28 001 第 5.2.2 章）。
 *
 * 设计缘由：
 *   - 必填 `connectSessionId`：服务端按 session 绑定 key 执行解密；
 *   - 失败关闭：同上，**不** fallback。
 */
export interface CipherDecryptParams {
  /** 业务 session id；按此找到绑定 key。 */
  connectSessionId: string;
  text: string;
  nonce: BinaryField;
  cipherbytes: BinaryField;
}

/** `cipher.decrypt` 成功结果。 */
export interface CipherDecryptResult {
  contentType: string;
  content: BinaryField;
}

export interface MethodParamsMap {
  "identity.get": IdentityGetParams;
  "connect.login": ConnectLoginParams;
  "connect.resume": ConnectResumeParams;
  "connect.logout": ConnectLogoutParams;
  "cipher.encrypt": CipherEncryptParams;
  "cipher.decrypt": CipherDecryptParams;
}

export type MethodParams<M extends ProtocolMethod> = M extends keyof MethodParamsMap
  ? MethodParamsMap[M]
  : never;

export interface MethodResultMap {
  "identity.get": IdentityGetResult;
  "connect.login": ConnectLoginResult;
  "connect.resume": ConnectResumeResult;
  "connect.logout": ConnectLogoutResult;
  "cipher.encrypt": CipherEncryptResult;
  "cipher.decrypt": CipherDecryptResult;
}

export type MethodResult<M extends ProtocolMethod = ProtocolMethod> = M extends keyof MethodResultMap
  ? MethodResultMap[M]
  : never;
