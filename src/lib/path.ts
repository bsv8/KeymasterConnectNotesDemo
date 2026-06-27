// src/lib/path.ts
// 显式 folder/note 树构建 + parent/child 关系推导 + 拖拽合法性判断。
//
// 设计缘由（施工单第 4 / 8 / 9 章）：
//   - folder / note 都是显式实体；树由 `parentId / folderId` 派生，不再走 path 真值。
//   - 根目录是虚拟节点：用常量 `ROOT_ID` 表达，不落库；其 `parentId` 视为 `null`。
//   - 同目录下不允许重名（folder ↔ folder，note ↔ note）；本文件负责"是否后代 /
//     是否合法 drop target"的纯函数判断，冲突由 storage 层阻断。

import type { StoredFolderRecord, StoredNoteRecord } from "./notes";

/** 根目录虚拟节点 id。外部一致引用此常量，避免散落魔数。 */
export const ROOT_ID: null = null;

/* ============== 树节点 ============== */

export interface TreeFolderNode {
  kind: "folder";
  id: string;
  title: string;
  parentId: string | null;
  folders: TreeFolderNode[];
  notes: TreeNoteNode[];
}

export interface TreeNoteNode {
  kind: "note";
  id: string;
  title: string;
  folderId: string | null;
}

export interface TreeRootNode {
  kind: "root";
  id: null;
  folders: TreeFolderNode[];
  notes: TreeNoteNode[];
}

export type TreeNode = TreeFolderNode | TreeNoteNode | TreeRootNode;

/* ============== 树构建 ============== */

/**
 * 由 folder / note 实体构建完整的 tree。
 * - 同父目录下 folder / note 都按 title 字典序排序；
 * - 不存在的父 id 视为根目录下的孤儿（兜底），保证不丢节点。
 */
export function buildTree(
  folders: Record<string, StoredFolderRecord>,
  notes: Record<string, StoredNoteRecord>
): TreeRootNode {
  const folderById = new Map<string, TreeFolderNode>();
  for (const f of Object.values(folders)) {
    folderById.set(f.id, {
      kind: "folder",
      id: f.id,
      title: f.title,
      parentId: f.parentId,
      folders: [],
      notes: []
    });
  }
  const root: TreeRootNode = { kind: "root", id: null, folders: [], notes: [] };
  const attach = (node: TreeFolderNode) => {
    const parent = node.parentId === null ? null : folderById.get(node.parentId);
    if (parent) {
      parent.folders.push(node);
    } else {
      root.folders.push(node);
    }
  };
  for (const node of folderById.values()) attach(node);

  // 同 parentId 下，folder / note 各按 title 排序后挂载。
  const notesByParent = new Map<string | null, TreeNoteNode[]>();
  for (const n of Object.values(notes)) {
    const node: TreeNoteNode = {
      kind: "note",
      id: n.id,
      title: n.title,
      folderId: n.folderId
    };
    const list = notesByParent.get(n.folderId) ?? [];
    list.push(node);
    notesByParent.set(n.folderId, list);
  }
  const consumeNotes = (parentId: string | null, target: TreeFolderNode | TreeRootNode) => {
    const list = notesByParent.get(parentId);
    if (!list) return;
    list.sort((a, b) => a.title.localeCompare(b.title));
    target.notes.push(...list);
    notesByParent.delete(parentId);
  };
  const sortFolders = (n: TreeFolderNode) => {
    n.folders.sort((a, b) => a.title.localeCompare(b.title));
    for (const c of n.folders) sortFolders(c);
  };
  const sortRootFolders = () => {
    root.folders.sort((a, b) => a.title.localeCompare(b.title));
    for (const c of root.folders) sortFolders(c);
  };
  // 顺序：先 root，再递归 children。
  consumeNotes(null, root);
  for (const f of root.folders) {
    consumeNotes(f.id, f);
  }
  sortRootFolders();
  for (const f of root.folders) {
    consumeNotes(f.id, f);
    sortFolders(f);
  }
  // 兜底：残留 notes 视为根下。
  if (notesByParent.size > 0) {
    const leftover: TreeNoteNode[] = [];
    for (const list of notesByParent.values()) leftover.push(...list);
    leftover.sort((a, b) => a.title.localeCompare(b.title));
    root.notes.push(...leftover);
  }
  return root;
}

/* ============== 后代判断 ============== */

/**
 * 判定 `descendantId` 是否为 `ancestorId` 的后代（含自己）。folderId 为 null 表示根。
 * 用途：拖拽 folder 到自己 / 自己后代时阻断。
 */
export function isFolderDescendant(
  folders: Record<string, StoredFolderRecord>,
  ancestorId: string | null,
  descendantId: string
): boolean {
  if (ancestorId === null) return false;
  if (ancestorId === descendantId) return true;
  let current: string | null = folders[descendantId]?.parentId ?? null;
  while (current !== null) {
    if (current === ancestorId) return true;
    const next: string | null = folders[current]?.parentId ?? null;
    if (next === current) break;
    current = next;
  }
  return false;
}

/* ============== 拖拽合法性 ============== */

export type DragSourceKind = "folder" | "note";

export interface DragLegalityCheck {
  /** 是否允许落在这个目标上。 */
  ok: boolean;
  /** 阻断时的具体原因。 */
  reason?:
    | "drop_to_note"
    | "drop_to_self"
    | "drop_to_descendant"
    | "drop_to_missing_source";
}

/**
 * 判定从 `source` 拖到 `target` 是否合法（仅 structural，不做重名检查）。
 * - note 拖到 folder / root：合法；
 * - note 拖到 note：不合法（必须落到 folder 或 root）；
 * - folder 拖到 folder / root：合法，但**不能**是自己 / 自己后代；
 * - root 是合法落点：表示"移动到根目录下"。
 */
export function checkDragLegality(
  folders: Record<string, StoredFolderRecord>,
  source: { kind: DragSourceKind; id: string },
  target: { kind: "folder" | "note" | "root"; id: string | null }
): DragLegalityCheck {
  if (source.kind === "note") {
    if (target.kind === "note") return { ok: false, reason: "drop_to_note" };
    return { ok: true };
  }
  // folder
  if (!folders[source.id]) return { ok: false, reason: "drop_to_missing_source" };
  if (target.kind === "note") return { ok: false, reason: "drop_to_note" };
  if (target.kind === "folder") {
    if (target.id === null) return { ok: false, reason: "drop_to_missing_source" };
    if (target.id === source.id) return { ok: false, reason: "drop_to_self" };
    if (isFolderDescendant(folders, source.id, target.id)) {
      return { ok: false, reason: "drop_to_descendant" };
    }
  }
  return { ok: true };
}

/** 把 `checkDragLegality` 的 reason 转中文文案。 */
export function describeDragLegalityReason(reason: NonNullable<DragLegalityCheck["reason"]>): string {
  switch (reason) {
    case "drop_to_note":
      return "不能把内容拖到 note 上。";
    case "drop_to_self":
      return "不能把文件夹拖到自己内部。";
    case "drop_to_descendant":
      return "不能把文件夹拖到自己的后代下面。";
    case "drop_to_missing_source":
      return "找不到要拖动的源。";
  }
}

/* ============== 节点查找 / 列表 ============== */

/** 取得 folder record 在树上的"显示路径"（不含自己）。 */
export function folderAncestorChain(
  folders: Record<string, StoredFolderRecord>,
  folderId: string
): StoredFolderRecord[] {
  const out: StoredFolderRecord[] = [];
  let cur: string | null = folderId;
  while (cur !== null) {
    const node: StoredFolderRecord | undefined = folders[cur];
    if (!node) break;
    out.unshift(node);
    cur = node.parentId;
  }
  return out;
}

/**
 * 取得某 folderId 的"祖先 folderId 链"（不含自己，从根到自己）。
 * 找不到的 parentId 在链上视为"链路中断"——遇到未记录的 id 立即停止，
 * 不抛错，避免脏数据把整条链炸掉。
 *
 * 用途：点击搜索结果后，要把"祖先路径"在文件树上全部展开。
 */
export function ancestorFolderIds(
  folders: Record<string, StoredFolderRecord>,
  folderId: string | null
): string[] {
  if (folderId === null) return [];
  const out: string[] = [];
  let cur: string | null = folderId;
  const seen = new Set<string>();
  while (cur !== null) {
    if (seen.has(cur)) break; // 防御：循环 parentId 自指
    seen.add(cur);
    out.unshift(cur);
    const node: StoredFolderRecord | undefined = folders[cur];
    if (!node) break;
    cur = node.parentId;
  }
  return out;
}

/**
 * 把 folderId 链转换成"显示 path"：从根到当前 folder 拼接 title。
 * 找不到的 folderId 静默跳过对应段；根目录下的 note → "根目录"。
 * 段与段之间用 " / " 分隔。
 */
export function folderPathLabel(
  folders: Record<string, StoredFolderRecord>,
  folderId: string | null
): string {
  if (folderId === null) return "根目录";
  const chain = folderAncestorChain(folders, folderId);
  if (chain.length === 0) return "根目录";
  return ["根目录", ...chain.map((f) => f.title || "未命名文件夹")].join(" / ");
}

/**
 * 按树自然顺序遍历所有 note（根 → 递归 folder），收集命中的 note。
 * 用途：搜索结果排序（与用户左侧树看到的顺序一致）。
 *
 * 设计缘由（施工单 2026-06-27 note-search-results-and-tree-expand-persistence
 *          第 4.4 / 7.4 章）：
 *   - 不引入"相关性评分"系统，不做高亮 / 模糊排序；
 *   - 树显示顺序 = 搜索结果顺序，用户感知"一致"。
 */
export function collectNotesInTreeOrder(
  tree: TreeRootNode
): TreeNoteNode[] {
  const out: TreeNoteNode[] = [];
  const walkFolder = (f: TreeFolderNode) => {
    for (const child of f.folders) walkFolder(child);
    for (const n of f.notes) out.push(n);
  };
  for (const f of tree.folders) walkFolder(f);
  for (const n of tree.notes) out.push(n);
  return out;
}

/** 是否根目录（含未选中场景）。 */
export function isRootId(id: string | null): id is null {
  return id === null;
}

/** 把任意 id 归一为"非 null folder id"，空字符串视为 null。 */
export function normalizeFolderId(id: string | null | undefined): string | null {
  if (typeof id !== "string") return null;
  if (id.length === 0) return null;
  return id;
}