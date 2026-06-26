// src/lib/keymaster.ts
// 业务 ↔ 协议收口。
//
// 设计缘由（施工单第 6 章）：
//   - 上层只关心"登录 / 加密 / 解密"三个业务动作，**不**直接拼协议对象。
//   - 这里集中处理 `aud`、origin 校验、BinaryField 转换。
//   - `identity.get` 必须传 `aud`（当前页面 origin）；`cipher.*` 不传 `aud`，
//     站点绑定依赖浏览器真实 `event.origin`。

import type {
  CipherDecryptParams,
  CipherDecryptResult,
  CipherEncryptParams,
  CipherEncryptResult,
  IdentityGetParams,
  IdentityGetResult,
  ProtocolRequestMessage,
  ResolvedClaimValue
} from "./protocol";
import { makeBinaryField, binaryFieldToBytes } from "./binary";
import { textToBytes, bytesToHex } from "./encoding";

/** 默认身份断言请求的 claims（施工单 4.2）。 */
export const DEFAULT_IDENTITY_CLAIMS = [
  "key.label",
  "profile.nickname",
  "wallet.bsv.address.main"
] as const;

/** 构造 `identity.get` 协议请求。 */
export function buildIdentityGetRequest(options: {
  origin: string;
  text: string;
  ttlSeconds: number;
  claims?: readonly string[];
  requestId: string;
}): ProtocolRequestMessage<"identity.get"> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.max(1, options.ttlSeconds);
  const params: IdentityGetParams = {
    aud: options.origin,
    iat: now,
    exp,
    text: options.text,
    claims: options.claims ? [...options.claims] : [...DEFAULT_IDENTITY_CLAIMS]
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

/** 构造 `cipher.encrypt` 协议请求：把 markdown UTF-8 字节喂进去。 */
export function buildCipherEncryptRequest(options: {
  text: string;
  contentType: string;
  markdown: string;
  requestId: string;
}): ProtocolRequestMessage<"cipher.encrypt"> {
  const params: CipherEncryptParams = {
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

/** 构造 `cipher.decrypt` 协议请求。nonce / cipherbytes 来自本地存储。 */
export function buildCipherDecryptRequest(options: {
  text: string;
  nonceBase64: string;
  cipherbytesBase64: string;
  requestId: string;
}): ProtocolRequestMessage<"cipher.decrypt"> {
  const params: CipherDecryptParams = {
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
