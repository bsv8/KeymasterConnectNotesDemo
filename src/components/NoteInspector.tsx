// src/components/NoteInspector.tsx
// 右侧 note / folder 元数据面板。
//
// 设计缘由（施工单第 12.7 节）：
//   - **不再**包含 title 编辑——title（文件名）已经在 editor-stage 顶部输入框承担。
//   - **不再**包含 path 编辑——folder/note 通过右键菜单 / 拖拽移动，路径是派生量。
//   - 仅保留：
//       - tag（明文，本地聚合用）；
//       - 时间信息（created / updated）；
//       - 加密状态（密文长度、contentType）；
//       - 保存 / 删除 / 放弃修改 三个动作。
//   - folder 选中态：显示 folder 元信息 + 删除按钮（删除前由 App 校验 isFolderEmpty）。
//   - `decryptFailed` 时所有编辑入口禁用；删除仍然允许——这是修复"请删除本条"提示的关键。
//   - tag 规则：写入前 `trim` → 过滤空 → 转小写 → 去重 → 截断到上限（详见 `notes.ts`）。

import { useMemo } from "react";
import type { NoteDraft, StoredFolderRecord, StoredNoteRecord } from "../lib/notes";
import { MAX_TAGS_PER_NOTE, normalizeTags, validateTitle } from "../lib/notes";

export interface NoteInspectorProps {
  /** 当前 note 的 draft；folder 选中时为 null。 */
  draft: NoteDraft | null;
  /** 当前 note 的 record；folder 选中时为 null。 */
  record: StoredNoteRecord | null;
  /** folder 选中时显示 folder 元信息。 */
  folder?: StoredFolderRecord | null;
  /** 是否有未保存修改（draft 模式才有意义）。 */
  isDirty: boolean;
  /** title 校验失败的提示文案；null 表示合法。 */
  titleError: string | null;
  /** 是否允许编辑元数据（tags）；decryptFailed 时为 false。 */
  canEdit: boolean;
  /** 是否允许删除；decryptFailed 时**仍**为 true。 */
  canDelete: boolean;
  /** 解密失败态。 */
  decryptFailed: boolean;
  onChangeTitle: (title: string) => void;
  onChangeTags: (tags: string[]) => void;
  onSave: () => void;
  onDelete: () => void;
  onReset: () => void;
}

export function NoteInspector(props: NoteInspectorProps) {
  // folder 选中态：只展示 folder 元信息 + 删除按钮。
  if (!props.draft && props.folder) {
    return (
      <aside className="inspector">
        <div className="inspector-section">
          <h3>文件夹</h3>
          <input
            type="text"
            value={props.folder.title}
            readOnly
            aria-readonly="true"
            className="inspector-readonly"
          />
          <p className="inspector-hint">文件夹名改用右键菜单 → 重命名。</p>
        </div>
        <div className="inspector-section">
          <h3>状态</h3>
          <ul className="inspector-meta">
            <li>
              <span>id</span>
              <strong title={props.folder.id}>{truncate(props.folder.id, 12)}</strong>
            </li>
            <li>
              <span>created</span>
              <strong>{new Date(props.folder.createdAt).toLocaleString()}</strong>
            </li>
            <li>
              <span>updated</span>
              <strong>{new Date(props.folder.updatedAt).toLocaleString()}</strong>
            </li>
          </ul>
        </div>
        <div className="inspector-section inspector-actions">
          <button
            type="button"
            className="secondary-button inspector-danger"
            onClick={props.onDelete}
            disabled={!props.canDelete}
          >
            删除文件夹
          </button>
        </div>
      </aside>
    );
  }

  if (!props.draft) return null;

  const tagDraftText = useMemo(() => props.draft!.tags.join(", "), [props.draft]);
  const titleCheck = useMemo(() => validateTitle(props.draft!.title), [props.draft]);
  const canSave =
    !props.decryptFailed && props.canEdit && titleCheck.ok && props.isDirty;

  return (
    <aside className="inspector">
      {props.decryptFailed ? (
        <div className="inspector-warning" role="alert">
          此 note 解密失败，已锁定编辑。请删除本条，或切回原 origin / 原 active key 后重新打开。
        </div>
      ) : null}

      <div className="inspector-section">
        <h3>标签</h3>
        <input
          type="text"
          value={tagDraftText}
          onChange={(e) => props.onChangeTags(normalizeTags(e.target.value))}
          placeholder={`用半角逗号、全角逗号或空格分隔；最多 ${MAX_TAGS_PER_NOTE} 个`}
          disabled={!props.canEdit}
          spellCheck={false}
        />
        <p className="inspector-hint">tag 明文存储，用于本地搜索。</p>
      </div>

      <div className="inspector-section">
        <h3>状态</h3>
        <ul className="inspector-meta">
          <li>
            <span>id</span>
            <strong title={props.record?.id ?? props.draft.noteId ?? ""}>
              {props.record?.id ?? props.draft.noteId ?? "—"}
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

      {props.titleError ? (
        <p className="inspector-hint inspector-hint-error">{props.titleError}</p>
      ) : null}

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
        {props.record ? (
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
      </div>
    </aside>
  );
}

function truncate(value: string, head: number): string {
  if (value.length <= head + 4) return value;
  return `${value.slice(0, head)}…${value.slice(-4)}`;
}