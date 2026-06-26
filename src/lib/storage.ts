// src/lib/storage.ts
// 本地 KV 存储 + folder/note 容器 + 增删改查 + 同目录重名 / 移动合法性 / 空间为空判定。
//
// 设计缘由（施工单第 4 / 9 章）：
//   - 容器按 ownerPublicKeyHex 分区；存储 key `notes-demo:owner:{publicKeyHex}`。
//   - 容器形态：`{ folders: Record<id, StoredFolderRecord>, notes: Record<id, StoredNoteRecord> }`。
//   - owner 信息**不**写进 record 本身；外层 key 已经隔离。
//   - 这一层**不**持有 markdown 明文缓存；只持有密文 + 明文元数据。
//   - 所有"是不是合法 / 是不是冲突 / 是不是空"的判断都收口在这里；上层 App 不重复实现。

import type { StoredFolderRecord, StoredNoteRecord } from "./notes";
import { isStoredFolderRecord, isStoredNoteRecord } from "./notes";

const STORAGE_KEY_PREFIX = "notes-demo:owner:";

export interface StoredNotesSpace {
  v: 1;
  folders: Record<string, StoredFolderRecord>;
  notes: Record<string, StoredNoteRecord>;
}

export const EMPTY_SPACE: StoredNotesSpace = { v: 1, folders: {}, notes: {} };

/** ownerPublicKeyHex → 容器在 localStorage 里的 key。 */
export function storageKeyForOwner(ownerPublicKeyHex: string): string {
  return `${STORAGE_KEY_PREFIX}${ownerPublicKeyHex}`;
}

/** 读取某 owner 名下整个空间；schema 不合法记录会被丢弃。 */
export function loadOwnerSpace(ownerPublicKeyHex: string): StoredNotesSpace {
  const raw = readStorage(storageKeyForOwner(ownerPublicKeyHex));
  if (raw === null) return { ...EMPTY_SPACE };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...EMPTY_SPACE };
    const obj = parsed as Record<string, unknown>;
    const foldersRaw =
      obj.folders && typeof obj.folders === "object" && !Array.isArray(obj.folders)
        ? (obj.folders as Record<string, unknown>)
        : {};
    const notesRaw =
      obj.notes && typeof obj.notes === "object" && !Array.isArray(obj.notes)
        ? (obj.notes as Record<string, unknown>)
        : {};
    const folders: Record<string, StoredFolderRecord> = {};
    for (const [k, v] of Object.entries(foldersRaw)) {
      if (isStoredFolderRecord(v)) folders[k] = v;
    }
    const notes: Record<string, StoredNoteRecord> = {};
    for (const [k, v] of Object.entries(notesRaw)) {
      if (isStoredNoteRecord(v)) notes[k] = v;
    }
    return { v: 1, folders, notes };
  } catch {
    return { ...EMPTY_SPACE };
  }
}

/** 写入某 owner 名下整个空间。 */
export function saveOwnerSpace(ownerPublicKeyHex: string, space: StoredNotesSpace): void {
  writeStorage(storageKeyForOwner(ownerPublicKeyHex), JSON.stringify(space));
}

/**
 * 删除某 owner 名下整个本地 notes 空间（密文 + 明文 metadata + folder 树）。
 *
 * 设计缘由（施工单 2026-06-26 delete-current-owner-space 第 3.3 / 4 章）：
 *   - 删除真值 = `removeStorage(storageKeyForOwner(ownerPublicKeyHex))`。
 *   - 不递归遍历 folder / note；不做逐条清理（避免部分成功态）。
 *   - 底层 key 本来不存在时视为成功（用户最终目标 = 当前 owner 本地不再有数据）。
 *   - 不抛异常；失败返回 false，由调用方决定是否退回 LockScreen。
 */
export function deleteOwnerSpace(ownerPublicKeyHex: string): boolean {
  return removeStorage(storageKeyForOwner(ownerPublicKeyHex));
}

/* ============== folder CRUD ============== */

export interface CreateFolderInput {
  parentId: string | null;
  title: string;
  now?: number;
}

/**
 * 在指定父目录下新建一个 folder。
 * - 父目录 `parentId === null` 表示根目录；
 * - 同目录 title 冲突时返回 `null`，由调用方阻断。
 */
export function createFolder(space: StoredNotesSpace, input: CreateFolderInput): {
  next: StoredNotesSpace;
  folder: StoredFolderRecord;
} | null {
  const title = input.title.trim();
  if (title.length === 0) return null;
  if (isFolderTitleConflict(space.folders, input.parentId, title, null)) return null;
  const now = input.now ?? Date.now();
  const id = makeRecordId();
  const folder: StoredFolderRecord = {
    v: 1,
    id,
    parentId: input.parentId,
    title,
    createdAt: now,
    updatedAt: now
  };
  return {
    next: { v: 1, folders: { ...space.folders, [id]: folder }, notes: space.notes },
    folder
  };
}

/** 删除一个 folder；调用前必须确认 `isFolderEmpty` 为 true。 */
export function deleteFolder(space: StoredNotesSpace, folderId: string): StoredNotesSpace {
  if (!space.folders[folderId]) return space;
  const nextFolders = { ...space.folders };
  delete nextFolders[folderId];
  return { v: 1, folders: nextFolders, notes: space.notes };
}

/** 重命名 folder；同目录冲突时返回 null。 */
export function renameFolder(
  space: StoredNotesSpace,
  folderId: string,
  title: string
): { next: StoredNotesSpace; folder: StoredFolderRecord } | null {
  const target = space.folders[folderId];
  if (!target) return null;
  const trimmed = title.trim();
  if (trimmed.length === 0) return null;
  if (isFolderTitleConflict(space.folders, target.parentId, trimmed, folderId)) return null;
  const updated: StoredFolderRecord = { ...target, title: trimmed, updatedAt: Date.now() };
  return {
    next: { v: 1, folders: { ...space.folders, [folderId]: updated }, notes: space.notes },
    folder: updated
  };
}

/**
 * 移动 folder 到新父目录。
 * - 不允许移到自己；
 * - 不允许移到自己后代（由 caller 在 structural 层阻断，本函数再做一次保险）；
 * - 同目录 title 冲突阻断。
 */
export function moveFolder(
  space: StoredNotesSpace,
  folderId: string,
  newParentId: string | null
): StoredNotesSpace | null {
  const target = space.folders[folderId];
  if (!target) return null;
  if (newParentId === folderId) return null;
  if (newParentId !== null) {
    // 后代校验：newParentId 不能是 folderId 的后代。
    let cur: string | null = newParentId;
    while (cur !== null) {
      if (cur === folderId) return null;
      const next: string | null = space.folders[cur]?.parentId ?? null;
      if (next === cur) break;
      cur = next;
    }
  }
  if (isFolderTitleConflict(space.folders, newParentId, target.title, folderId)) return null;
  const updated: StoredFolderRecord = { ...target, parentId: newParentId, updatedAt: Date.now() };
  return { v: 1, folders: { ...space.folders, [folderId]: updated }, notes: space.notes };
}

/* ============== note CRUD ============== */

/**
 * 直接以完整 record 写入 / 替换一条 note。用于"保存时加密完成"的更新。
 *
 * 设计缘由（硬切换硬约束）：这里**不**提供"先写空密文占位 record"的入口。
 * 新建 note 只能走 App 层的 `pendingDrafts`（纯内存），第一次成功加密保存
 * 之后才调用 `putNote` 进入 space / localStorage。
 * —— 任何"先占位、后补密文"的实现都会重新违背"密文是真值"边界。
 */
export function putNote(space: StoredNotesSpace, note: StoredNoteRecord): StoredNotesSpace {
  return { v: 1, folders: space.folders, notes: { ...space.notes, [note.id]: note } };
}

export function getNote(space: StoredNotesSpace, noteId: string): StoredNoteRecord | null {
  return space.notes[noteId] ?? null;
}

export function getFolder(space: StoredNotesSpace, folderId: string): StoredFolderRecord | null {
  return space.folders[folderId] ?? null;
}

/** 删除 note。 */
export function deleteNote(space: StoredNotesSpace, noteId: string): StoredNotesSpace {
  if (!space.notes[noteId]) return space;
  const next = { ...space.notes };
  delete next[noteId];
  return { v: 1, folders: space.folders, notes: next };
}

/**
 * 移动 note 到新 folderId。
 * - 同目录 title 冲突阻断；
 * - noteId 必须存在。
 */
export function moveNote(
  space: StoredNotesSpace,
  noteId: string,
  newFolderId: string | null
): StoredNotesSpace | null {
  const target = space.notes[noteId];
  if (!target) return null;
  if (isNoteTitleConflict(space.notes, newFolderId, target.title, noteId)) return null;
  const updated: StoredNoteRecord = { ...target, folderId: newFolderId, updatedAt: Date.now() };
  return { v: 1, folders: space.folders, notes: { ...space.notes, [noteId]: updated } };
}

/* ============== 冲突 / 空判定 ============== */

/**
 * 同父目录下是否存在同名 folder。
 * - `excludeFolderId` 用于重命名 / 移动时排除自己。
 */
export function isFolderTitleConflict(
  folders: Record<string, StoredFolderRecord>,
  parentId: string | null,
  title: string,
  excludeFolderId: string | null
): boolean {
  const trimmed = title.trim();
  for (const f of Object.values(folders)) {
    if (excludeFolderId !== null && f.id === excludeFolderId) continue;
    if (f.parentId !== parentId) continue;
    if (f.title.trim() === trimmed) return true;
  }
  return false;
}

/**
 * 同目录下是否存在同名 note。
 * - `excludeNoteId` 用于重命名 / 移动时排除自己。
 */
export function isNoteTitleConflict(
  notes: Record<string, StoredNoteRecord>,
  folderId: string | null,
  title: string,
  excludeNoteId: string | null
): boolean {
  const trimmed = title.trim();
  for (const n of Object.values(notes)) {
    if (excludeNoteId !== null && n.id === excludeNoteId) continue;
    if (n.folderId !== folderId) continue;
    if (n.title.trim() === trimmed) return true;
  }
  return false;
}

/**
 * folder 是否为空（无子 folder 也无子 note）。
 * 非空时**必须**阻断删除——施工单硬定义：不递归强删，不自动搬迁。
 */
export function isFolderEmpty(space: StoredNotesSpace, folderId: string): boolean {
  for (const f of Object.values(space.folders)) {
    if (f.parentId === folderId) return false;
  }
  for (const n of Object.values(space.notes)) {
    if (n.folderId === folderId) return false;
  }
  return true;
}

/* ============== tag 派生（明文） ============== */

/**
 * 列出当前 owner 下的所有 tag（去重、转小写）。
 * tag 是明文，可本地聚合——**不**需要解密。
 */
export function listAllTags(notes: Record<string, StoredNoteRecord>): string[] {
  const set = new Set<string>();
  for (const record of Object.values(notes)) {
    for (const tag of record.tags) {
      set.add(tag.toLowerCase());
    }
  }
  return [...set].sort();
}

/** 按 tag 过滤命中的 note id 集合。 */
export function findNoteIdsByTag(notes: Record<string, StoredNoteRecord>, tag: string): Set<string> {
  const needle = tag.trim().toLowerCase();
  const out = new Set<string>();
  if (needle.length === 0) return out;
  for (const [id, record] of Object.entries(notes)) {
    if (record.tags.some((t) => t.toLowerCase() === needle)) {
      out.add(id);
    }
  }
  return out;
}

/* ============== 同目录可用名（自动补编号） ============== */

/**
 * 在同一父目录下，从已存在的同类型 title 集合里挑出第一个可用名。
 * 用法：新建 note / 新建 folder 时若用户提交值重名，则走 `findAvailableName`。
 *
 * 规则：
 *   - `base` 未被占用 → 直接返回 `base`；
 *   - 否则按 `base 2`、`base 3` ... 递增，直到找到未被占用的名字；
 *   - 比较时 `trim` 后精确相等（不区分大小写，不归一化），
 *     占用集合由调用方传入，不在这一层做持久层 / 内存态合并判断。
 *
 * 设计缘由（施工单 2026-06-26 save-tag-folder-ux 第 4.4 / 4.5 / 6.10 章）：
 *   - 自动补编号只用于"创建"，**不**用于"重命名"——重命名调用方必须自己做冲突阻断。
 *   - 这一层不读持久层，由 App 合并 `space.notes + pendingDrafts` 后再传入。
 */
export function findAvailableName(base: string, takenTitles: Iterable<string>): string {
  const trimmed = base.trim();
  if (trimmed.length === 0) return trimmed;
  const taken = new Set<string>();
  for (const t of takenTitles) {
    taken.add(t.trim());
  }
  if (!taken.has(trimmed)) return trimmed;
  let n = 2;
  // 防御性上限：超过 10000 次直接放弃；正常不会触发。
  while (n < 10000) {
    const candidate = `${trimmed} ${n}`;
    if (!taken.has(candidate)) return candidate;
    n += 1;
  }
  return `${trimmed} ${Date.now()}`;
}

/* ============== id 生成 ============== */

function makeRecordId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/* ============== localStorage 适配 ============== */

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

/**
 * 删除指定 storage key；不抛异常。
 *
 * 设计缘由（施工单 2026-06-26 delete-current-owner-space 第 7.1 节）：
 *   - 不抛异常到上层；上层只关心"成功 / 失败"布尔值，决定是否清空工作区。
 *   - 底层错误必须 `console.error`，但不能阻塞 UI 给明确失败提示。
 *   - key 本来就不存在时仍返回 true，与"目标已达成"语义一致。
 */
export function removeStorage(key: string): boolean {
  try {
    globalThis.localStorage?.removeItem(key);
    return true;
  } catch (err) {
    console.error("[notes-demo] failed to remove storage", err);
    return false;
  }
}