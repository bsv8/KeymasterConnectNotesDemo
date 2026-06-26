// src/lib/binary.ts
// 二进制字段收口：把 Uint8Array 包成协议要求的 BinaryField，并做必要拷贝。
//
// 设计缘由：transport 跨 postMessage 边界时需要 ArrayBuffer；UI 层
// 始终只持有 Uint8Array，避免共享 buffer 被改。

import type { BinaryField } from "./protocol";

export function makeBinaryField(bytes: ArrayBuffer | ArrayBufferView, mime?: string): BinaryField {
  const view =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const copy = new Uint8Array(view);
  const field: BinaryField = {
    $type: "binary",
    bytes: copy.buffer
  };
  if (mime) {
    field.mime = mime;
  }
  return field;
}

export function isBinaryField(value: unknown): value is BinaryField {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as BinaryField).$type === "binary" &&
    (value as BinaryField).bytes instanceof ArrayBuffer &&
    ((value as BinaryField).mime === undefined || typeof (value as BinaryField).mime === "string")
  );
}

export function binaryFieldToBytes(field: BinaryField): Uint8Array {
  return new Uint8Array(field.bytes.slice(0));
}
