// src/lib/protocol.ts
// 本项目需要的最小 Keymaster Connect 协议类型收口。
//
// 设计缘由（施工单第 6 章）：
//   - 本项目**只**接 `identity.get` / `cipher.encrypt` / `cipher.decrypt`。
//   - 保留协议常量与最小方法类型，砍掉 `intent.sign` / `p2pkh.*` / `feepool.*`。
//   - 类型与现有 demo (`KeymasterConnectDemo`) 对齐，但只保留本项目需要的
//     三种方法，避免 UI / 状态面被多余协议拉大。

export const PROTOCOL_VERSION = 1 as const;
export const PROTOCOL_POPUP_PATH = "/protocol/v1/popup" as const;

export interface BinaryField {
  $type: "binary";
  bytes: ArrayBuffer;
  mime?: string;
}

export const PROTOCOL_METHODS = [
  "identity.get",
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
  | ProtocolClosingMessage;

export type PopupConnectionState = "opening" | "connected" | "disconnected";

/* ============== identity.get ============== */

export interface IdentityGetParams {
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

/* ============== cipher.encrypt / cipher.decrypt ============== */

export interface CipherEncryptParams {
  text: string;
  contentType: string;
  content: BinaryField;
}

export interface CipherEncryptResult {
  nonce: BinaryField;
  cipherbytes: BinaryField;
}

export interface CipherDecryptParams {
  text: string;
  nonce: BinaryField;
  cipherbytes: BinaryField;
}

export interface CipherDecryptResult {
  contentType: string;
  content: BinaryField;
}

export interface MethodParamsMap {
  "identity.get": IdentityGetParams;
  "cipher.encrypt": CipherEncryptParams;
  "cipher.decrypt": CipherDecryptParams;
}

export type MethodParams<M extends ProtocolMethod> = M extends keyof MethodParamsMap
  ? MethodParamsMap[M]
  : never;

export interface MethodResultMap {
  "identity.get": IdentityGetResult;
  "cipher.encrypt": CipherEncryptResult;
  "cipher.decrypt": CipherDecryptResult;
}

export type MethodResult<M extends ProtocolMethod = ProtocolMethod> = M extends keyof MethodResultMap
  ? MethodResultMap[M]
  : never;
