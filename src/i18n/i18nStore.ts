// src/i18n/i18nStore.ts
// 语言状态单真值：localStorage 持久化 + 浏览器语言解析 + `<html lang>` 同步 + 订阅。
//
// 设计缘由（施工单 2026-06-27 005-i18n-header-language-switch 4.2 / 4.5 / 5.1 / 5.2 / 5.5 章）：
//   - 语言持久化只暴露"auto / manual"两种模式，但用户只能切到 manual；
//     auto 仅用于"首次进入且无记录"时的浏览器语言回退。
//   - localStorage 失败时**不**抛错、不阻断；按当前运行时解析语言继续走。
//   - `<html lang>` 与当前语言同步——首屏前就写入，避免浏览器读到错误的 lang。
//   - 提供订阅能力（subscribe / getSnapshot）给 React hook 使用。
//
// 不能做的事：
//   - 把 React hook 写在这里；
//   - 让组件直接依赖本文件内部细节；
//   - localStorage 失败时抛错阻断应用。

import { resolveBrowserLanguage, resolveLanguageTag } from "./languageMap";
import type { LanguageMode, SupportedLanguage } from "./types";

const LANGUAGE_STORAGE_KEY = "notes-demo:language";
const HTML_LANG_DEFAULT = "en";

interface PersistedLanguage {
  language: SupportedLanguage;
  mode: LanguageMode;
}

/**
 * 从 localStorage 读取上次手动选择的语言。
 * 失败 / 非法 / 不存在 → 返回 null（让上层决定是否走浏览器语言）。
 */
export function loadPersistedLanguage(): PersistedLanguage | null {
  try {
    const raw = globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.language !== "string") return null;
    if (obj.mode !== "manual") return null;
    const language = resolveLanguageTag(obj.language);
    return { language, mode: "manual" };
  } catch {
    return null;
  }
}

/** 写入持久化语言；失败静默忽略。 */
function savePersistedLanguage(value: PersistedLanguage): void {
  try {
    globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // best-effort：写入失败不影响当前会话语言切换。
  }
}

/** 把当前语言写到 `<html lang="..."`。 */
export function applyHtmlLang(language: SupportedLanguage): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
}

/* ============== 订阅式 store ============== */

type Listener = () => void;

interface I18nStore {
  getLanguage(): SupportedLanguage;
  getMode(): LanguageMode;
  /** 切换语言：立即落 store + 同步 `<html lang>` + 持久化 + 通知订阅者。 */
  setLanguage(language: SupportedLanguage): void;
  /** 重新订阅；返回退订函数。 */
  subscribe(listener: Listener): () => void;
}

class LanguageStore implements I18nStore {
  private language: SupportedLanguage;
  private mode: LanguageMode;
  private listeners: Set<Listener> = new Set();

  constructor(initial: SupportedLanguage, mode: LanguageMode) {
    this.language = initial;
    this.mode = mode;
    // 立刻把 `<html lang>` 落到当前语言上。
    applyHtmlLang(initial);
  }

  getLanguage(): SupportedLanguage {
    return this.language;
  }

  getMode(): LanguageMode {
    return this.mode;
  }

  setLanguage(language: SupportedLanguage): void {
    if (this.language === language && this.mode === "manual") return;
    this.language = language;
    this.mode = "manual";
    applyHtmlLang(language);
    savePersistedLanguage({ language, mode: "manual" });
    for (const l of this.listeners) l();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/**
 * 决定首屏语言：手动 > 浏览器 > 默认。
 * 不会抛错；任何异常路径都回退到 `en`。
 */
export function resolveInitialLanguage(): {
  language: SupportedLanguage;
  mode: LanguageMode;
} {
  const persisted = loadPersistedLanguage();
  if (persisted) return persisted;
  try {
    const fromBrowser = resolveBrowserLanguage();
    return { language: fromBrowser, mode: "auto" };
  } catch {
    return { language: HTML_LANG_DEFAULT as SupportedLanguage, mode: "auto" };
  }
}

/* ============== 单例 store ============== */

let storeSingleton: LanguageStore | null = null;

/**
 * 取得唯一的语言 store。
 *
 * 重要：第一次调用时**必须**传入"已经按持久化 / 浏览器解析规则算好"的语言。
 * 推荐由 `main.tsx` 在 React 挂载前调用 `resolveInitialLanguage()` 后再调用本函数。
 */
export function getI18nStore(initial?: { language: SupportedLanguage; mode: LanguageMode }): I18nStore {
  if (!storeSingleton) {
    const seed = initial ?? resolveInitialLanguage();
    storeSingleton = new LanguageStore(seed.language, seed.mode);
  } else if (initial) {
    // 已被 main.tsx 预先构造过；这里不会再触发 reset。
  }
  return storeSingleton;
}

/** 仅供测试 / 调试使用——重置单例。 */
export function __resetI18nStoreForTest(): void {
  storeSingleton = null;
}