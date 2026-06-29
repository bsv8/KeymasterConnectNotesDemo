// src/components/EditorFormattingToolbar.tsx
// 固定在正文顶部的 markdown 格式工具栏。
//
// 设计缘由（本次 markdown 常驻工具栏调整）：
//   - 用户需要类似 Office 的常驻格式入口，而不是只依赖 BlockNote 的浮动选区条；
//   - 仍坚持 markdown 友好边界，只暴露 paragraph / heading / list / quote /
//     code / divider + 常用 inline style；
//   - 不自建编辑器状态机：按钮只读取 BlockNote 当前选区状态，并直接调用 editor API；
//   - 不引入图片、表格、颜色等超出当前 note 真值边界的能力，避免系统复杂化。

import type { Block, BlockNoteEditor, PartialBlock } from "@blocknote/core";
import { useBlockNoteEditor, useEditorState } from "@blocknote/react";
import { type ReactNode, useMemo } from "react";
import { useI18n } from "../i18n/useI18n";
import type { MessageKey } from "../i18n/types";

type ToolbarEditor = BlockNoteEditor;
type ToolbarBlock = Block;

interface EditorFormattingToolbarProps {
  disabled: boolean;
  saveDisabled: boolean;
  saveTitle?: string;
  onSave: () => void;
}

interface BlockAction {
  key:
    | "paragraph"
    | "heading1"
    | "heading2"
    | "heading3"
    | "quote"
    | "bulletList"
    | "numberedList"
    | "checkList"
    | "codeBlock"
    | "divider";
  labelKey: MessageKey;
  isActive: (block: ToolbarBlock) => boolean;
  run: (editor: ToolbarEditor, blocks: ToolbarBlock[]) => void;
}

const BLOCK_ACTIONS: readonly BlockAction[] = [
  {
    key: "paragraph",
    labelKey: "editor.toolbar.block.paragraph",
    isActive: (block) => block.type === "paragraph",
    run: (editor, blocks) => updateBlocks(editor, blocks, { type: "paragraph" })
  },
  {
    key: "heading1",
    labelKey: "editor.toolbar.block.heading1",
    isActive: (block) => block.type === "heading" && block.props.level === 1,
    run: (editor, blocks) => updateBlocks(editor, blocks, { type: "heading", props: { level: 1 } })
  },
  {
    key: "heading2",
    labelKey: "editor.toolbar.block.heading2",
    isActive: (block) => block.type === "heading" && block.props.level === 2,
    run: (editor, blocks) => updateBlocks(editor, blocks, { type: "heading", props: { level: 2 } })
  },
  {
    key: "heading3",
    labelKey: "editor.toolbar.block.heading3",
    isActive: (block) => block.type === "heading" && block.props.level === 3,
    run: (editor, blocks) => updateBlocks(editor, blocks, { type: "heading", props: { level: 3 } })
  },
  {
    key: "quote",
    labelKey: "editor.toolbar.block.quote",
    isActive: (block) => block.type === "quote",
    run: (editor, blocks) => updateBlocks(editor, blocks, { type: "quote" })
  },
  {
    key: "bulletList",
    labelKey: "editor.toolbar.block.bulletList",
    isActive: (block) => block.type === "bulletListItem",
    run: (editor, blocks) => updateBlocks(editor, blocks, { type: "bulletListItem" })
  },
  {
    key: "numberedList",
    labelKey: "editor.toolbar.block.numberedList",
    isActive: (block) => block.type === "numberedListItem",
    run: (editor, blocks) => updateBlocks(editor, blocks, { type: "numberedListItem" })
  },
  {
    key: "checkList",
    labelKey: "editor.toolbar.block.checkList",
    isActive: (block) => block.type === "checkListItem",
    run: (editor, blocks) => updateBlocks(editor, blocks, { type: "checkListItem" })
  },
  {
    key: "codeBlock",
    labelKey: "editor.toolbar.block.codeBlock",
    isActive: (block) => block.type === "codeBlock",
    run: (editor, blocks) => updateBlocks(editor, blocks, { type: "codeBlock" })
  },
  {
    key: "divider",
    labelKey: "editor.toolbar.block.divider",
    isActive: (block) => block.type === "divider",
    run: (editor) => insertOrReplaceCurrentBlock(editor, { type: "divider" })
  }
] as const;

const INLINE_STYLE_ACTIONS = [
  { key: "bold", labelKey: "editor.toolbar.inline.bold" },
  { key: "italic", labelKey: "editor.toolbar.inline.italic" },
  { key: "code", labelKey: "editor.toolbar.inline.code" }
] as const;

type ToolbarIconKey = "save" | BlockAction["key"] | (typeof INLINE_STYLE_ACTIONS)[number]["key"];

/** 固定格式工具栏；只反映当前 editor 真值，不持有独立状态。 */
export function EditorFormattingToolbar(props: EditorFormattingToolbarProps) {
  const { t } = useI18n();
  const editor = useBlockNoteEditor();

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      const selectedBlocks = currentEditor.getSelection()?.blocks;
      const blocks =
        selectedBlocks && selectedBlocks.length > 0
          ? selectedBlocks
          : [currentEditor.getTextCursorPosition().block];

      return {
        activeStyles: currentEditor.getActiveStyles(),
        blocks
      };
    }
  });

  const blockButtons = useMemo(
    () =>
      BLOCK_ACTIONS.map((action) => ({
        ...action,
        active:
          toolbarState.blocks.length > 0 &&
          toolbarState.blocks.every((block) => action.isActive(block as ToolbarBlock))
      })),
    [toolbarState.blocks]
  );

  return (
    <div className="editor-format-toolbar" role="toolbar" aria-label={t("editor.toolbar.aria")}>
      <div className="editor-format-toolbar__group" aria-label={t("toolbar.action.save")}>
        <ToolbarButton
          active={false}
          disabled={props.saveDisabled}
          label={t("toolbar.action.save")}
          icon={renderToolbarIcon("save")}
          onClick={props.onSave}
          variant="primary"
          title={props.saveTitle ?? t("toolbar.action.save")}
        />
      </div>

      <div className="editor-format-toolbar__group" aria-label={t("editor.toolbar.group.block")}>
        {blockButtons.map((action) => (
          <ToolbarButton
            key={action.key}
            active={action.active}
            disabled={props.disabled}
            label={t(action.labelKey)}
            icon={renderToolbarIcon(action.key)}
            onClick={() => {
              action.run(editor, toolbarState.blocks as ToolbarBlock[]);
            }}
          />
        ))}
      </div>

      <div className="editor-format-toolbar__group" aria-label={t("editor.toolbar.group.inline")}>
        {INLINE_STYLE_ACTIONS.map((action) => (
          <ToolbarButton
            key={action.key}
            active={action.key in toolbarState.activeStyles}
            disabled={props.disabled || !supportsInlineStyle(editor, action.key)}
            label={t(action.labelKey)}
            icon={renderToolbarIcon(action.key)}
            onClick={() => {
              editor.focus();
              editor.toggleStyles({ [action.key]: true } as never);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ToolbarButton(props: {
  active: boolean;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  title?: string;
  variant?: "default" | "primary";
}) {
  return (
    <button
      type="button"
      className={`editor-format-toolbar__button${props.active ? " is-active" : ""}${
        props.variant === "primary" ? " is-primary" : ""
      }`}
      aria-pressed={props.active}
      aria-label={props.label}
      disabled={props.disabled}
      title={props.title ?? props.label}
      onMouseDown={(event) => {
        // 保留当前文本选区；否则点击按钮会先让编辑器失焦，格式操作会打在错误位置。
        event.preventDefault();
      }}
      onClick={props.onClick}
    >
      {props.icon}
    </button>
  );
}

/**
 * 工具栏图标内嵌在代码里，避免额外引入图标依赖，同时确保 light / dark theme 都走
 * `currentColor`，由现有主题 token 控制明暗。
 */
function renderToolbarIcon(key: ToolbarIconKey): ReactNode {
  switch (key) {
    case "save":
      return (
        <svg className="editor-format-toolbar__icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 3.5h8.5L16.5 6v10.5H3.5V3.5h1.5" />
          <path d="M6.5 3.5v4h6v-4M7.5 16.5v-4h5v4" />
        </svg>
      );
    case "paragraph":
      return (
        <svg className="editor-format-toolbar__icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 5.5h12M4 10h12M4 14.5h8.5" />
        </svg>
      );
    case "heading1":
      return <TextIcon text="H1" />;
    case "heading2":
      return <TextIcon text="H2" />;
    case "heading3":
      return <TextIcon text="H3" />;
    case "quote":
      return (
        <svg className="editor-format-toolbar__icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M6.5 7.25H4.75v2.5A2.75 2.75 0 0 0 7.5 12.5v.25A2.75 2.75 0 0 1 4.75 15.5M13.75 7.25H12v2.5a2.75 2.75 0 0 0 2.75 2.75v.25A2.75 2.75 0 0 1 12 15.5" />
        </svg>
      );
    case "bulletList":
      return (
        <svg className="editor-format-toolbar__icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="4.5" cy="5.5" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="10" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
          <path d="M8 5.5h8M8 10h8M8 14.5h8" />
        </svg>
      );
    case "numberedList":
      return (
        <svg className="editor-format-toolbar__icon" viewBox="0 0 20 20" aria-hidden="true">
          <text x="4.5" y="7.1" textAnchor="middle" className="editor-format-toolbar__icon-text editor-format-toolbar__icon-text--small">
            1
          </text>
          <text x="4.5" y="14.6" textAnchor="middle" className="editor-format-toolbar__icon-text editor-format-toolbar__icon-text--small">
            2
          </text>
          <path d="M8 5.5h8M8 10h8M8 14.5h8" />
        </svg>
      );
    case "checkList":
      return (
        <svg className="editor-format-toolbar__icon" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2.75" y="4" width="3.5" height="3.5" rx="0.7" />
          <path d="M3.7 5.9 4.7 6.9 6 5.2M8.5 5.75H17M2.75 12.25h3.5v3.5h-3.5zM3.7 14.1l1 1 1.3-1.7M8.5 14H17" />
        </svg>
      );
    case "codeBlock":
      return (
        <svg className="editor-format-toolbar__icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="m7 5.5-3 4.5 3 4.5M13 5.5l3 4.5-3 4.5M10.75 4.75 9 15.25" />
        </svg>
      );
    case "divider":
      return (
        <svg className="editor-format-toolbar__icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3 10h14" />
          <circle cx="10" cy="10" r="1.25" fill="currentColor" stroke="none" />
        </svg>
      );
    case "bold":
      return <TextIcon text="B" weight={800} />;
    case "italic":
      return <TextIcon text="I" italic />;
    case "code":
      return (
        <svg className="editor-format-toolbar__icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="m8 6-4 4 4 4M12 6l4 4-4 4" />
        </svg>
      );
    default:
      return null;
  }
}

function TextIcon(props: { text: string; weight?: number; italic?: boolean }) {
  return (
    <svg className="editor-format-toolbar__icon" viewBox="0 0 20 20" aria-hidden="true">
      <text
        x="10"
        y="13"
        textAnchor="middle"
        className="editor-format-toolbar__icon-text"
        fontWeight={props.weight ?? 700}
        fontStyle={props.italic ? "italic" : "normal"}
      >
        {props.text}
      </text>
    </svg>
  );
}

/** 对当前选区的 block 批量施加同一种 block 类型更新，并合并成一次 undo。 */
function updateBlocks(
  editor: ToolbarEditor,
  blocks: ToolbarBlock[],
  update: PartialBlock
) {
  editor.focus();
  editor.transact(() => {
    for (const block of blocks) {
      editor.updateBlock(block, update);
    }
  });
}

/**
 * divider 没有 inline 内容，不能像其它 block 一样简单整批切换。
 * 这里复用 slash menu 的核心策略：
 *   - 当前块为空时，原地替换成 divider；
 *   - 当前块非空时，在后面插入 divider；
 *   - 再补一个 paragraph，让光标落回可编辑块，避免把用户卡在非文本块上。
 */
function insertOrReplaceCurrentBlock(
  editor: ToolbarEditor,
  block: PartialBlock
) {
  const currentBlock = editor.getTextCursorPosition().block;
  const shouldReplace =
    Array.isArray(currentBlock.content) &&
    currentBlock.content.length === 0;

  editor.focus();
  editor.transact(() => {
    const dividerBlock = shouldReplace
      ? editor.updateBlock(currentBlock, block)
      : editor.insertBlocks([block], currentBlock, "after")[0];
    if (!dividerBlock) {
      return;
    }

    const paragraphBlock = editor.insertBlocks([{ type: "paragraph" }], dividerBlock, "after")[0];
    editor.setTextCursorPosition(paragraphBlock ?? dividerBlock);
  });
}

/** schema 若未来裁掉某个 inline style，这里让按钮自动禁用，而不是继续发非法命令。 */
function supportsInlineStyle(
  editor: ToolbarEditor,
  style: (typeof INLINE_STYLE_ACTIONS)[number]["key"]
) {
  return style in editor.schema.styleSchema;
}
