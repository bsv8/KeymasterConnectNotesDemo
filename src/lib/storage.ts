// src/lib/storage.ts
// 本地 KV 存储 + record schema 校验。
//
// 设计缘由（施工单 5.x）：
//   - 存储是 S3-like KV；key 模拟文件树，**不**额外维护 folder 真值。
//   - 树结构完全由 `key path` 派生。
//   - 按 `ownerPublicKeyHex` 分区；切换身份后只加载当前 owner 的 notes。
//   - 落库是密文；tag 明文；title 明文。
//   - 存储键 `notes:owner:{publicKeyHex}` → `Record<path, StoredNoteRecord>`。
//
// 这一层**不**持有 markdown 明文缓存、不持有 BlockNote JSON。

import type { StoredNoteRecord } from "./notes";
import { isStoredNoteRecord } from "./notes";

const STORAGE_KEY_PREFIX = "notes-demo:owner:";

/** ownerPublicKeyHex → notes 容器在 localStorage 里的 key。 */
export function storageKeyForOwner(ownerPublicKeyHex: string): string {
  return `${STORAGE_KEY_PREFIX}${ownerPublicKeyHex}`;
}

/** 读取某 owner 名下所有 notes；schema 不合法记录会被丢弃。 */
export function loadOwnerNotes(ownerPublicKeyHex: string): Record<string, StoredNoteRecord> {
  const raw = readStorage(storageKeyForOwner(ownerPublicKeyHex));
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, StoredNoteRecord> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isStoredNoteRecord(value)) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 写入某 owner 名下所有 notes；写入前调用方应保证 record 已通过 schema 校验。 */
export function saveOwnerNotes(ownerPublicKeyHex: string, notes: Record<string, StoredNoteRecord>): void {
  writeStorage(storageKeyForOwner(ownerPublicKeyHex), JSON.stringify(notes));
}

/** 列出当前 owner 下的 path 列表。 */
export function listNotePaths(notes: Record<string, StoredNoteRecord>): string[] {
  return Object.keys(notes).sort();
}

/**
 * 按 tag 过滤；tag 是明文，所以可以直接本地搜索，**不**需要解密。
 */
export function findPathsByTag(notes: Record<string, StoredNoteRecord>, tag: string): string[] {
  const needle = tag.trim().toLowerCase();
  if (needle.length === 0) return [];
  const out: string[] = [];
  for (const [path, record] of Object.entries(notes)) {
    if (record.tags.some((t) => t.toLowerCase() === needle)) {
      out.push(path);
    }
  }
  return out.sort();
}

/** 列出当前 owner 下的所有 tag（去重、转小写）。 */
export function listAllTags(notes: Record<string, StoredNoteRecord>): string[] {
  const set = new Set<string>();
  for (const record of Object.values(notes)) {
    for (const tag of record.tags) {
      set.add(tag.toLowerCase());
    }
  }
  return [...set].sort();
}

/**
 * 检测同 owner 下 path 是否冲突。
 * 设计缘由：移动 / 重命名时若有同名 note 已被占用，必须阻断。
 */
export function isPathConflict(
  notes: Record<string, StoredNoteRecord>,
  path: string,
  excludePath?: string
): boolean {
  if (!(path in notes)) return false;
  return path !== excludePath;
}

function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch (err) {
    console.error("[notes-demo] failed to write storage", err);
  }
}
