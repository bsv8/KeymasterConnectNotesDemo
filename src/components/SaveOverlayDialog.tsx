// src/components/SaveOverlayDialog.tsx
// 保存阻塞遮罩：等待 Keymaster 完成保存许可的页面级模态。
//
// 设计缘由（施工单 2026-06-26 save-switch-current-editor-state 第 5.3 / 7.1 章）：
//   - 整页进入阻塞态：背后页面半透明、不可继续编辑；
//   - 两种 mode 对应不同的按钮集合：
//       - `mode: "save"`：只有 `取消`；
//       - `mode: "save-and-switch"`：`保存并切换` / `取消`；
//   - 中央提示区分"主动保存"与"保存并切换"两种触发原因；
//   - 遮罩点不到，Esc 不取消（避免用户误关——save 一旦提交就交给 Keymaster 协议去处理）；
//     想退出只能点"取消"按钮，由 App 决定是否丢弃/不切换。
//
// 不在弹层内部维护业务状态；所有动作由 App 通过 props 注入。

import { useEffect } from "react";

export interface SaveOverlayDialogProps {
  mode: "save" | "save-and-switch";
  /** 取消按钮：保留当前编辑，关闭遮罩，不切换。 */
  onCancel: () => void;
  /** "保存并切换"按钮：触发保存 → 成功后切到目标。仅 `mode === "save-and-switch"` 使用。 */
  onSaveAndSwitch?: () => void;
}

export function SaveOverlayDialog(props: SaveOverlayDialogProps) {
  // Esc 不取消遮罩——这是与 `NameInputDialog` / `confirm-dialog` 故意不同的语义。
  // 原因：用户一旦点 save 进入了 popup 流程，关闭遮罩不会取消已经在飞的协议；
  // 反而会让 UI 跟协议状态分裂。Esc 故意 no-op。
  useEffect(() => {
    // no-op；保留位置以便后续需要时加 hook。
  }, []);

  const title =
    props.mode === "save" ? "等待 Keymaster 完成保存许可" : "保存当前修改后再切换";
  const description =
    props.mode === "save"
      ? "正在向 Keymaster 请求加密保存。完成前请到弹出的窗口里完成许可操作；可随时取消。"
      : "切到目标之前，需要先把当前 note 的未保存修改加密保存。请到弹出的窗口里完成许可。";

  return (
    <div className="save-overlay" role="dialog" aria-modal="true" aria-labelledby="save-overlay-title">
      <div className="save-overlay__box" aria-live="polite">
        <div className="save-overlay__spinner" aria-hidden="true" />
        <h3 id="save-overlay-title" className="save-overlay__title">
          {title}
        </h3>
        <p className="save-overlay__description">{description}</p>
        <div className="save-overlay__actions">
          {props.mode === "save-and-switch" ? (
            <>
              <button
                type="button"
                className="primary-button"
                onClick={props.onSaveAndSwitch}
              >
                保存并切换
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={props.onCancel}
              >
                取消
              </button>
            </>
          ) : (
            <button
              type="button"
              className="secondary-button"
              onClick={props.onCancel}
            >
              取消
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
