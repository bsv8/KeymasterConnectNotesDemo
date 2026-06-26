// src/components/NotesSidebar.tsx
// 左侧树形笔记导航 + 搜索 + tag 筛选。
//
// 设计缘由：
//   - 树结构**完全由 `buildNoteTree(paths)` 派生**（见 `path.ts`）；
//     组件不做二次结构假设，直接递归渲染。
//   - 搜索按 path segments **和** title 命中（OR）；title 由 App 注入。
//   - tag 过滤由 App 侧按明文 tag 预先过滤 `paths`；组件只接收命中子集。
//   - 选中态由 App 持有；组件只发出 `onSelect(path)`。

import { useMemo, type ReactNode } from "react";
import { buildNoteTree, splitNotePath, treeContainsVisibleLeaf, type NoteTreeNode } from "../lib/path";

export interface NotesSidebarProps {
  paths: string[];
  /** path → title，用于"按 title 搜索"语义。 */
  titlesByPath: Record<string, string>;
  selectedPath: string | null;
  searchQuery: string;
  activeTag: string | null;
  onSearchQueryChange: (value: string) => void;
  onActiveTagChange: (value: string | null) => void;
  onSelect: (path: string) => void;
  onCreate: () => void;
  allTags: string[];
  ownerLabel: string;
  disabled?: boolean;
}

export function NotesSidebar(props: NotesSidebarProps) {
  // 真实树：基于完整 paths（含 tag 过滤后的子集）建立。
  // 注意：tag 过滤已经发生在 App 侧，这里 `paths` 是命中子集。
  // 我们仍然用 buildNoteTree 把它们建成完整树结构。
  const tree = useMemo(() => buildNoteTree(props.paths), [props.paths]);

  // 搜索再叠加一层过滤：仅在 path 或 title 上命中。
  const visible = useMemo(
    () => filterBySearch(props.paths, props.titlesByPath, props.searchQuery),
    [props.paths, props.titlesByPath, props.searchQuery]
  );
  const visibleSet = useMemo(() => new Set(visible), [visible]);
  const rendered = useMemo(
    () => renderNode(tree, visibleSet, props.selectedPath, props.onSelect, props.disabled ?? false, 0),
    [tree, visibleSet, props.selectedPath, props.onSelect, props.disabled]
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title">
          <span className="sidebar-eyebrow">Workspace</span>
          <strong>{props.ownerLabel || "未登录"}</strong>
        </div>
        <button
          type="button"
          className="sidebar-new"
          onClick={props.onCreate}
          disabled={props.disabled || !props.ownerLabel}
          title="新建 note"
        >
          + 新建
        </button>
      </div>

      <div className="sidebar-search">
        <input
          type="text"
          placeholder="按 path 或 title 搜索"
          value={props.searchQuery}
          onChange={(e) => props.onSearchQueryChange(e.target.value)}
          disabled={props.disabled}
        />
      </div>

      <div className="sidebar-tags">
        {props.allTags.length === 0 ? (
          <span className="sidebar-tag sidebar-tag-empty">无 tag</span>
        ) : (
          <>
            <button
              type="button"
              className={`sidebar-tag ${props.activeTag === null ? "is-active" : ""}`}
              onClick={() => props.onActiveTagChange(null)}
              disabled={props.disabled}
            >
              全部
            </button>
            {props.allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`sidebar-tag ${props.activeTag === tag ? "is-active" : ""}`}
                onClick={() => props.onActiveTagChange(tag === props.activeTag ? null : tag)}
                disabled={props.disabled}
              >
                #{tag}
              </button>
            ))}
          </>
        )}
      </div>

      <div className="sidebar-tree" role="tree">
        {rendered.length === 0 ? (
          <div className="sidebar-empty">
            {props.paths.length === 0 ? "尚未创建任何 note" : "没有匹配的 note"}
          </div>
        ) : (
          rendered
        )}
      </div>
    </aside>
  );
}

/**
 * 在 App 传入的 `paths` 子集上再做一次"按 search 命中"过滤。
 * - 命中 path 字符串；
 * - 或命中 path 最后一段（用户友好的"slug 提示"）；
 * - 或命中 title（不区分大小写）。
 */
function filterBySearch(
  paths: string[],
  titlesByPath: Record<string, string>,
  search: string
): string[] {
  const q = search.trim().toLowerCase();
  if (q.length === 0) return paths;
  return paths.filter((path) => {
    if (path.toLowerCase().includes(q)) return true;
    const segs = splitNotePath(path);
    const last = segs[segs.length - 1] ?? "";
    if (last.toLowerCase().includes(q)) return true;
    const title = titlesByPath[path] ?? "";
    if (title && title.toLowerCase().includes(q)) return true;
    return false;
  });
}

/**
 * 递归渲染。
 *   - 跳过 root（path === "/"）；
 *   - 叶子节点 path 在 `visible` 内才显示；
 *   - 目录节点只要子树里有可见叶子，也显示。
 */
function renderNode(
  node: NoteTreeNode,
  visible: Set<string>,
  selectedPath: string | null,
  onSelect: (path: string) => void,
  disabled: boolean,
  depth: number
): ReactNode[] {
  const out: ReactNode[] = [];
  const visit = (n: NoteTreeNode, d: number) => {
    if (n.path === "/") {
      for (const child of n.children) visit(child, d);
      return;
    }
    const isLeaf = n.children.length === 0;
    const isSelected = selectedPath === n.path;
    const visibleNow = isLeaf ? visible.has(n.path) : treeContainsVisibleLeaf(n, visible);
    if (!visibleNow) return;
    out.push(
      <button
        key={n.path}
        type="button"
        className={`tree-item ${isSelected ? "is-selected" : ""} ${isLeaf ? "is-leaf" : "is-folder"}`}
        style={{ paddingLeft: `${12 + d * 14}px` }}
        onClick={() => {
          if (disabled) return;
          if (isLeaf) onSelect(n.path);
        }}
        disabled={disabled || !isLeaf}
        title={n.path}
      >
        <span className="tree-item__icon" aria-hidden="true">
          {isLeaf ? "·" : "▾"}
        </span>
        <span className="tree-item__label">{n.name}</span>
        <span className="tree-item__path">{n.path}</span>
      </button>
    );
    for (const child of n.children) visit(child, d + 1);
  };
  visit(node, depth);
  return out;
}
