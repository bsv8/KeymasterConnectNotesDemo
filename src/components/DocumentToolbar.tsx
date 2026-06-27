// src/components/DocumentToolbar.tsx
// 文档区顶部 Notion 风格工具条。
//
// 设计缘由（施工单 2026-06-27 notion-document-toolbar-and-mobile-sidebar
//          第 4.3 / 4.4 / 4.5 / 8.4 章）：
//   - **两排**，不采用三排；克制优先于堆功能。
//   - 第一排：tag 排：仅 TagInput + 弱化说明文案。
//   - 第二排：状态与动作排：左侧紧凑状态信息；右侧动作按钮组（同一排）。
//   - **不**承载 title 编辑——title 属于 document-head，视觉上与正文同轴线。
//   - **不**引入 BlockNote 格式化按钮（粗体、标题、列表等），本单明确禁止。
//   - 不承担业务真值；调用方（App）继续持有 state，本组件只接收 prop / 触发回调。
//   - save / delete / reset 亮灭规则与旧 NoteInspector 保持一致：
//       - title 合法 + dirty + 非 decryptFailed + 非 saving → 加密保存可点；
//       - decryptFailed / saving 时整组禁用；
//       - 删除永远允许（不锁）。
//   - `decryptFailed` 时：tag / save 禁用，状态排显示"解密失败"摘要，删除仍可点。

import { useMemo } from "react";
import type { NoteDraft, StoredNoteRecord } from "../lib/notes";
import { validateTitle } from "../lib/notes";
import { TagInput } from "./TagInput";

export interface DocumentToolbarProps {
  /** 当前 note draft；为 null 时不渲染整条工具条（folder / root 场景）。 */
  draft: NoteDraft | null;
  /** 当前 note 已持久化 record；新建态时为 null。 */
  record: StoredNoteRecord | null;
  /** 当前 note 是否解密失败。 */
  decryptFailed: boolean;
  /** 是否有未保存修改。 */
  isDirty: boolean;
  /** App 是否处于保存阻塞态。 */
  isSaving: boolean;
  /** title 校验失败提示。 */
  titleError: string | null;
  /** 是否允许编辑元数据（tag）；decryptFailed / saving / 未登录时为 false。 */
  canEdit: boolean;
  /** 是否允许删除。 */
  canDelete: boolean;
  onChangeTags: (tags: string[]) => void;
  onSave: () => void;
  onDelete: () => void;
  onReset: () => void;
}

export function DocumentToolbar(props: DocumentToolbarProps) {
  if (!props.draft) return null;
  const { draft } = props;

  const titleCheck = useMemo(() => validateTitle(draft.title), [draft.title]);
  const canSave =
    !props.decryptFailed && !props.isSaving && props.canEdit && titleCheck.ok && props.isDirty;

  const created = props.record ? new Date(props.record.createdAt).toLocaleString() : "—";
  const updated = props.record ? new Date(props.record.updatedAt).toLocaleString() : "—";
  const contentType = props.record?.cipher.contentType ?? "—";
  const cipherLength = props.record
    ? `${props.record.cipher.cipherbytesBase64.length} b64`
    : "尚未保存";
  const dirtyBadge = props.isDirty ? "（未保存）" : "";

  return (
    <div className="document-toolbar">
      {/* 第一排：tag 排 */}
      <div className="document-toolbar__row document-toolbar__row--tags">
        <div className="document-toolbar__tags">
          <TagInput
            value={draft.tags}
            onChange={props.onChangeTags}
            disabled={!props.canEdit}
          />
        </div>
        <p className="document-toolbar__hint">tag 明文存储，仅用于本地搜索</p>
      </div>

      {/* 第二排：状态与动作排 */}
      <div className="document-toolbar__row document-toolbar__row--actions">
        <ul className="document-toolbar__meta" aria-label="note 状态">
          {props.decryptFailed ? (
            <li className="is-warning">
              <span>状态</span>
              <strong>解密失败</strong>
            </li>
          ) : null}
          <li>
            <span>created</span>
            <strong>{created}</strong>
          </li>
          <li>
            <span>updated</span>
            <strong>{updated}</strong>
          </li>
          <li>
            <span>contentType</span>
            <strong>{contentType}</strong>
          </li>
          <li>
            <span>密文</span>
            <strong>{cipherLength}</strong>
          </li>
          {dirtyBadge ? (
            <li className="is-warning">
              <span>修改</span>
              <strong>{dirtyBadge}</strong>
            </li>
          ) : null}
        </ul>
        <div className="document-toolbar__actions">
          <button
            type="button"
            className="primary-button"
            onClick={props.onSave}
            disabled={!canSave}
            title={
              props.isSaving
                ? "正在等待 Keymaster 许可"
                : props.decryptFailed
                  ? "解密失败，禁止覆盖密文"
                  : undefined
            }
          >
            加密保存
          </button>
          {props.isDirty ? (
            <button
              type="button"
              className="secondary-button"
              onClick={props.onReset}
              disabled={!props.canEdit || props.isSaving}
            >
              放弃修改
            </button>
          ) : null}
          {props.record ? (
            <button
              type="button"
              className="secondary-button document-toolbar__danger"
              onClick={props.onDelete}
              disabled={!props.canDelete}
              title={props.isSaving ? "正在等待 Keymaster 许可" : undefined}
            >
              删除
            </button>
          ) : null}
        </div>
      </div>

      {props.titleError ? (
        <p className="document-toolbar__error">{props.titleError}</p>
      ) : null}
    </div>
  );
}
