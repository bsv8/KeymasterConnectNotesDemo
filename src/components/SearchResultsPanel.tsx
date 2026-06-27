// src/components/SearchResultsPanel.tsx
// 搜索结果页：右侧文档区在 `isSearchMode` 下渲染此组件。
//
// 设计缘由（施工单 2026-06-27 note-search-results-and-tree-expand-persistence
//          第 4.2 / 4.3 / 4.5 / 7.3 章 +
//          施工单 2026-06-27 005-i18n-header-language-switch 8.12 章）：
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
//   - 所有用户可见文案走 i18n 字典；结果数文本支持插值。

import type { MouseEvent as ReactMouseEvent } from "react";
import type { StoredNoteRecord } from "../lib/notes";
import { useI18n } from "../i18n/useI18n";
import type { SupportedLanguage } from "../i18n/types";

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
  /** 当前语言；用于将 pathLabel 在需要时跟随语言格式化（当前实现不依赖，但保留接口便于扩展）。 */
  language: SupportedLanguage;
}

export function SearchResultsPanel(props: SearchResultsPanelProps) {
  const { t } = useI18n();
  const { searchQuery, activeTag, results } = props;
  const hasQuery = searchQuery.trim().length > 0;
  const hasTag = activeTag !== null;
  const totalCount = results.length;

  return (
    <div className="search-results">
      <header className="search-results__header">
        <span className="search-results__eyebrow">{t("search.eyebrow")}</span>
        <h2 className="search-results__title">
          {totalCount > 0
            ? t("search.title.hasResults", { count: totalCount })
            : hasQuery || hasTag
              ? t("search.title.noResults")
              : t("search.title.noInput")}
        </h2>
        <p className="search-results__filters">
          {hasQuery ? (
            <span className="search-results__chip">
              {t("search.filter.keyword")}：<strong>{searchQuery.trim()}</strong>
            </span>
          ) : null}
          {hasTag ? (
            <span className="search-results__chip">
              {t("search.filter.tag")}：<strong>#{activeTag}</strong>
            </span>
          ) : null}
          {!hasQuery && !hasTag ? (
            <span className="search-results__hint">
              {t("search.filter.hint")}
            </span>
          ) : null}
        </p>
      </header>

      {totalCount === 0 ? (
        <div className="search-results__empty">
          <p>
            {t("search.empty.description")}
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
  const { t } = useI18n();
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
          {item.title || t("search.item.titleFallback")}
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