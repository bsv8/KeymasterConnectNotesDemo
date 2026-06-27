// src/components/NoteEditor.tsx
// BlockNote 编辑器包装。
//
// 设计缘由（施工单第 7 章 + 12.6 节 + 2026-06-26 save-switch-current-editor-state）：
//   - BlockNote 内存态是**编辑**真值；导出 markdown 才是**落库**真值。
//   - 我们不在持久层存 BlockNote JSON；只存加密的 markdown。
//   - 外部 `value` (markdown) ↔ 内部 BlockNote document 的转换在编辑器内部完成；
//     改动通过 `onChange(markdown)` 上抛。
//   - 块类型只保留 markdown 友好集（paragraph / heading / list / quote /
//     code / divider）；高级块（image / table / 多列）不引入。
//   - **不再承载 title 语义**——标题（文件名）改由 editor-stage__filename 输入框收口。
//   - "保存"动作由父组件在 markdown 稳定后触发；编辑器不做自动保存。
//   - 防回灌：使用 `lastLoadedRef` 记录"我最近一次灌入编辑器的 markdown"，
//     外部 `props.markdown` 若与它一致则跳过 loadMarkdown。
//     这避免"save 成功后 App 重新传入相同 markdown → 触发 reload → 编辑器抖动"链路。
//     上抛的 onChange 也会先把 `md` 写入 `lastLoadedRef`，让"自己刚上抛的"不会再被自己 reload。

import { useEffect, useMemo, useRef } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import type { BlockNoteEditor } from "@blocknote/core";
import "@blocknote/mantine/style.css";
import "@blocknote/core/fonts/inter.css";

export interface NoteEditorProps {
  markdown: string;
  editable: boolean;
  decryptFailed: boolean;
  theme: "light" | "dark";
  onChange: (markdown: string) => void;
}

/** 用 `tryParseMarkdownToBlocks` 初始化文档；后续转换统一走 markdown。 */
export function NoteEditor(props: NoteEditorProps) {
  const editor = useCreateBlockNote({
    // 走 markdown 导入/导出为单真值；不上传 JSON。
    initialContent: [{ type: "paragraph", content: [] }]
  });

  // 记录上一次外部传入的 markdown，避免重复解析产生抖动。
  const lastLoadedRef = useRef<string | null>(null);

  // 首次或外部 markdown 变化时，把 markdown 灌入编辑器。
  useEffect(() => {
    if (props.decryptFailed) return;
    if (lastLoadedRef.current === props.markdown) return;
    lastLoadedRef.current = props.markdown;
    void loadMarkdown(editor, props.markdown);
  }, [editor, props.markdown, props.decryptFailed]);

  // 上抛编辑器 → markdown；编辑器实例在 markdown 内容变化时被 BlockNote 触发。
  useEffect(() => {
    let cancelled = false;
    const off = editor.onChange(async () => {
      if (cancelled) return;
      if (props.decryptFailed) return;
      const md = await editor.blocksToMarkdownLossy(editor.document);
      if (cancelled) return;
      lastLoadedRef.current = md;
      props.onChange(md);
    });
    return () => {
      cancelled = true;
      if (typeof off === "function") off();
      else if (off && typeof (off as { unsubscribe?: () => void }).unsubscribe === "function") {
        (off as { unsubscribe: () => void }).unsubscribe();
      }
    };
  }, [editor, props.decryptFailed, props.onChange]);

  const slashItems = useMemo(() => undefined, []);

  if (props.decryptFailed) {
    return (
      <div className="editor editor-failed">
        <div className="editor-failed__box">
          <h3>无法解密</h3>
          <p>
            此 note 的密文无法被当前 origin / 当前 active key 解开。可能原因：
            origin 切换、active key 切换、密文损坏。
          </p>
          <p>note 仍然保留；可查看元数据但无法编辑正文。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="editor">
      <BlockNoteView
        editor={editor}
        editable={props.editable}
        // 默认 slash menu 列表满足 markdown 友好块；不引入 image / table 等。
        slashMenu={slashItems as never}
        theme={props.theme}
      />
    </div>
  );
}

async function loadMarkdown(editor: BlockNoteEditor, markdown: string): Promise<void> {
  if (markdown.trim().length === 0) {
    // 空内容：留一段空 paragraph，避免空文档报错。
    await safeReplace(editor, [{ type: "paragraph", content: [] }]);
    return;
  }
  try {
    const blocks = await editor.tryParseMarkdownToBlocks(markdown);
    await safeReplace(editor, blocks);
  } catch (err) {
    console.error("[notes-demo] failed to parse markdown", err);
    // 解析失败：把原文作为单一 paragraph 灌入，避免丢内容。
    await safeReplace(editor, [{ type: "paragraph", content: [{ type: "text", text: markdown }] }]);
  }
}

async function safeReplace(editor: BlockNoteEditor, blocks: unknown): Promise<void> {
  try {
    editor.replaceBlocks(editor.document, blocks as never);
  } catch (err) {
    console.error("[notes-demo] replaceBlocks failed", err);
  }
}
