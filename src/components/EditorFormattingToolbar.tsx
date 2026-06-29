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
import { useMemo } from "react";
import { useI18n } from "../i18n/useI18n";
import type { MessageKey } from "../i18n/types";

type ToolbarEditor = BlockNoteEditor;
type ToolbarBlock = Block;

interface EditorFormattingToolbarProps {
  disabled: boolean;
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
      <div className="editor-format-toolbar__group" aria-label={t("editor.toolbar.group.block")}>
        {blockButtons.map((action) => (
          <ToolbarButton
            key={action.key}
            active={action.active}
            disabled={props.disabled}
            label={t(action.labelKey)}
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
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`editor-format-toolbar__button${props.active ? " is-active" : ""}`}
      aria-pressed={props.active}
      disabled={props.disabled}
      onMouseDown={(event) => {
        // 保留当前文本选区；否则点击按钮会先让编辑器失焦，格式操作会打在错误位置。
        event.preventDefault();
      }}
      onClick={props.onClick}
    >
      {props.label}
    </button>
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
