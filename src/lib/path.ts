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
 * - folder 树先按 `parentId` 挂好；
 * - note 逐条**直接**挂到目标 folder（或根目录），不再做"分层消费"；
 * - 同父目录下 folder / note 都按 title 字典序排序；
 * - 找不到 `folderId` 对应 folder 的 note 视为"根目录孤儿"，兜底挂到 `root.notes`。
 *
 * 设计缘由（施工单 2026-06-27 004-tree-note-parent-attach-fix 第 5 / 6 章）：
 *   - 旧实现用 `notesByParent + consumeNotes` 多次消费，会漏掉深层 folder 的
 *     note，导致它们全部回流到 `root.notes`，看起来"所有 note 都堆在根目录"；
 *   - 改"逐条 note 直接挂载"后，挂载点只看 `note.folderId` 一个真值，不再依
 *     赖"消费了几层"这种隐含状态，根目录直属 note 与孤儿 note 的语义也更清
 *     晰。
 */
export function buildTree(
  folders: Record<string, StoredFolderRecord>,
  notes: Record<string, StoredNoteRecord>
): TreeRootNode {
  // 第一步：创建所有 folder 节点。
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

  // 第二步：把 folder 挂成完整树。
  const root: TreeRootNode = { kind: "root", id: null, folders: [], notes: [] };
  for (const node of folderById.values()) {
    const parent = node.parentId === null ? null : folderById.get(node.parentId);
    if (parent) {
      parent.folders.push(node);
    } else {
      root.folders.push(node);
    }
  }

  // 第三步：逐条 note 直接挂到目标 folder / 根目录。
  //   - folderId === null              → 根目录直属 note
  //   - folderId 命中 folderById       → 对应 folder 的 notes
  //   - folderId 找不到                → 根目录孤儿（兜底，保证不丢节点）
  for (const n of Object.values(notes)) {
    const node: TreeNoteNode = {
      kind: "note",
      id: n.id,
      title: n.title,
      folderId: n.folderId
    };
    const target =
      n.folderId === null ? null : folderById.get(n.folderId) ?? null;
    if (target) {
      target.notes.push(node);
    } else {
      root.notes.push(node);
    }
  }

  // 第四步：递归排序——folder 与 note 在各自层级内按 title 字典序排好。
  const sortFolderTree = (n: TreeFolderNode) => {
    n.folders.sort((a, b) => a.title.localeCompare(b.title));
    n.notes.sort((a, b) => a.title.localeCompare(b.title));
    for (const c of n.folders) sortFolderTree(c);
  };
  root.folders.sort((a, b) => a.title.localeCompare(b.title));
  root.notes.sort((a, b) => a.title.localeCompare(b.title));
  for (const c of root.folders) sortFolderTree(c);

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

/**
 * 拖拽阻断原因码（**稳定真值**，不带语言）。
 *
 * 设计缘由（施工单 2026-06-27 005-i18n-header-language-switch 5.5 / 8 章边界）：
 *   - lib 层**绝不**返回给用户看的中文 / 英文 / 日文句子；
 *   - UI 层按 `reason` code 调用 `t(...)` 翻译；
 *   - 这与"协议 error code 保持稳定、只翻译说明文案"完全同构。
 */
export type DragLegalityFailureCode =
  | "drop_to_note"
  | "drop_to_self"
  | "drop_to_descendant"
  | "drop_to_missing_source";

export interface DragLegalityCheck {
  /** 是否允许落在这个目标上。 */
  ok: boolean;
  /** 阻断时的具体原因 code（**非本地化**）；UI 层按此翻译。 */
  reason?: DragLegalityFailureCode;
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
 * 文件夹路径的"结构化"片段。
 *
 * 设计缘由（施工单 2026-06-27 005-i18n-header-language-switch 5.5 章）：
 *   - lib 层**只**返回结构化数据；
 *   - UI 层拿到 segments 后再决定：根目录用 `t("sidebar.root.name")`，
 *     folder 用 `record.title` 或 fallback `t("sidebar.placeholder.folder")`。
 *   - 这样切语言后，搜索结果第二行的 path 不会保留任何中文。
 */
export type FolderPathSegment =
  | { kind: "root" }
  | { kind: "folder"; id: string; title: string };

/**
 * 把 folderId 链转换成"结构化 path 片段"：首段永远是根目录；后续段从根到当前 folder。
 * 找不到的 folderId 静默跳过对应段；空 chain（folderId === null 或脏数据）退化为只剩根。
 */
export function folderPathSegments(
  folders: Record<string, StoredFolderRecord>,
  folderId: string | null
): FolderPathSegment[] {
  if (folderId === null) return [{ kind: "root" }];
  const chain = folderAncestorChain(folders, folderId);
  if (chain.length === 0) return [{ kind: "root" }];
  return [
    { kind: "root" as const },
    ...chain.map<FolderPathSegment>((f) => ({
      kind: "folder" as const,
      id: f.id,
      title: f.title
    }))
  ];
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