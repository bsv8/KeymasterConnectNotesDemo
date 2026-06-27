// src/components/SearchResultsPanel.tsx
// 搜索结果页：右侧文档区在 `isSearchMode` 下渲染此组件。
//
// 设计缘由（施工单 2026-06-27 note-search-results-and-tree-expand-persistence
//          第 4.2 / 4.3 / 4.5 / 7.3 章）：
//   - 树只负责树；搜索只负责结果。
//   - 结果集合**只**包含 note（不含 folder）。
//   - 结果项固定两行：
//       - 第一行：大字标题；
//       - 第二行：小字 path。
//   - 标题为空 → "未命名 note"。
//   - 根目录下 → "根目录"；非根目录 → "根目录 / 项目 / 方案"。
//   - 排序 = 树自然顺序（与左侧树一致）；**不**做相关性 / 高亮。
//   - 本组件**不**直接改 selection 真值、**不**直接动 localStorage。
//     点击结果只回调上层（App），由 App 走现有 `trySelect` 链路。
//   - 空结果时显示明确的"无结果"页，明确当前搜索条件来源：
//       - 关键词；
//       - tag。

import type { MouseEvent as ReactMouseEvent } from "react";
import type { StoredNoteRecord } from "../lib/notes";

export interface SearchResultItem {
  /** note record 的 id。 */
  id: string;
  /** 标题（已 trim；空字符串将渲染为"未命名 note"）。 */
  title: string;
  /** tag 集合（仅用于无结果时摘要说明，不参与命中）。 */
  tags: string[];
  /** 显示用 path（由 App 算好；本组件不重新计算）。 */
  pathLabel: string;
}

export interface SearchResultsPanelProps {
  /** 当前搜索关键词（trim 后非空才算"有搜索"）。 */
  searchQuery: string;
  /** 当前激活的 tag。null = 不过滤 tag。 */
  activeTag: string | null;
  /** 命中结果（已排序、已裁剪到当前工作区）。 */
  results: SearchResultItem[];
  /** 点击结果项时回调；App 走 `trySelect`。 */
  onSelect: (id: string) => void;
}

export function SearchResultsPanel(props: SearchResultsPanelProps) {
  const { searchQuery, activeTag, results } = props;
  const hasQuery = searchQuery.trim().length > 0;
  const hasTag = activeTag !== null;
  const totalCount = results.length;

  return (
    <div className="search-results">
      <header className="search-results__header">
        <span className="search-results__eyebrow">搜索结果</span>
        <h2 className="search-results__title">
          {totalCount > 0
            ? `共 ${totalCount} 条结果`
            : hasQuery || hasTag
              ? "无匹配结果"
              : "请输入关键词或选择 tag"}
        </h2>
        <p className="search-results__filters">
          {hasQuery ? (
            <span className="search-results__chip">
              关键词：<strong>{searchQuery.trim()}</strong>
            </span>
          ) : null}
          {hasTag ? (
            <span className="search-results__chip">
              tag：<strong>#{activeTag}</strong>
            </span>
          ) : null}
          {!hasQuery && !hasTag ? (
            <span className="search-results__hint">
              左侧搜索框 / tag 按钮会驱动此页。
            </span>
          ) : null}
        </p>
      </header>

      {totalCount === 0 ? (
        <div className="search-results__empty">
          <p>
            当前条件下没有匹配的 note。请尝试更换关键词或清空 tag 过滤。
          </p>
        </div>
      ) : (
        <ul className="search-results__list" role="list">
          {results.map((item) => (
            <ResultRow
              key={item.id}
              item={item}
              onSelect={props.onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface ResultRowProps {
  item: SearchResultItem;
  onSelect: (id: string) => void;
}

function ResultRow(props: ResultRowProps) {
  const { item, onSelect } = props;
  const handleClick = (e: ReactMouseEvent) => {
    e.preventDefault();
    onSelect(item.id);
  };
  return (
    <li>
      <button
        type="button"
        className="search-results__item"
        onClick={handleClick}
      >
        <span className="search-results__item-title">
          {item.title || "未命名 note"}
        </span>
        <span className="search-results__item-path">{item.pathLabel}</span>
      </button>
    </li>
  );
}

/**
 * 把当前 note 集合按"搜索 / tag"规则裁剪到结果项。
 * 排序 = tree 自然顺序（由调用方保证 `treeOrder` 已是树序）。
 *
 * 规则（施工单第 4.1 / 4.3 / 4.4 章）：
 *   - `searchQuery` 仅匹配 `note.title`：`trim + lowerCase + includes`；
 *   - `activeTag` 仅匹配 `note.tags`：大小写不敏感的精确 tag 命中；
 *   - 两者都为空 → 返回空（搜索结果页不进 "结果" 分支）；
 *   - `folder.title` 永远不参与；
 *   - note 正文永远不参与。
 */
export function buildSearchResults(args: {
  /** 已按树序排列的 note 列表（标题用 `record.title` 即可）。 */
  treeOrderedNotes: StoredNoteRecord[];
  searchQuery: string;
  activeTag: string | null;
  /** 把 noteId + title 翻译成显示 path；由调用方注入（依赖 folder 拓扑）。 */
  pathLabelFor: (folderId: string | null) => string;
}): SearchResultItem[] {
  const { treeOrderedNotes, searchQuery, activeTag, pathLabelFor } = args;
  const q = searchQuery.trim().toLowerCase();
  const tag = activeTag;
  if (!q && !tag) return [];
  const out: SearchResultItem[] = [];
  for (const n of treeOrderedNotes) {
    if (tag && !n.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      continue;
    }
    if (q && !n.title.trim().toLowerCase().includes(q)) {
      continue;
    }
    out.push({
      id: n.id,
      title: n.title,
      tags: [...n.tags],
      pathLabel: pathLabelFor(n.folderId)
    });
  }
  return out;
}
