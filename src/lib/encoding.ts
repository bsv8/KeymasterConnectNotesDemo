// src/lib/encoding.ts
// 编码工具：UTF-8 / base64 / hex。
//
// 设计缘由：
//   - 落库用 base64（cipher.nonce / cipher.cipherbytes 持久化）。
//   - 公钥展示与日志用 hex。
//   - 业务 markdown 走 UTF-8 字节，再喂给 `cipher.encrypt`。

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function textToBytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export function bytesToText(value: Uint8Array): string {
  return textDecoder.decode(value);
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

export function hexToBytes(input: string): Uint8Array {
  const normalized = input.replace(/^0x/i, "").replace(/\s+/g, "");
  if (normalized.length === 0) {
    throw new Error("Hex input is empty");
  }
  if (normalized.length % 2 !== 0) {
    throw new Error("Hex input must contain an even number of characters");
  }
  if (!/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error("Hex input contains invalid characters");
  }
  const out = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
}

export function base64ToBytes(input: string): Uint8Array {
  const normalized = input.replace(/\s+/g, "").replace(/^data:[^,]+,/, "");
  if (normalized.length === 0) {
    throw new Error("Base64 input is empty");
  }
  const binary = globalThis.atob(normalized);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    out[index] = binary.charCodeAt(index);
  }
  return out;
}

/** 容错地把 hex / base64 字符串解析为 bytes。优先识别 hex（含 0x 前缀）。 */
export function parseBinaryInput(input: string): Uint8Array {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("Binary input is empty");
  }
  const compact = trimmed.replace(/\s+/g, "");
  if (/^0x[0-9a-fA-F]+$/.test(compact) || /^[0-9a-fA-F]+$/.test(compact)) {
    return hexToBytes(compact);
  }
  return base64ToBytes(trimmed);
}
