// src/i18n/types.ts
// 多语言基础类型定义。
//
// 设计缘由（施工单 2026-06-27 005-i18n-header-language-switch 4.1 / 4.2 / 4.4 / 5.3 章）：
//   - 受支持语言固定为三种：`en` / `zh-CN` / `ja`；不引入 `auto` 作为用户可见选项，
//     但内部"持久化模式"仍保留 `auto` / `manual`。
//   - message 字典采用"每个 key 三语都必须存在"的静态方式——TypeScript 在
//     开发期暴露缺漏；运行时不再做兜底翻译（避免掩盖问题）。
//   - 所有用户可见文案 key 在这里集中列出，组件侧通过 `t(key)` 取值。
//
// 不能做的事：
//   - 把 message key 放成任意字符串无约束；
//   - 允许单门语言缺失（messages.ts 编译期必须三语齐备）；
//   - 把 `auto` 暴露为用户可见语言选项。

/** 系统支持的固定语言。 */
export type SupportedLanguage = "en" | "zh-CN" | "ja";

/** 系统支持语言的有序列表（用于语言选择器展示顺序）。 */
export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = ["en", "zh-CN", "ja"] as const;

/** 语言持久化模式：是否用户手动选择过。 */
export type LanguageMode = "auto" | "manual";

/**
 * 所有用户可见文案的 key 集合。
 *
 * 设计缘由：让 TypeScript 在编译期确保 messages.ts 完整提供每个 key 的三语版本。
 * 这里集中列出全部 key；后续扩展时**必须**在此追加并同步三语。
 */
export type MessageKey =
  // ----- 通用：app / brand -----
  | "app.brand"
  | "app.demoName"
  | "app.demoDescription"
  // ----- Lock screen -----
  | "lock.subtitle"
  | "lock.capabilities.title"
  | "lock.capabilities.identity.get"
  | "lock.capabilities.identity.get.desc"
  | "lock.capabilities.cipher.encrypt"
  | "lock.capabilities.cipher.encrypt.desc"
  | "lock.capabilities.cipher.decrypt"
  | "lock.capabilities.cipher.decrypt.desc"
  | "lock.field.target.label"
  | "lock.field.target.placeholder"
  | "lock.field.target.hint.invalid"
  | "lock.field.target.hint.normalized"
  | "lock.field.target.hint.partial"
  | "lock.field.target.title.useDefault"
  | "lock.action.useDefault"
  | "lock.action.login"
  | "lock.action.login.submitTitle"
  | "lock.action.login.opening"
  | "lock.footer"
  // ----- Header -----
  | "header.theme.label"
  | "header.theme.dark"
  | "header.theme.light"
  | "header.theme.system"
  | "header.theme.aria"
  | "header.sidebar.toggle.expand"
  | "header.sidebar.toggle.collapse"
  | "header.sidebar.toggle.open"
  | "header.sidebar.toggle.close"
  | "header.language.label"
  | "header.language.aria"
  // ----- Connect status -----
  | "connect.state.idle"
  | "connect.state.opening"
  | "connect.state.connected"
  | "connect.state.disconnected"
  | "connect.row.pageOrigin"
  | "connect.row.targetOrigin"
  | "connect.row.publicKey"
  | "connect.row.lastLogin"
  | "connect.row.publicKey.empty"
  | "connect.action.login"
  | "connect.action.forget"
  | "connect.action.forget.title"
  | "connect.action.delete"
  | "connect.action.delete.title"
  // ----- Sidebar -----
  | "sidebar.owner.eyebrow"
  | "sidebar.owner.empty"
  | "sidebar.action.newNote"
  | "sidebar.action.newNote.title"
  | "sidebar.action.newFolder"
  | "sidebar.action.newFolder.title"
  | "sidebar.search.placeholder"
  | "sidebar.tags.aria"
  | "sidebar.tag.all"
  | "sidebar.tag.empty"
  | "sidebar.tag.title"
  | "sidebar.toolbar.aria"
  | "sidebar.toolbar.eyebrow.folder"
  | "sidebar.toolbar.eyebrow.note"
  | "sidebar.toolbar.eyebrow.noteUnsaved"
  | "sidebar.toolbar.eyebrow.root"
  | "sidebar.toolbar.title.fallbackFolder"
  | "sidebar.toolbar.title.fallbackNote"
  | "sidebar.toolbar.title.unsaved"
  | "sidebar.toolbar.title.root"
  | "sidebar.toolbar.meta.updated"
  | "sidebar.toolbar.meta.unsaved"
  | "sidebar.toolbar.meta.root"
  | "sidebar.toolbar.action.deleteFolder"
  | "sidebar.toolbar.action.noteStatic"
  | "sidebar.toolbar.action.rootStatic"
  | "sidebar.expand.expandFolder"
  | "sidebar.expand.collapseFolder"
  | "sidebar.empty.noContent"
  | "sidebar.empty.pleaseLogin"
  | "sidebar.root.label"
  | "sidebar.root.name"
  | "sidebar.placeholder.folder"
  | "sidebar.placeholder.note"
  | "sidebar.note.unsavedBadge"
  | "sidebar.note.titleSaved"
  | "sidebar.note.titleUnsaved"
  | "sidebar.context.move"
  | "sidebar.context.rename"
  | "sidebar.context.delete"
  // ----- Document toolbar -----
  | "toolbar.hint.tags"
  | "toolbar.meta.status"
  | "toolbar.meta.status.value.decryptFailed"
  | "toolbar.meta.created"
  | "toolbar.meta.updated"
  | "toolbar.meta.contentType"
  | "toolbar.meta.cipher"
  | "toolbar.meta.cipher.empty"
  | "toolbar.meta.modified"
  | "toolbar.meta.modified.value"
  | "toolbar.action.save"
  | "toolbar.action.save.title.waiting"
  | "toolbar.action.save.title.decryptFailed"
  | "toolbar.action.reset"
  | "toolbar.action.delete"
  | "toolbar.action.delete.title.waiting"
  // ----- Document panel: note head -----
  | "note.title.placeholder"
  | "note.head.hint.new"
  | "note.head.hint.loading"
  | "note.head.hint.persisted"
  // ----- Document panel: folder empty -----
  | "folder.empty.title"
  | "folder.empty.description"
  | "root.empty.title"
  | "root.empty.description"
  // ----- Document panel: editor decrypt failed -----
  | "editor.decryptFailed.title"
  | "editor.decryptFailed.reason"
  | "editor.decryptFailed.note"
  // ----- Document panel: editor loading -----
  | "editor.loading.placeholder"
  // ----- Tag input -----
  | "tag.placeholder"
  | "tag.placeholder.maxSuffix"
  | "tag.hint"
  | "tag.remove.aria"
  // ----- Search results -----
  | "search.eyebrow"
  | "search.title.hasResults"
  | "search.title.noResults"
  | "search.title.noInput"
  | "search.filter.keyword"
  | "search.filter.tag"
  | "search.filter.hint"
  | "search.empty.description"
  | "search.item.titleFallback"
  // ----- Name input dialog -----
  | "nameDialog.error.empty"
  // ----- Save overlay -----
  | "saveOverlay.title.save"
  | "saveOverlay.title.saveAndSwitch"
  | "saveOverlay.description.save"
  | "saveOverlay.description.saveAndSwitch"
  | "saveOverlay.action.saveAndSwitch"
  | "saveOverlay.action.cancel"
  // ----- Common actions -----
  | "action.cancel"
  | "action.confirm"
  | "action.create"
  | "action.acknowledge"
  // ----- Error mapping -----
  | "error.protocol.invalid_request"
  | "error.protocol.invalid_origin"
  | "error.protocol.user_rejected"
  | "error.protocol.active_key_unavailable"
  | "error.protocol.decrypt_failed"
  | "error.protocol.internal_error"
  | "error.transport.popup_blocked"
  | "error.transport.popup_closed"
  | "error.transport.ready_timeout"
  | "error.transport.result_timeout"
  | "error.transport.invalid_origin"
  | "error.transport.session_busy"
  | "error.transport.no_session"
  | "error.targetOriginInvalid"
  // ----- App-level messages -----
  | "app.error.targetOriginInvalid"
  | "app.error.saveFailure.prefix"
  | "app.error.sameFolderConflict"
  | "app.error.createFolderFailed"
  | "app.error.renameFolderConflict"
  | "app.error.renameNoteConflict"
  | "app.error.deleteCurrentDataFailed"
  | "app.error.cannotSaveDecryptFailed"
  | "app.error.cannotSaveLoading"
  | "app.error.cannotSaveTitleConflict"
  | "app.error.cannotSaveTitleConflictWithName"
  | "app.banner.decryptFailed"
  | "app.banner.moveMode"
  | "app.banner.dismiss"
  | "app.folderNotEmpty.title"
  | "app.folderNotEmpty.message"
  | "app.moveFolderInvalid.title"
  | "app.moveFolderInvalid.message"
  | "app.moveNoteConflict.title"
  | "app.moveNoteConflict.message"
  | "app.deleteDataConfirm.title"
  | "app.deleteDataConfirm.message"
  | "app.deleteDataConfirm.confirm"
  | "app.deleteDataConfirm.cancel"
  | "app.newFolderDialog.title"
  | "app.newFolderDialog.description"
  | "app.newFolderDialog.placeholder"
  | "app.newFolderDialog.confirmLabel"
  | "app.renameFolderDialog.title"
  | "app.renameFolderDialog.description"
  | "app.renameFolderDialog.placeholder"
  | "app.renameFolderDialog.confirmLabel"
  | "app.renameNoteDialog.title"
  | "app.renameNoteDialog.description"
  | "app.renameNoteDialog.placeholder"
  | "app.renameNoteDialog.confirmLabel"
  | "app.renameFolderConflictInline"
  | "app.renameNoteConflictInline"
  | "app.defaultNoteBaseName"
  | "app.defaultFolderBaseName"
  | "app.encrypt.requestText"
  | "app.identity.requestText"
  | "drag.reason.drop_to_note"
  | "drag.reason.drop_to_self"
  | "drag.reason.drop_to_descendant"
  | "drag.reason.drop_to_missing_source"
  | "titleError.empty"
  | "common.value.notAvailable";

/**
 * 字典类型：每个 key 三语都必须存在。
 *
 * 设计缘由：使用 `Record<MessageKey, ...>` 在开发期暴露任意遗漏；
 * 同时把 `language` 作为 `SupportedLanguage` 严格收口，避免运行时出现
 * 不在 SUPPORTED_LANGUAGES 列表里的 key。
 */
export type Messages = Record<SupportedLanguage, Record<MessageKey, string>>;

/**
 * 自插值上下文：把数字 / 字符串变量注入到字典里。
 * 设计缘由：保留最小插值能力（搜索结果数等），但不引入模板引擎。
 */
export interface InterpolationValues {
  [key: string]: string | number;
}

/** 语言展示名称（按各自语言自称）。 */
export const LANGUAGE_DISPLAY: Record<SupportedLanguage, string> = {
  en: "English",
  "zh-CN": "简体中文",
  ja: "日本語"
};