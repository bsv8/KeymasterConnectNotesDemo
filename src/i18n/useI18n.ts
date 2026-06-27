// src/i18n/useI18n.ts
// React hook：把 store 暴露给组件。
//
// 设计缘由（施工单 2026-06-27 005-i18n-header-language-switch 4.5 / 8.5 章）：
//   - 用 `useSyncExternalStore` 订阅 store；React 18+ 稳定且不会撕裂。
//   - 暴露：
//       - `t(key, values?)`：取当前语言文案；自动插值；
//       - `language`：当前语言；
//       - `setLanguage`：切换语言；
//   - **不**在 hook 里夹带任何与语言无关的业务逻辑。

import { useCallback, useSyncExternalStore } from "react";
import { getI18nStore } from "./i18nStore";
import { interpolate, messages } from "./messages";
import type { InterpolationValues, MessageKey, SupportedLanguage } from "./types";

export interface UseI18nResult {
  /** 当前语言。 */
  language: SupportedLanguage;
  /** 取当前语言文案；可选插值（`{name}` 风格）。 */
  t: (key: MessageKey, values?: InterpolationValues) => string;
  /** 切换语言（自动写入持久化 + 同步 `<html lang>` + 通知订阅者）。 */
  setLanguage: (language: SupportedLanguage) => void;
}

export function useI18n(): UseI18nResult {
  const store = getI18nStore();

  const language = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getLanguage(),
    () => store.getLanguage()
  );

  const t = useCallback(
    (key: MessageKey, values?: InterpolationValues): string => {
      const template = messages[language][key];
      return interpolate(template, values);
    },
    [language]
  );

  const setLanguage = useCallback(
    (next: SupportedLanguage) => {
      store.setLanguage(next);
    },
    [store]
  );

  return { language, t, setLanguage };
}