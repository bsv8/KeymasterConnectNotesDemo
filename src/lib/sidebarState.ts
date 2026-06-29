// src/lib/sidebarState.ts
// sidebar 展开状态（folder 哪些处于展开）的 localStorage 适配。
//
// 设计缘由（施工单 2026-06-27 note-search-results-and-tree-expand-persistence
//          第 4.6 / 4.7 / 7.5 章）：
//   - sidebar 展开偏好是 **UI 偏好**，**不**属于 `StoredNotesSpace` 业务真值：
//     folder 是否展开 ≠ folder 的标题 / 父目录 / 创建时间，把它写进
//     `StoredNotesSpace` 会污染业务 schema。
//   - 必须**按 owner 分区**——不同 publicKeyHex 的用户各自保留自己的偏好。
//   - 单独拆一个轻量 helper，边界清楚：本文件只做"读 / 写 / 过滤"，
//     **不**做 folder / note 业务 CRUD，**不**做 React 状态管理。
//   - 非法值（坏 JSON、字符串、不是数组、元素不是 string 等）一律静默丢弃。
//   - 已不存在的 folderId 在加载时静默丢弃——避免 folder 删除后留下垃圾数据。

/** sidebar 展开状态 storage key 前缀。 */
const STORAGE_KEY_PREFIX = "justnote:sidebar:";

/** 构造 owner 级别 storage key。 */
export function sidebarStateKeyForOwner(ownerPublicKeyHex: string): string {
  return `${STORAGE_KEY_PREFIX}${ownerPublicKeyHex}`;
}

/**
 * 读取某 owner 的展开 folder id 集合。
 *
 * 行为：
 *   - localStorage 缺失 / 解析失败 / 不是 string[] → 返回 null（"无记录"）；
 *   - 调用方拿到 null 时按策略决定默认（见 `DEFAULT_EXPANDED_BEHAVIOR`）。
 */
export function loadOwnerSidebarState(ownerPublicKeyHex: string): string[] | null {
  const key = sidebarStateKeyForOwner(ownerPublicKeyHex);
  let raw: string | null;
  try {
    raw = globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item === "string" && item.length > 0) {
      out.push(item);
    }
  }
  return out;
}

/**
 * 写入某 owner 的展开 folder id 集合。
 * 失败时 `console.error` 但不抛——UI 偏好绝不该影响主流程。
 */
export function saveOwnerSidebarState(ownerPublicKeyHex: string, folderIds: string[]): void {
  const key = sidebarStateKeyForOwner(ownerPublicKeyHex);
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(folderIds));
  } catch (err) {
    console.error("[justnote] failed to write sidebar state", err);
  }
}
