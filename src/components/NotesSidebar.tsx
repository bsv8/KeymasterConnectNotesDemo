// src/components/NotesSidebar.tsx
// 左侧 folder/note 混合树 + 选中 + 右键菜单 + 拖拽。
//
// 设计缘由（施工单第 8-10 章 + 2026-06-26 save-switch-current-editor-state +
//          2026-06-27 notion-document-toolbar-and-mobile-sidebar
//          第 4.6 / 4.7 / 5.3 / 8.3 章）：
//   - 树结构**完全由 `buildTree(folders, notes)` 派生**；组件不做二次假设。
//   - folder / note 节点都是显式实体，**不**是"path 字符串"。
//   - 右键菜单：folder 显示"新建笔记 / 新建文件夹 / 重命名 / 删除"；note 显示"重命名 / 删除"。
//   - 拖拽：folder/note 都可拖到 folder 或根目录上；语义统一为"move"。
//   - App 持有所有 mutation 真值；组件只触发 `onFolderAction / onNoteAction` 等回调。
//   - "当前未保存新 note"通过 `ephemeralNoteId` 注入；选中态跟 `selection` 走；
//     视觉上打 `is-ephemeral` 标记，区别于已落库 note。
//   - 硬切换后：
//       - **不再**渲染 sidebar 内的移动模式横条（已挪到 App 的 banner）；
//       - **不再**接受 `onMoveCancel`——cancel 由 banner 处理；
//       - 仍然在 tree 节点上打 `is-move-source` / `is-move-mode` 视觉态；
//       - 当前选中 folder 时，根目录上方渲染"简化 folder 工具条"；
//       - 当前选中 note / root 时，**不**显示该工具条；
//       - 不再接受 `moveState` 用于显示内联横条，仅用于节点高亮。

import { useEffect, useMemo, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { buildTree, type TreeFolderNode, type TreeNoteNode, type TreeRootNode } from "../lib/path";
import type { StoredNotesSpace } from "../lib/storage";
import type { StoredFolderRecord } from "../lib/notes";

export type SelectionKind = "folder" | "note" | "root";
export interface SidebarSelection {
  kind: SelectionKind;
  /** folder/note 时是 id；root 时为 null。 */
  id: string | null;
}

export type SidebarContextMenuState =
  | {
      kind: "folder";
      folderId: string;
      x: number;
      y: number;
    }
  | {
      kind: "note";
      noteId: string;
      x: number;
      y: number;
    }
  | {
      kind: "root";
      x: number;
      y: number;
    };

export type FolderAction =
  | { type: "create-note"; folderId: string | null }
  | { type: "create-folder"; folderId: string | null }
  | { type: "rename"; folderId: string }
  | { type: "delete"; folderId: string }
  | { type: "move-start"; folderId: string };

export type NoteAction =
  | { type: "rename"; noteId: string }
  | { type: "delete"; noteId: string }
  | { type: "move-start"; noteId: string };

export type RootAction = { type: "create-note" } | { type: "create-folder" };

export interface MoveState {
  kind: "folder" | "note";
  id: string;
}

export interface DragState {
  kind: "folder" | "note";
  id: string;
}

export interface DropHoverState {
  kind: "folder" | "root";
  id: string | null;
}

export interface NotesSidebarProps {
  space: StoredNotesSpace;
  /** 搜索 / tag 过滤后剩余的 note id 集合；null 表示"不过滤"。 */
  visibleNoteIds: Set<string> | null;
  /** 当前未保存新 note 的 id（如果有）；用于在树上打"临时"标记。 */
  ephemeralNoteId?: string | null;
  selection: SidebarSelection;
  /**
   * 当前选中的 folder；为 null 时不渲染"简化 folder 工具条"。
   * 设计缘由（施工单 2026-06-27 第 4.6.1 / 4.6.2 章）：仅 folder 选中时显示该工具条；
   * note / root 选中时不显示，避免与 document-toolbar 形成双入口。
   */
  currentFolder: StoredFolderRecord | null;
  searchQuery: string;
  activeTag: string | null;
  contextMenu: SidebarContextMenuState | null;
  dragging: DragState | null;
  dropHover: DropHoverState | null;
  /**
   * 移动模式状态：用于在 tree 节点上打 `is-move-source` / `is-move-mode` 视觉态，
   * 以及在点击目标 folder / root 时改走 `onMoveTarget`。
   * 横条本身已挪到 App 的 banner；cancel 由 banner 按钮处理，本组件**不**再渲染
   * 内联横条，也**不**再接受 `onMoveCancel` 回调。
   */
  moveState: MoveState | null;
  ownerLabel: string;
  disabled?: boolean;
  allTags: string[];
  onSelect: (next: SidebarSelection) => void;
  onCreateNote: () => void;
  onCreateFolder: () => void;
  onFolderAction: (action: FolderAction) => void;
  onNoteAction: (action: NoteAction) => void;
  onRootAction: (action: RootAction) => void;
  onContextMenu: (state: SidebarContextMenuState | null) => void;
  onDragStart: (kind: "folder" | "note", id: string) => void;
  onDragEnd: () => void;
  onDragOverTarget: (target: { kind: "folder" | "root"; id: string | null }) => void;
  onDropOnTarget: (target: { kind: "folder" | "root"; id: string | null }) => void;
  onSearchQueryChange: (value: string) => void;
  onActiveTagChange: (value: string | null) => void;
  /**
   * 移动模式下，用户在 tree 上点击目标 folder / root 时触发；
   * App 负责真正的 move 校验与落地。
   */
  onMoveTarget: (target: { kind: "folder" | "root"; id: string | null }) => void;
}

export function NotesSidebar(props: NotesSidebarProps) {
  const tree = useMemo(
    () => buildTree(props.space.folders, props.space.notes),
    [props.space.folders, props.space.notes]
  );

  const isSelectedFolder = (id: string) =>
    props.selection.kind === "folder" && props.selection.id === id;
  const isSelectedNote = (id: string) =>
    props.selection.kind === "note" && props.selection.id === id;
  const isSelectedRoot = () => props.selection.kind === "root";

  const isDropHoverFolder = (id: string) =>
    props.dropHover?.kind === "folder" && props.dropHover.id === id;
  const isDropHoverRoot = () => props.dropHover?.kind === "root";

  /** note 是否在搜索 / tag 过滤命中集合内。 */
  const isNoteVisible = (id: string) =>
    props.visibleNoteIds === null || props.visibleNoteIds.has(id);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title">
          <span className="sidebar-eyebrow">Notes</span>
          <strong>{props.ownerLabel || "未登录"}</strong>
        </div>
        <div className="sidebar-header__actions">
          <button
            type="button"
            className="sidebar-new"
            onClick={props.onCreateNote}
            disabled={props.disabled || !props.ownerLabel}
            title="在当前选中位置新建 note"
          >
            + note
          </button>
          <button
            type="button"
            className="sidebar-new"
            onClick={props.onCreateFolder}
            disabled={props.disabled || !props.ownerLabel}
            title="在当前选中位置新建文件夹"
          >
            + 文件夹
          </button>
        </div>
      </div>

      <div className="sidebar-search">
        <input
          type="text"
          placeholder="按文件名搜索"
          value={props.searchQuery}
          onChange={(e) => props.onSearchQueryChange(e.target.value)}
          disabled={props.disabled}
        />
      </div>

      <div className="sidebar-tags" role="group" aria-label="tag 过滤">
        <button
          type="button"
          className={`sidebar-tag ${props.activeTag === null ? "is-active" : ""}`}
          onClick={() => props.onActiveTagChange(null)}
          disabled={props.disabled}
        >
          全部
        </button>
        {props.allTags.length === 0 ? (
          <span className="sidebar-tag sidebar-tag-empty">无 tag</span>
        ) : (
          props.allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`sidebar-tag ${props.activeTag === tag ? "is-active" : ""}`}
              onClick={() => props.onActiveTagChange(tag === props.activeTag ? null : tag)}
              disabled={props.disabled}
              title={`仅显示含 #${tag} 的 note`}
            >
              #{tag}
            </button>
          ))
        )}
      </div>

      {/*
        简化 folder 工具条：仅在 selection === folder 时显示在根目录上方。
        设计缘由（施工单 2026-06-27 第 4.6.1 / 4.6.2 / 8.3 章）：
        - 选中 folder → 显示（标题 + updated + 删除）；
        - 选中 note / root → 不显示，避免与 document-toolbar 重复形成双入口；
        - 文档区**不**再放"删除文件夹"，由本工具条承担唯一入口。
      */}
      {props.currentFolder ? (
        <div className="sidebar-folder-toolbar" role="group" aria-label="当前文件夹工具条">
          <div className="sidebar-folder-toolbar__head">
            <span className="sidebar-folder-toolbar__eyebrow">当前文件夹</span>
            <strong className="sidebar-folder-toolbar__title">
              {props.currentFolder.title || "未命名文件夹"}
            </strong>
          </div>
          <div className="sidebar-folder-toolbar__row">
            <span className="sidebar-folder-toolbar__meta">
              updated {new Date(props.currentFolder.updatedAt).toLocaleString()}
            </span>
            <button
              type="button"
              className="secondary-button sidebar-folder-toolbar__delete"
              onClick={() => props.onFolderAction({ type: "delete", folderId: props.currentFolder!.id })}
              disabled={props.disabled}
            >
              删除文件夹
            </button>
          </div>
        </div>
      ) : null}

      <div
        className="sidebar-tree"
        role="tree"
        // 目录框架里**空白区域**的点击 / 右键 = 根目录。
        // 子节点（folder / note）都 stopPropagation，所以这里只在"真空白"上触发。
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          if (props.moveState) {
            props.onMoveTarget({ kind: "root", id: null });
            return;
          }
          props.onSelect({ kind: "root", id: null });
        }}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          e.stopPropagation();
          props.onContextMenu({ kind: "root", x: e.clientX, y: e.clientY });
        }}
      >
        {props.ownerLabel ? (
          <>
            <RootDropZone
              highlighted={isDropHoverRoot()}
              selected={isSelectedRoot()}
              disabled={props.disabled ?? false}
              onDragOver={() => props.onDragOverTarget({ kind: "root", id: null })}
              onDrop={() => props.onDropOnTarget({ kind: "root", id: null })}
              onClick={() => {
                if (props.moveState) {
                  props.onMoveTarget({ kind: "root", id: null });
                  return;
                }
                props.onSelect({ kind: "root", id: null });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                props.onContextMenu({ kind: "root", x: e.clientX, y: e.clientY });
              }}
            >
              <span className="tree-root-label">/</span>
              <span className="tree-root-name">根目录</span>
            </RootDropZone>
            {props.space.folders && Object.keys(props.space.folders).length === 0 && Object.keys(props.space.notes).length === 0 ? (
              <div
                className="sidebar-empty"
                // 让空树提示块也走 root 语义：点击 → 选中 root；右键 → 弹根目录菜单。
                // 这是"目录框架里除文件夹/文件/其他控件外，空白都算 root"的兜底。
                onClick={() => {
                  if (props.moveState) {
                    props.onMoveTarget({ kind: "root", id: null });
                    return;
                  }
                  props.onSelect({ kind: "root", id: null });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  props.onContextMenu({ kind: "root", x: e.clientX, y: e.clientY });
                }}
              >
                尚未创建任何内容
              </div>
            ) : (
              <>
                {tree.folders.map((f) => (
                  <FolderNode
                    key={f.id}
                    node={f}
                    depth={1}
                    selectedFolder={isSelectedFolder(f.id)}
                    selectedNote={isSelectedNote}
                    dropHover={props.dropHover}
                    dragging={props.dragging}
                    disabled={props.disabled ?? false}
                    moveState={props.moveState}
                    isNoteVisible={isNoteVisible}
                    ephemeralNoteId={props.ephemeralNoteId ?? null}
                    onSelect={props.onSelect}
                    onFolderAction={props.onFolderAction}
                    onNoteAction={props.onNoteAction}
                    onContextMenu={props.onContextMenu}
                    onDragStart={props.onDragStart}
                    onDragEnd={props.onDragEnd}
                    onDragOverTarget={props.onDragOverTarget}
                    onDropOnTarget={props.onDropOnTarget}
                    onMoveTarget={props.onMoveTarget}
                  />
                ))}
                {/* 根目录下的孤立 note（folderId === null） */}
                {tree.notes
                  .filter((n) => isNoteVisible(n.id))
                  .map((n) => (
                    <NoteRow
                      key={n.id}
                      node={n}
                      depth={1}
                      selected={isSelectedNote(n.id)}
                      ephemeral={props.ephemeralNoteId === n.id}
                      dragging={props.dragging}
                      disabled={props.disabled ?? false}
                      onSelect={() => props.onSelect({ kind: "note", id: n.id })}
                      onAction={props.onNoteAction}
                      onContextMenu={props.onContextMenu}
                      onDragStart={props.onDragStart}
                      onDragEnd={props.onDragEnd}
                    />
                  ))}
              </>
            )}
          </>
        ) : (
          <div className="sidebar-empty">请先登录</div>
        )}
      </div>

      <ContextMenu
        state={props.contextMenu}
        onAction={(kind, id, action) => {
          if (kind === "folder") {
            if (action === "create-note") props.onFolderAction({ type: "create-note", folderId: id });
            if (action === "create-folder") props.onFolderAction({ type: "create-folder", folderId: id });
            if (action === "rename") props.onFolderAction({ type: "rename", folderId: id });
            if (action === "delete") props.onFolderAction({ type: "delete", folderId: id });
            if (action === "move") props.onFolderAction({ type: "move-start", folderId: id });
          } else if (kind === "note") {
            if (action === "rename") props.onNoteAction({ type: "rename", noteId: id });
            if (action === "delete") props.onNoteAction({ type: "delete", noteId: id });
            if (action === "move") props.onNoteAction({ type: "move-start", noteId: id });
          } else {
            // root
            if (action === "create-note") props.onRootAction({ type: "create-note" });
            if (action === "create-folder") props.onRootAction({ type: "create-folder" });
          }
          props.onContextMenu(null);
        }}
        onDismiss={() => props.onContextMenu(null)}
      />
    </aside>
  );
}

/* ============== 节点 ============== */

interface FolderNodeProps {
  node: TreeFolderNode;
  depth: number;
  selectedFolder: boolean;
  selectedNote: (id: string) => boolean;
  dropHover: DropHoverState | null;
  dragging: DragState | null;
  disabled: boolean;
  moveState: MoveState | null;
  isNoteVisible: (id: string) => boolean;
  ephemeralNoteId: string | null;
  onSelect: (next: SidebarSelection) => void;
  onFolderAction: (action: FolderAction) => void;
  onNoteAction: (action: NoteAction) => void;
  onContextMenu: (state: SidebarContextMenuState | null) => void;
  onDragStart: (kind: "folder" | "note", id: string) => void;
  onDragEnd: () => void;
  onDragOverTarget: (target: { kind: "folder" | "root"; id: string | null }) => void;
  onDropOnTarget: (target: { kind: "folder" | "root"; id: string | null }) => void;
  onMoveTarget: (target: { kind: "folder" | "root"; id: string | null }) => void;
}

function FolderNode(props: FolderNodeProps) {
  const { node } = props;
  const isHover = props.dropHover?.kind === "folder" && props.dropHover.id === node.id;
  const isDragging = props.dragging?.kind === "folder" && props.dragging.id === node.id;
  const isMovingSelf = props.moveState?.kind === "folder" && props.moveState.id === node.id;

  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onContextMenu({ kind: "folder", folderId: node.id, x: event.clientX, y: event.clientY });
  };

  const handleClick = () => {
    if (props.moveState && !isMovingSelf) {
      props.onMoveTarget({ kind: "folder", id: node.id });
      return;
    }
    props.onSelect({ kind: "folder", id: node.id });
  };

  return (
    <>
      <div
        role="treeitem"
        className={[
          "tree-item",
          "is-folder",
          props.selectedFolder ? "is-selected" : "",
          isHover ? "is-drop-target" : "",
          isDragging ? "is-dragging" : "",
          props.moveState ? "is-move-mode" : "",
          isMovingSelf ? "is-move-source" : ""
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingLeft: `${8 + props.depth * 14}px` }}
        draggable={!props.disabled && !props.moveState}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", `folder:${node.id}`);
          props.onDragStart("folder", node.id);
        }}
        onDragEnd={() => props.onDragEnd()}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          props.onDragOverTarget({ kind: "folder", id: node.id });
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          props.onDropOnTarget({ kind: "folder", id: node.id });
        }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <span className="tree-item__icon" aria-hidden="true">
          ▾
        </span>
        <span className="tree-item__label">{node.title || "未命名文件夹"}</span>
      </div>
      {node.folders.map((child) => (
        <FolderNode
          key={child.id}
          node={child}
          depth={props.depth + 1}
          selectedFolder={props.selectedFolder}
          selectedNote={props.selectedNote}
          dropHover={props.dropHover}
          dragging={props.dragging}
          disabled={props.disabled}
          moveState={props.moveState}
          isNoteVisible={props.isNoteVisible}
          ephemeralNoteId={props.ephemeralNoteId}
          onSelect={props.onSelect}
          onFolderAction={props.onFolderAction}
          onNoteAction={props.onNoteAction}
          onContextMenu={props.onContextMenu}
          onDragStart={props.onDragStart}
          onDragEnd={props.onDragEnd}
          onDragOverTarget={props.onDragOverTarget}
          onDropOnTarget={props.onDropOnTarget}
          onMoveTarget={props.onMoveTarget}
        />
      ))}
      {node.notes.filter((child) => props.isNoteVisible(child.id)).map((child) => (
        <NoteRow
          key={child.id}
          node={child}
          depth={props.depth + 1}
          selected={props.selectedNote(child.id)}
          ephemeral={props.ephemeralNoteId === child.id}
          dragging={props.dragging}
          disabled={props.disabled}
          onSelect={() => props.onSelect({ kind: "note", id: child.id })}
          onAction={props.onNoteAction}
          onContextMenu={props.onContextMenu}
          onDragStart={props.onDragStart}
          onDragEnd={props.onDragEnd}
        />
      ))}
    </>
  );
}

interface NoteRowProps {
  node: TreeNoteNode;
  depth: number;
  selected: boolean;
  /** 当前未保存新 note：视觉上区分；不可拖走（保存前无 folder 实体）。 */
  ephemeral?: boolean;
  dragging: DragState | null;
  disabled: boolean;
  onSelect: () => void;
  onAction: (action: NoteAction) => void;
  onContextMenu: (state: SidebarContextMenuState | null) => void;
  onDragStart: (kind: "folder" | "note", id: string) => void;
  onDragEnd: () => void;
}

function NoteRow(props: NoteRowProps) {
  const { node } = props;
  const isDragging = props.dragging?.kind === "note" && props.dragging.id === node.id;
  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onContextMenu({ kind: "note", noteId: node.id, x: event.clientX, y: event.clientY });
  };
  return (
    <button
      type="button"
      role="treeitem"
      className={[
        "tree-item",
        "is-note",
        props.selected ? "is-selected" : "",
        isDragging ? "is-dragging" : "",
        props.ephemeral ? "is-ephemeral" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ paddingLeft: `${8 + props.depth * 14}px` }}
      draggable={!props.ephemeral}
      onDragStart={(e) => {
        if (props.ephemeral) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `note:${node.id}`);
        props.onDragStart("note", node.id);
      }}
      onDragEnd={() => props.onDragEnd()}
      onClick={props.onSelect}
      onContextMenu={handleContextMenu}
      title={props.ephemeral ? `${node.title || "未命名 note"}（未保存）` : node.title}
    >
      <span className="tree-item__icon" aria-hidden="true">
        ·
      </span>
      <span className="tree-item__label">{node.title || "未命名 note"}</span>
      {props.ephemeral ? (
        <span className="tree-item__badge" aria-hidden="true">
          未保存
        </span>
      ) : null}
    </button>
  );
}

interface RootDropZoneProps {
  highlighted: boolean;
  selected: boolean;
  disabled: boolean;
  onDragOver: () => void;
  onDrop: () => void;
  onClick?: () => void;
  onContextMenu?: (event: ReactMouseEvent) => void;
  children: ReactNode;
}

function RootDropZone(props: RootDropZoneProps) {
  return (
    <div
      className={[
        "tree-item",
        "is-root",
        props.highlighted ? "is-drop-target" : "",
        props.selected ? "is-selected" : ""
      ]
        .filter(Boolean)
        .join(" ")}
      onDragOver={(e) => {
        e.preventDefault();
        props.onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        props.onDrop();
      }}
      onClick={() => props.onClick?.()}
      onContextMenu={(e) => props.onContextMenu?.(e)}
    >
      {props.children}
    </div>
  );
}

/* ============== 右键菜单 ============== */

interface ContextMenuProps {
  state: SidebarContextMenuState | null;
  onAction: (
    kind: "folder" | "note" | "root",
    id: string,
    action: "create-note" | "create-folder" | "rename" | "delete" | "move"
  ) => void;
  onDismiss: () => void;
}

function ContextMenu(props: ContextMenuProps) {
  // 防止 onClick 全局监听在本组件冒泡时关闭自身——在 mount 时挂一个全局监听。
  useEffect(() => {
    if (!props.state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.state, props]);

  if (!props.state) return null;
  const { state } = props;
  // 视口边界保护：超过右下边界时回退到视口内。
  const maxX = typeof window === "undefined" ? state.x : Math.min(state.x, window.innerWidth - 200);
  const maxY = typeof window === "undefined" ? state.y : Math.min(state.y, window.innerHeight - 220);

  if (state.kind === "folder") {
    return (
      <ul
        className="context-menu"
        role="menu"
        style={{ left: `${maxX}px`, top: `${maxY}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <li>
          <button
            type="button"
            role="menuitem"
            onClick={() => props.onAction("folder", state.folderId, "create-note")}
          >
            新建 note
          </button>
        </li>
        <li>
          <button
            type="button"
            role="menuitem"
            onClick={() => props.onAction("folder", state.folderId, "create-folder")}
          >
            新建文件夹
          </button>
        </li>
        <li>
          <button
            type="button"
            role="menuitem"
            onClick={() => props.onAction("folder", state.folderId, "rename")}
          >
            重命名
          </button>
        </li>
        <li>
          <button
            type="button"
            role="menuitem"
            onClick={() => props.onAction("folder", state.folderId, "move")}
          >
            移动…
          </button>
        </li>
        <li className="context-menu__danger">
          <button
            type="button"
            role="menuitem"
            onClick={() => props.onAction("folder", state.folderId, "delete")}
          >
            删除
          </button>
        </li>
      </ul>
    );
  }
  if (state.kind === "root") {
    return (
      <ul
        className="context-menu"
        role="menu"
        style={{ left: `${maxX}px`, top: `${maxY}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <li>
          <button type="button" role="menuitem" onClick={() => props.onAction("root", "", "create-note")}>
            新建 note
          </button>
        </li>
        <li>
          <button type="button" role="menuitem" onClick={() => props.onAction("root", "", "create-folder")}>
            新建文件夹
          </button>
        </li>
      </ul>
    );
  }
  return (
    <ul
      className="context-menu"
      role="menu"
      style={{ left: `${maxX}px`, top: `${maxY}px` }}
      onClick={(e) => e.stopPropagation()}
    >
      <li>
        <button type="button" role="menuitem" onClick={() => props.onAction("note", state.noteId, "rename")}>
          重命名
        </button>
      </li>
      <li>
        <button type="button" role="menuitem" onClick={() => props.onAction("note", state.noteId, "move")}>
          移动…
        </button>
      </li>
      <li className="context-menu__danger">
        <button type="button" role="menuitem" onClick={() => props.onAction("note", state.noteId, "delete")}>
          删除
        </button>
      </li>
    </ul>
  );
}
