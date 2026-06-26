// src/components/NoteInspector.tsx
// 右侧 note 元数据与存储操作面板。
//
// 设计缘由：
//   - 路径 / 标题 / tag 编辑入口收口在这里。
//   - 路径冲突、保存、删除、移动动作全部走面板，**不**走 store 内调用。
//   - 创建 / 更新时间 / owner 公钥 / 密文状态只读展示。
//   - `decryptFailed` 态：所有编辑入口禁用；只允许删除。
//     —— 施工单硬定义：解密失败的 note **不**自动覆盖密文。
//   - 已有 note 的 path 允许编辑（move / rename）：data 层已经有"旧 path 删除 +
//     新 path 写入"分支；UI 不再锁死。

import { useMemo } from "react";
import type { NoteDraft, StoredNoteRecord } from "../lib/notes";
import {
  MAX_PATH_LENGTH,
  MAX_SEGMENT_LENGTH,
  normalizeNotePath,
  validateNotePath
} from "../lib/path";
import { MAX_TAGS_PER_NOTE, normalizeTags } from "../lib/notes";

export interface NoteInspectorProps {
  draft: NoteDraft;
  record: StoredNoteRecord | null;
  pathConflict: boolean;
  isNew: boolean;
  isDirty: boolean;
  /** 是否允许编辑元数据（title / tags / path / 正文）。decryptFailed 时为 false。 */
  canEdit: boolean;
  /** 是否允许删除当前 note。decryptFailed 时**仍**为 true——删除是清理密文的合法通路。 */
  canDelete: boolean;
  decryptFailed: boolean;
  onChangePath: (path: string) => void;
  onChangeTitle: (title: string) => void;
  onChangeTags: (tags: string[]) => void;
  onSave: () => void;
  onDelete: () => void;
  onReset: () => void;
  onCreateChild: () => void;
}

export function NoteInspector(props: NoteInspectorProps) {
  const pathCheck = useMemo(() => validateNotePath(normalizeNotePath(props.draft.path)), [props.draft.path]);
  const tagDraftText = useMemo(() => props.draft.tags.join(", "), [props.draft.tags]);

  // 设计缘由：decryptFailed 时，canEdit 为 false；
  // 这里再独立锁定"保存"按钮，避免 UI 在边缘状态下允许落库覆盖密文。
  const canSave = !props.decryptFailed
    && props.canEdit
    && pathCheck.ok
    && !props.pathConflict
    && props.isDirty;

  return (
    <aside className="inspector">
      {props.decryptFailed ? (
        <div className="inspector-warning" role="alert">
          此 note 解密失败，已锁定编辑。请删除本条，或切回原 origin / 原 active key 后重新打开。
        </div>
      ) : null}

      <div className="inspector-section">
        <h3>路径</h3>
        <input
          type="text"
          value={props.draft.path}
          onChange={(e) => props.onChangePath(e.target.value)}
          placeholder="/workspace/inbox/..."
          disabled={!props.canEdit}
          spellCheck={false}
        />
        <PathHint path={props.draft.path} ok={pathCheck.ok && !props.pathConflict} />
        {props.pathConflict ? (
          <p className="inspector-hint inspector-hint-error">已存在同 path 的 note，无法保存。</p>
        ) : null}
      </div>

      <div className="inspector-section">
        <h3>标题</h3>
        <input
          type="text"
          value={props.draft.title}
          onChange={(e) => props.onChangeTitle(e.target.value)}
          placeholder="给人看的标题"
          disabled={!props.canEdit}
          spellCheck={false}
        />
      </div>

      <div className="inspector-section">
        <h3>标签</h3>
        <input
          type="text"
          value={tagDraftText}
          onChange={(e) => props.onChangeTags(normalizeTags(e.target.value))}
          placeholder={`用逗号或换行分隔；最多 ${MAX_TAGS_PER_NOTE} 个`}
          disabled={!props.canEdit}
          spellCheck={false}
        />
        <p className="inspector-hint">tag 明文存储，用于本地搜索。</p>
      </div>

      <div className="inspector-section">
        <h3>状态</h3>
        <ul className="inspector-meta">
          <li>
            <span>owner</span>
            <strong title={props.record?.ownerPublicKeyHex ?? ""}>
              {props.record?.ownerPublicKeyHex ? truncate(props.record.ownerPublicKeyHex, 12) : "—"}
            </strong>
          </li>
          <li>
            <span>created</span>
            <strong>{props.record ? new Date(props.record.createdAt).toLocaleString() : "—"}</strong>
          </li>
          <li>
            <span>updated</span>
            <strong>{props.record ? new Date(props.record.updatedAt).toLocaleString() : "—"}</strong>
          </li>
          <li>
            <span>密文</span>
            <strong>
              {props.record
                ? `${props.record.cipher.cipherbytesBase64.length} b64`
                : "尚未保存"}
            </strong>
          </li>
          <li>
            <span>contentType</span>
            <strong>{props.record?.cipher.contentType ?? "—"}</strong>
          </li>
        </ul>
      </div>

      <div className="inspector-section inspector-actions">
        <button
          type="button"
          className="primary-button"
          onClick={props.onSave}
          disabled={!canSave}
          title={props.decryptFailed ? "解密失败，禁止覆盖密文" : undefined}
        >
          加密保存
        </button>
        {props.record && !props.isNew ? (
          <button
            type="button"
            className="secondary-button inspector-danger"
            onClick={props.onDelete}
            disabled={!props.canDelete}
          >
            删除
          </button>
        ) : null}
        {props.isDirty ? (
          <button
            type="button"
            className="secondary-button"
            onClick={props.onReset}
            disabled={!props.canEdit}
          >
            放弃修改
          </button>
        ) : null}
        {props.record ? (
          <button
            type="button"
            className="secondary-button"
            onClick={props.onCreateChild}
            disabled={!props.canEdit}
          >
            新建子 note
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function PathHint({ path, ok }: { path: string; ok: boolean }) {
  const check = useMemo(() => validateNotePath(normalizeNotePath(path)), [path]);
  if (path.length === 0) {
    return <p className="inspector-hint">绝对路径，如 <code>/workspace/inbox/daily</code>。</p>;
  }
  if (check.ok) {
    return (
      <p className="inspector-hint">
        {ok ? "合法 path。" : "path 合法但与其他 note 冲突。"}
      </p>
    );
  }
  return <p className="inspector-hint inspector-hint-error">{check.failure.message}</p>;
}

function truncate(value: string, head: number): string {
  if (value.length <= head + 4) return value;
  return `${value.slice(0, head)}…${value.slice(-4)}`;
}

/** 内部小工具：检测 `path` 与 `MAX_PATH_LENGTH / MAX_SEGMENT_LENGTH` 上限。 */
export function pathLengthSummary(path: string): { total: number; max: number; segment: number; segmentMax: number } {
  const segs = path.split("/").filter((s) => s.length > 0);
  const maxSeg = segs.reduce((acc, s) => Math.max(acc, s.length), 0);
  return {
    total: path.length,
    max: MAX_PATH_LENGTH,
    segment: maxSeg,
    segmentMax: MAX_SEGMENT_LENGTH
  };
}
