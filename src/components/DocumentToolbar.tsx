// src/components/DocumentToolbar.tsx
// 文档区顶部 Notion 风格工具条。
//
// 设计缘由（施工单 2026-06-27 notion-document-toolbar-and-mobile-sidebar
//          第 4.3 / 4.4 / 4.5 / 8.4 章 +
//          施工单 2026-06-27 005-i18n-header-language-switch 8.11 章）：
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
//   - 所有用户可见文案走 i18n 字典；日期跟随当前语言。

import { useMemo } from "react";
import type { NoteDraft, StoredNoteRecord } from "../lib/notes";
import { validateTitle } from "../lib/notes";
import { TagInput } from "./TagInput";
import { useI18n } from "../i18n/useI18n";

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
  const { t, language } = useI18n();
  if (!props.draft) return null;
  const { draft } = props;

  const titleCheck = useMemo(() => validateTitle(draft.title), [draft.title]);
  const canSave =
    !props.decryptFailed && !props.isSaving && props.canEdit && titleCheck.ok && props.isDirty;

  const created = props.record ? new Date(props.record.createdAt).toLocaleString(language) : "—";
  const updated = props.record ? new Date(props.record.updatedAt).toLocaleString(language) : "—";
  const contentType = props.record?.cipher.contentType ?? "—";
  const cipherLength = props.record
    ? `${props.record.cipher.cipherbytesBase64.length} b64`
    : t("toolbar.meta.cipher.empty");
  const dirtyBadge = props.isDirty ? t("toolbar.meta.modified.value") : "";

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
        <p className="document-toolbar__hint">{t("toolbar.hint.tags")}</p>
      </div>

      {/* 第二排：状态与动作排 */}
      <div className="document-toolbar__row document-toolbar__row--actions">
        <ul className="document-toolbar__meta" aria-label={t("toolbar.meta.status")}>
          {props.decryptFailed ? (
            <li className="is-warning">
              <span>{t("toolbar.meta.status")}</span>
              <strong>{t("toolbar.meta.status.value.decryptFailed")}</strong>
            </li>
          ) : null}
          <li>
            <span>{t("toolbar.meta.created")}</span>
            <strong>{created}</strong>
          </li>
          <li>
            <span>{t("toolbar.meta.updated")}</span>
            <strong>{updated}</strong>
          </li>
          <li>
            <span>{t("toolbar.meta.contentType")}</span>
            <strong>{contentType}</strong>
          </li>
          <li>
            <span>{t("toolbar.meta.cipher")}</span>
            <strong>{cipherLength}</strong>
          </li>
          {dirtyBadge ? (
            <li className="is-warning">
              <span>{t("toolbar.meta.modified")}</span>
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
                ? t("toolbar.action.save.title.waiting")
                : props.decryptFailed
                  ? t("toolbar.action.save.title.decryptFailed")
                  : undefined
            }
          >
            {t("toolbar.action.save")}
          </button>
          {props.isDirty ? (
            <button
              type="button"
              className="secondary-button"
              onClick={props.onReset}
              disabled={!props.canEdit || props.isSaving}
            >
              {t("toolbar.action.reset")}
            </button>
          ) : null}
          {props.record ? (
            <button
              type="button"
              className="secondary-button document-toolbar__danger"
              onClick={props.onDelete}
              disabled={!props.canDelete}
              title={props.isSaving ? t("toolbar.action.delete.title.waiting") : undefined}
            >
              {t("toolbar.action.delete")}
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