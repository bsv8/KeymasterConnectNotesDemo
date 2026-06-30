// src/lib/keymaster.ts
// 业务 ↔ 协议收口。
//
// 设计缘由（施工单第 6 章 +
//          施工单 2026-06-28 001 connect-session-bound-key-integration 硬切换
//          第 4 / 5 / 8 章 +
//          施工单 2026-06-28 002 protocol-business-methods-bind-connect-session
//          硬切换 +
//          施工单 2026-06-29 001 open-app-appview-connect-launch 硬切换
//          第 6 / 8 章）：
//   - 上层只关心"登录 / 续登 / 启动 / 注销 / 加密 / 解密"六个业务动作，
//     **不**直接拼协议对象。
//   - 这里集中处理 `aud`、origin 校验、BinaryField 转换、connectSessionId 注入。
//   - `connect.login` / `connect.resume` / `connect.launch` / `connect.logout`
//     是持续登录的真值；`connect.launch` 是 Keymaster Session Window 以
//     appView 模式拉起 JustNote 时的首登入口，**不**是另一种 login 按钮。
//   - `identity.get` 旧 helper 仍保留，但其 contract 已切到 session-bound：
//     必须显式传入 `connectSessionId`；定位是"会话内身份断言能力"，JustNote
//     自身当前不再调用它。
//   - `cipher.*` **必须**带 `connectSessionId`；服务端按 session 绑定 key 执行，
//     **不**依赖全局 active key（施工单 2026-06-28 001 第 5.2 章）。

import type {
  CipherDecryptParams,
  CipherDecryptResult,
  CipherEncryptParams,
  CipherEncryptResult,
  ConnectLaunchParams,
  ConnectLaunchResult,
  ConnectLoginParams,
  ConnectLoginResult,
  ConnectLogoutParams,
  ConnectLogoutResult,
  ConnectResumeParams,
  ConnectResumeResult,
  IdentityGetParams,
  IdentityGetResult,
  ProtocolRequestMessage,
  ResolvedClaimValue
} from "./protocol";
import { makeBinaryField, binaryFieldToBytes } from "./binary";
import { textToBytes, bytesToHex } from "./encoding";

/** 默认 connect.login 请求的 claims（施工单 4.2）。 */
export const DEFAULT_CONNECT_LOGIN_CLAIMS = [
  "key.label",
  "profile.nickname",
  "wallet.bsv.address.main"
] as const;

/** 构造 `connect.login` 协议请求。 */
export function buildConnectLoginRequest(options: {
  origin: string;
  text: string;
  ttlSeconds: number;
  claims?: readonly string[];
  requestId: string;
}): ProtocolRequestMessage<"connect.login"> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.max(1, options.ttlSeconds);
  const params: ConnectLoginParams = {
    aud: options.origin,
    iat: now,
    exp,
    text: options.text,
    claims: options.claims ? [...options.claims] : [...DEFAULT_CONNECT_LOGIN_CLAIMS]
  };
  return {
    v: 1,
    type: "request",
    id: options.requestId,
    method: "connect.login",
    params
  };
}

/** 构造 `connect.resume` 协议请求。 */
export function buildConnectResumeRequest(options: {
  connectSessionId: string;
  claims?: readonly string[];
  requestId: string;
}): ProtocolRequestMessage<"connect.resume"> {
  const params: ConnectResumeParams = {
    connectSessionId: options.connectSessionId,
    claims: options.claims ? [...options.claims] : undefined
  };
  return {
    v: 1,
    type: "request",
    id: options.requestId,
    method: "connect.resume",
    params
  };
}

/** 构造 `connect.logout` 协议请求。 */
export function buildConnectLogoutRequest(options: {
  connectSessionId: string;
  requestId: string;
}): ProtocolRequestMessage<"connect.logout"> {
  const params: ConnectLogoutParams = {
    connectSessionId: options.connectSessionId
  };
  return {
    v: 1,
    type: "request",
    id: options.requestId,
    method: "connect.logout",
    params
  };
}

/**
 * `connect.login` / `connect.resume` 解析后的结果归一为前端好用的字段。
 *
 * 设计缘由（施工单 2026-06-28 001 第 4.2 / 8.3 章）：
 *   - `connectSessionId` 持久化到 localStorage，是后续 resume / cipher.* 的真值；
 *   - `ownerPublicKeyHex` 是 session 绑定 key 的公钥 hex；**不**依赖 active key；
 *   - `resolvedAt` 用于页头 "last login" 展示；
 *   - `claims` 是明文 claims，可继续透传给上层。
 */
export interface ParsedConnectSession {
  connectSessionId: string;
  ownerPublicKeyHex: string;
  claims: Record<string, ResolvedClaimValue>;
  resolvedAt: number;
}

/**
 * 构造 `connect.launch` 协议请求。
 *
 * 设计缘由（施工单 2026-06-29 001 open-app-appview-connect-launch 硬切换
 *          第 4.3 / 5.2 / 6.三 章）：
 *   - 唯一必填字段 = `launchToken`；
 *   - **不**带 `aud` / `iat` / `exp` / `text`：launchToken 本身由 launcher 服务端
 *     验签 + 一次性消费，caller 不再构造短时效 `aud`；
 *   - **不**带 `claims`：launcher 已把 claims 锁进 launchToken；
 *   - `launchToken` 由 launcher 放进 client URL 的 `?launchToken=` query，
 *     透传到此处。
 */
export function buildConnectLaunchRequest(options: {
  launchToken: string;
  requestId: string;
}): ProtocolRequestMessage<"connect.launch"> {
  if (!options.launchToken) {
    throw new Error("connect.launch requires a non-empty launchToken");
  }
  const params: ConnectLaunchParams = {
    launchToken: options.launchToken
  };
  return {
    v: 1,
    type: "request",
    id: options.requestId,
    method: "connect.launch",
    params
  };
}

/**
 * 把 `connect.login` / `connect.resume` 结果归一为 `ParsedConnectSession`。
 * - login / resume 的 result 结构相同（都是 `connectSessionId + ownerPublicKeyHex + claims + resolvedAt`），
 *   所以共用同一份解析函数。
 */
export function parseConnectSessionResult(
  result: ConnectLoginResult | ConnectResumeResult
): ParsedConnectSession {
  return {
    connectSessionId: result.connectSessionId,
    ownerPublicKeyHex: result.ownerPublicKeyHex,
    claims: result.resolvedClaims,
    resolvedAt: result.resolvedAt
  };
}

/**
 * 把 `connect.launch` 结果归一为 `ParsedConnectSession`。
 *
 * 设计缘由（施工单 2026-06-29 001 第 6.六 章）：
 *   - launch / login / resume 的 result 形状完全一致；
 *   - **不**引入"Open App 专用 session record"——launch 成功后必须共用
 *     同一份 `StoredConnectSessionRecord` 持久化结构；
 *   - 因此**不**新增第二套 result 解析路径，直接复用 `parseConnectSessionResult`
 *     的真值结构。这里仅保留一个语义清晰的入口，避免调用方在 launch 成功
 *     分支里写 `result as never` 这种绕过 type 的硬转。
 */
export function parseConnectLaunchResult(result: ConnectLaunchResult): ParsedConnectSession {
  return {
    connectSessionId: result.connectSessionId,
    ownerPublicKeyHex: result.ownerPublicKeyHex,
    claims: result.resolvedClaims,
    resolvedAt: result.resolvedAt
  };
}

/**
 * 解析 `connect.logout` 结果。
 *
 * 设计缘由（施工单 2026-06-28 001 第 4.4 / 6.6 / 6.9 章）：
 *   - 服务端吊销成功后回 `connectSessionId`；
 *   - caller 拿到后必须清掉本地 session 记录；
 *   - 之后同 sessionId 的 `resume` 必须失败。
 */
export function parseConnectLogoutResult(result: ConnectLogoutResult): {
  connectSessionId: string;
} {
  return {
    connectSessionId: result.connectSessionId
  };
}

/* ============== 旧 identity.get（保留为可选会话内能力；JustNote 当前不再调用） ============== */

/**
 * 构造 `identity.get` 协议请求。
 *
 * 设计缘由（施工单 2026-06-28 002 protocol-business-methods-bind-connect-session
 *          硬切换第 4.1 / 7.3 章）：
 *   - `identity.get` 在 JustNote 中保留为可选的"会话内身份断言能力"，**不**是登录入口；
 *   - contract 已切到 session-bound：调用方**必须**显式传入 `connectSessionId`，
 *     否则抛错；构造出来的 params 也必须带 `connectSessionId`；
 *   - JustNote 当前 UI / 状态机不再调用它；helper 留在这里是为了后续接入时
 *     直接对齐上游 002 的 contract，而不是继续构造旧版缺 sessionId 的请求。
 */
export function buildIdentityGetRequest(options: {
  connectSessionId: string;
  origin: string;
  text: string;
  ttlSeconds: number;
  claims?: readonly string[];
  requestId: string;
}): ProtocolRequestMessage<"identity.get"> {
  if (!options.connectSessionId) {
    throw new Error("identity.get requires a non-empty connectSessionId");
  }
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.max(1, options.ttlSeconds);
  const params: IdentityGetParams = {
    connectSessionId: options.connectSessionId,
    aud: options.origin,
    iat: now,
    exp,
    text: options.text,
    claims: options.claims ? [...options.claims] : undefined
  };
  return {
    v: 1,
    type: "request",
    id: options.requestId,
    method: "identity.get",
    params
  };
}

/** 把 `identity.get` 解析后的结果归一为前端好用的字段。 */
export interface ParsedIdentity {
  publicKeyHex: string;
  claims: Record<string, ResolvedClaimValue>;
  resolvedAt: number;
}

export function parseIdentityResult(result: IdentityGetResult): ParsedIdentity {
  return {
    publicKeyHex: bytesToHex(binaryFieldToBytes(result.subject.publicKey)),
    claims: result.resolvedClaims,
    resolvedAt: Date.now()
  };
}

/* ============== cipher.* ============== */

/**
 * 构造 `cipher.encrypt` 协议请求。
 *
 * 设计缘由（施工单 2026-06-28 001 第 5.2.1 章）：
 *   - **必须**带 `connectSessionId`：服务端按 session 绑定 key 执行；
 *   - 不再依赖全局 active key，**不**允许调用方省略 sessionId。
 */
export function buildCipherEncryptRequest(options: {
  connectSessionId: string;
  text: string;
  contentType: string;
  markdown: string;
  requestId: string;
}): ProtocolRequestMessage<"cipher.encrypt"> {
  if (!options.connectSessionId) {
    throw new Error("cipher.encrypt requires a non-empty connectSessionId");
  }
  const params: CipherEncryptParams = {
    connectSessionId: options.connectSessionId,
    text: options.text,
    contentType: options.contentType,
    content: makeBinaryField(textToBytes(options.markdown), options.contentType)
  };
  return {
    v: 1,
    type: "request",
    id: options.requestId,
    method: "cipher.encrypt",
    params
  };
}

/**
 * 构造 `cipher.decrypt` 协议请求。
 *
 * 设计缘由（施工单 2026-06-28 001 第 5.2.2 章）：
 *   - **必须**带 `connectSessionId`；
 *   - 服务端按 session 绑定 key 执行，**不**读全局 active key；
 *   - 不允许调用方省略 sessionId。
 */
export function buildCipherDecryptRequest(options: {
  connectSessionId: string;
  text: string;
  nonceBase64: string;
  cipherbytesBase64: string;
  requestId: string;
}): ProtocolRequestMessage<"cipher.decrypt"> {
  if (!options.connectSessionId) {
    throw new Error("cipher.decrypt requires a non-empty connectSessionId");
  }
  const params: CipherDecryptParams = {
    connectSessionId: options.connectSessionId,
    text: options.text,
    nonce: makeBinaryField(base64ToBytesOrThrow(options.nonceBase64)),
    cipherbytes: makeBinaryField(base64ToBytesOrThrow(options.cipherbytesBase64))
  };
  return {
    v: 1,
    type: "request",
    id: options.requestId,
    method: "cipher.decrypt",
    params
  };
}

function base64ToBytesOrThrow(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** 解析 `cipher.encrypt` 结果为落库所需的 base64 字符串。 */
export interface StoredCipher {
  contentType: string;
  nonceBase64: string;
  cipherbytesBase64: string;
}

export function parseCipherEncryptResult(result: CipherEncryptResult): StoredCipher {
  return {
    contentType: "keymaster.notes.markdown.v1",
    nonceBase64: bytesToBase64(binaryFieldToBytes(result.nonce)),
    cipherbytesBase64: bytesToBase64(binaryFieldToBytes(result.cipherbytes))
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
}

/** 解析 `cipher.decrypt` 结果为明文 markdown。 */
export function parseCipherDecryptResult(result: CipherDecryptResult): string {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(binaryFieldToBytes(result.content));
  return text;
}
