// src/components/DocumentToolbar.tsx
// 文档区顶部 tag 工具条。
//
// 设计缘由：
//   - tag 仍然属于文档元数据，应继续放在标题上方；
//   - created / updated / contentType / 密文长度等信息移除，不再占正文前的垂直空间；
//   - 保存入口迁到正文格式工具栏；删除入口迁到 sidebar 当前文件信息块；
//   - 本组件只保留 tag 编辑和 title 校验提示，不再承载其它业务动作。

import type { NoteDraft } from "../lib/notes";
import { TagInput } from "./TagInput";
import { useI18n } from "../i18n/useI18n";

export interface DocumentToolbarProps {
  /** 当前 note draft；为 null 时不渲染整条工具条（folder / root 场景）。 */
  draft: NoteDraft | null;
  /** title 校验失败提示。 */
  titleError: string | null;
  /** 是否允许编辑元数据（tag）；decryptFailed / saving / 未登录时为 false。 */
  canEdit: boolean;
  onChangeTags: (tags: string[]) => void;
}

export function DocumentToolbar(props: DocumentToolbarProps) {
  const { t } = useI18n();
  if (!props.draft) return null;

  return (
    <div className="document-toolbar">
      <div className="document-toolbar__row document-toolbar__row--tags">
        <div className="document-toolbar__tags">
          <TagInput
            value={props.draft.tags}
            onChange={props.onChangeTags}
            disabled={!props.canEdit}
          />
        </div>
        <p className="document-toolbar__hint">{t("toolbar.hint.tags")}</p>
      </div>

      {props.titleError ? (
        <p className="document-toolbar__error">{props.titleError}</p>
      ) : null}
    </div>
  );
}
