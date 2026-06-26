// src/components/NameInputDialog.tsx
// 页面中央命名输入弹层：复用"输入一个名称并校验"语义，覆盖：
//   - 新建文件夹；
//   - 重命名文件夹；
//   - 重命名 note。
//
// 设计缘由（施工单 2026-06-26 save-tag-folder-ux 第 4.5 / 4.6 / 6.8 / 6.9 章）：
//   - 不再用 `window.prompt`；风格 / 焦点 / 键盘行为统一收口到页面内弹层。
//   - 自动聚焦输入框、支持回车确认、Esc 取消。
//   - inline 校验：`trim` 后非空；与同目录已有重名时阻断并展示错误文案。
//   - **不**复用"自动补编号"——重命名场景禁止偷偷改用户提交的名字。
//   - 取消 / 关闭时不改任何外部状态。

import { useEffect, useRef, useState } from "react";

export interface NameInputDialogProps {
  /** 弹层标题，例如 "新建文件夹" / "重命名文件夹"。 */
  title: string;
  /** 弹层说明文案（可选）。 */
  description?: string;
  /** 输入框初始值（重命名时为已有名字，新建时为预填基名）。 */
  initialValue: string;
  /** 输入框 placeholder。 */
  placeholder?: string;
  /** 确认按钮文案，默认 "确认"。 */
  confirmLabel?: string;
  /** 取消按钮文案，默认 "取消"。 */
  cancelLabel?: string;
  /**
   * 自定义校验：返回 `null` 表示通过；返回字符串为 inline 错误文案。
   * 调用方（App）在此判断重名 / 业务合法性。
   * 注意：弹层**不**做自动补编号；返回错误即阻断。
   */
  validate?: (value: string) => string | null;
  /** 确认回调：拿到的是 `trim` 后的最终值。 */
  onConfirm: (value: string) => void;
  /** 取消 / 关闭回调：包括 Esc、点遮罩、点取消按钮。 */
  onCancel: () => void;
}

export function NameInputDialog(props: NameInputDialogProps) {
  const [value, setValue] = useState(props.initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // mount 时自动聚焦 + 选中全部（用户可立即覆盖）。
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  /**
   * 弹层级键盘行为：Esc 取消。
   *
   * 设计缘由（施工单 2026-06-26 save-tag-folder-ux 第 4.5 / 4.6 章）：
   *   - Esc 必须在**整个弹层**范围内生效，不能只绑在输入框 keydown 上；
   *   - 否则一旦焦点切到"取消 / 确认"按钮，Esc 就失效了——这与
   *     "Esc 取消弹层"的预期行为不一致。
   *   - 这里走 `window` 级别的 keydown：弹层 mount → 挂监听；unmount → 摘监听。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onCancel]);

  function tryConfirm() {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setError("名称不能为空。");
      return;
    }
    const inline = props.validate?.(trimmed);
    if (inline) {
      setError(inline);
      return;
    }
    props.onConfirm(trimmed);
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      tryConfirm();
      return;
    }
    // Esc 由弹层级全局监听处理；这里不重复绑定。
  }

  // 点遮罩取消。
  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) {
      props.onCancel();
    }
  }

  return (
    <div
      className="name-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="name-dialog-title"
      onClick={handleBackdropClick}
    >
      <div className="name-dialog__box">
        <h3 id="name-dialog-title" className="name-dialog__title">
          {props.title}
        </h3>
        {props.description ? (
          <p className="name-dialog__description">{props.description}</p>
        ) : null}
        <input
          ref={inputRef}
          type="text"
          className="name-dialog__input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            // 用户开始改后清掉旧错误，避免误导。
            if (error) setError(null);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder={props.placeholder}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? "true" : undefined}
        />
        {error ? (
          <p className="name-dialog__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="name-dialog__actions">
          <button
            type="button"
            className="secondary-button"
            onClick={props.onCancel}
          >
            {props.cancelLabel ?? "取消"}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={tryConfirm}
          >
            {props.confirmLabel ?? "确认"}
          </button>
        </div>
      </div>
    </div>
  );
}