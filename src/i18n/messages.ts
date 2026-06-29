// src/i18n/messages.ts
// 全部用户可见文案的三语字典。
//
// 设计缘由（施工单 2026-06-27 005-i18n-header-language-switch 4.4 / 5.3 / 8.4 章）：
//   - 集中维护全部 key 的 `en` / `zh-CN` / `ja` 版本；
//   - 每个 key 三语都必须存在；TS 编译期会暴露缺口；
//   - 允许少量插值（`{name}` / `{count}` 等），但**不**引入模板引擎；
//   - 不拆 namespace，不做懒加载；
//   - 协议 code / 内部状态值不进入这里——只翻译"展示给用户看的说明文案"。
//
// 这里列出的 key 必须与 `types.ts` 的 `MessageKey` 完全一致。

import type { Messages } from "./types";

export const messages: Messages = {
  en: {
    // ----- 通用：app / brand -----
    "app.brand": "Keymaster Notes",
    "app.demoName": "Notes Demo",
    "app.demoDescription":
      "Encrypted notes workspace built on connect session and cipher.* — actually calls connect.* + cipher.* on the Keymaster provider.",
    // ----- Lock screen -----
    "lock.subtitle":
      "An encrypted notes workspace built on connect.session and cipher.*. All note content is encrypted by the Keymaster provider; this demo only consumes the protocol.",
    "lock.capabilities.title": "Required protocol capabilities",
    "lock.capabilities.cipher.encrypt":
      "cipher.encrypt",
    "lock.capabilities.cipher.encrypt.desc":
      "Encrypt note markdown UTF-8 bytes into nonce + cipherbytes on save.",
    "lock.capabilities.cipher.decrypt":
      "cipher.decrypt",
    "lock.capabilities.cipher.decrypt.desc":
      "Decrypt the ciphertext back into plain markdown when opening a note.",
    "lock.capabilities.connect.login": "connect.login",
    "lock.capabilities.connect.login.desc":
      "Sign in and select a key; the session is bound to that key and is used by every later cipher call.",
    "lock.capabilities.connect.resume": "connect.resume",
    "lock.capabilities.connect.resume.desc":
      "Restore the previously authorized session after refresh, popup close, or transport reconnect.",
    "lock.capabilities.connect.logout": "connect.logout",
    "lock.capabilities.connect.logout.desc":
      "Explicitly revoke the current session. Only this path returns the user to the sign-in shell.",
    "lock.field.target.label": "Target origin / URL",
    "lock.field.target.placeholder": "e.g. {defaultOrigin}",
    "lock.field.target.hint.invalid":
      "Invalid target origin: must be a string that resolves to a URL origin.",
    "lock.field.target.hint.normalized": "Will use origin: {origin}",
    "lock.field.target.hint.partial":
      "You may enter a full URL; only the origin part is used.",
    "lock.field.target.title.useDefault": "Fill in default: {defaultOrigin}",
    "lock.action.useDefault": "Use default address",
    "lock.action.login": "Sign in",
    "lock.action.login.submitTitle": "Please enter a target origin / URL",
    "lock.action.login.opening": "Opening popup...",
    "lock.action.relogin": "Sign in again",
    "lock.action.relogin.opening": "Opening popup...",
    "lock.action.resume": "Resume session",
    "lock.action.resume.opening": "Resuming session...",
    "lock.status.resuming": "Resuming session...",
    "lock.status.resuming.description":
      "A previously authorized connect session is being restored. You may be asked to unlock the popup.",
    "lock.status.resumeFailed": "Resume failed",
    "lock.status.resumeFailed.description":
      "The saved session is no longer valid. Please sign in again to obtain a new session.",
    "lock.footer":
      "The demo persists the connect session id (no password, no popup unlock material). On refresh it tries to resume the session first; explicit logout returns to the sign-in shell. Notes data is partitioned locally by the bound owner's publicKey.",
    // ----- Header -----
    "header.theme.label": "Theme",
    "header.theme.dark": "Dark",
    "header.theme.light": "Light",
    "header.theme.system": "Follow system",
    "header.theme.aria": "Select theme",
    "header.sidebar.toggle.expand": "Collapse file tree",
    "header.sidebar.toggle.collapse": "Expand file tree",
    "header.sidebar.toggle.open": "Open tree",
    "header.sidebar.toggle.close": "Close tree",
    "header.language.label": "Language",
    "header.language.aria": "Select language",
    // ----- Connect status -----
    "connect.state.idle": "Not connected",
    "connect.state.opening": "Opening popup...",
    "connect.state.connected": "Ready",
    "connect.state.disconnected": "Disconnected",
    "connect.row.pageOrigin": "page origin",
    "connect.row.targetOrigin": "target origin",
    "connect.row.publicKey": "publicKey",
    "connect.row.lastLogin": "last login",
    "connect.row.publicKey.empty": "Not signed in",
    "connect.row.sessionId": "sessionId",
    "connect.row.sessionId.empty": "No session",
    "connect.action.login": "Sign in again",
    "connect.action.login.title":
      "Start a brand-new connect.login flow; this abandons the current resume attempt",
    "connect.action.resume": "Resume session",
    "connect.action.resume.title":
      "Re-open the popup and call connect.resume with the saved sessionId",
    "connect.action.forget": "Switch identity / change provider",
    "connect.action.forget.title": "Return to login shell; local data is kept",
    "connect.action.delete": "Delete current local data",
    "connect.action.delete.title":
      "Delete all local notes data for the current publicKey and exit the workspace; the Keymaster identity itself is not removed",
    "connect.action.logout": "Sign out",
    "connect.action.logout.title":
      "Call connect.logout to revoke the current session and return to the sign-in shell",
    "connect.action.logout.dialogTitle": "Sign out of this session?",
    "connect.action.logout.dialogMessage":
      "The connect session will be revoked on the Keymaster side and removed from this device. Local notes data is not deleted by this action.",
    "connect.action.logout.confirm": "Sign out",
    "connect.action.logout.cancel": "Cancel",
    // ----- Sidebar -----
    "sidebar.owner.eyebrow": "Notes",
    "sidebar.owner.empty": "Not signed in",
    "sidebar.action.newNote": "+ note",
    "sidebar.action.newNote.title": "Create a note in the current selection",
    "sidebar.action.newFolder": "+ folder",
    "sidebar.action.newFolder.title": "Create a folder in the current selection",
    "sidebar.search.placeholder": "Search by file name",
    "sidebar.tags.aria": "tag filter",
    "sidebar.tag.all": "All",
    "sidebar.tag.empty": "No tags",
    "sidebar.tag.title": "Only show notes tagged #{tag}",
    "sidebar.toolbar.aria": "Current selection info",
    "sidebar.toolbar.eyebrow.folder": "Current folder",
    "sidebar.toolbar.eyebrow.note": "Current file",
    "sidebar.toolbar.eyebrow.noteUnsaved": "Current file",
    "sidebar.toolbar.eyebrow.root": "Current selection",
    "sidebar.toolbar.title.fallbackFolder": "Untitled folder",
    "sidebar.toolbar.title.fallbackNote": "Untitled note",
    "sidebar.toolbar.title.unsaved": "Unsaved file",
    "sidebar.toolbar.title.root": "Root",
    "sidebar.toolbar.meta.updated": "updated {time}",
    "sidebar.toolbar.meta.unsaved": "This file is not saved yet",
    "sidebar.toolbar.meta.root": "No folder or file selected",
    "sidebar.toolbar.action.deleteFolder": "Delete folder",
    "sidebar.toolbar.action.noteStatic": "Current is a file",
    "sidebar.toolbar.action.rootStatic": "No folder to delete",
    "sidebar.expand.expandFolder": "Expand folder",
    "sidebar.expand.collapseFolder": "Collapse folder",
    "sidebar.empty.noContent": "No content yet",
    "sidebar.empty.pleaseLogin": "Please sign in first",
    "sidebar.root.label": "/",
    "sidebar.root.name": "Root",
    "sidebar.placeholder.folder": "Untitled folder",
    "sidebar.placeholder.note": "Untitled note",
    "sidebar.note.unsavedBadge": "Unsaved",
    "sidebar.note.titleSaved": "{title}",
    "sidebar.note.titleUnsaved": "{title} (unsaved)",
    "sidebar.context.move": "Move...",
    "sidebar.context.rename": "Rename",
    "sidebar.context.delete": "Delete",
    // ----- Document toolbar -----
    "toolbar.hint.tags": "Tags are stored in plaintext, used only for local search",
    "toolbar.meta.status": "Status",
    "toolbar.meta.status.value.decryptFailed": "Decrypt failed",
    "toolbar.meta.created": "created",
    "toolbar.meta.updated": "updated",
    "toolbar.meta.contentType": "contentType",
    "toolbar.meta.cipher": "ciphertext",
    "toolbar.meta.cipher.empty": "Not saved yet",
    "toolbar.meta.modified": "Modified",
    "toolbar.meta.modified.value": "(unsaved)",
    "toolbar.action.save": "Encrypt and save",
    "toolbar.action.save.title.waiting": "Waiting for Keymaster approval",
    "toolbar.action.save.title.decryptFailed": "Decrypt failed; cannot overwrite ciphertext",
    "toolbar.action.reset": "Discard changes",
    "toolbar.action.delete": "Delete",
    "toolbar.action.delete.title.waiting": "Waiting for Keymaster approval",
    // ----- Document panel: note head -----
    "note.title.placeholder": "Untitled note",
    "note.head.hint.new": "New note (not saved yet)",
    "note.head.hint.loading": "Decrypting content from Keymaster...",
    "note.head.hint.persisted": "File name (saved as part of the note record)",
    // ----- Document panel: folder empty -----
    "folder.empty.title": "Selected folder: {title}",
    "folder.empty.description":
      "Folder actions are on the left toolbar. To rename, right-click the folder → Rename.",
    "root.empty.title": "Select or create a note",
    "root.empty.description":
      "Pick a folder or note on the left; right-click a folder to create / delete / move; right-click a note to rename / move / delete.",
    // ----- Document panel: editor decrypt failed -----
    "editor.decryptFailed.title": "Cannot decrypt",
    "editor.decryptFailed.reason":
      "This note's ciphertext cannot be opened with the current origin or active key. Possible causes: origin change, active key change, or corrupted ciphertext.",
    "editor.decryptFailed.note":
      "The note is still here; metadata is visible but the body cannot be edited.",
    // ----- Document panel: editor loading -----
    "editor.loading.placeholder": "(Decrypting...)",
    // ----- Tag input -----
    "tag.placeholder": "Type a tag, press Enter to commit",
    "tag.placeholder.maxSuffix": " (max {max})",
    "tag.hint":
      "Press Enter, half-width comma, full-width comma, or space to commit; up to {maxTags} tags, each ≤ {maxLength} characters.",
    "tag.remove.aria": "Remove tag {tag}",
    // ----- Search results -----
    "search.eyebrow": "Search results",
    "search.title.hasResults": "{count} result(s)",
    "search.title.noResults": "No matching results",
    "search.title.noInput": "Enter a keyword or pick a tag",
    "search.filter.keyword": "keyword",
    "search.filter.tag": "tag",
    "search.filter.hint":
      "The left search box / tag buttons drive this page.",
    "search.empty.description":
      "No notes match the current filters. Try a different keyword or clear the tag filter.",
    "search.item.titleFallback": "Untitled note",
    // ----- Name input dialog -----
    "nameDialog.error.empty": "Name cannot be empty.",
    // ----- Save overlay -----
    "saveOverlay.title.save": "Waiting for Keymaster to finish save approval",
    "saveOverlay.title.saveAndSwitch":
      "Save current changes before switching",
    "saveOverlay.description.save":
      "Requesting an encrypted save from Keymaster. Please complete the approval in the popup window before closing; you can cancel at any time.",
    "saveOverlay.description.saveAndSwitch":
      "Before switching, the current note's unsaved changes must be encrypted and saved. Please complete the approval in the popup window.",
    "saveOverlay.action.saveAndSwitch": "Save and switch",
    "saveOverlay.action.cancel": "Cancel",
    // ----- Common actions -----
    "action.cancel": "Cancel",
    "action.confirm": "Confirm",
    "action.create": "Create",
    "action.acknowledge": "Got it",
    // ----- Error mapping -----
    "error.protocol.invalid_request": "Invalid request",
    "error.protocol.invalid_origin": "Invalid origin",
    "error.protocol.user_rejected": "User cancelled in Keymaster",
    "error.protocol.active_key_unavailable":
      "No active key available in the current Keymaster",
    "error.protocol.decrypt_failed":
      "Decrypt failed (origin or active key may have changed)",
    "error.protocol.internal_error": "Keymaster internal error",
    "error.transport.popup_blocked": "Popup was blocked by the browser",
    "error.transport.popup_closed": "Popup was closed before protocol completion",
    "error.transport.ready_timeout": "Timed out waiting for popup ready",
    "error.transport.result_timeout": "Timed out waiting for result",
    "error.transport.invalid_origin": "Message origin is invalid",
    "error.transport.session_busy": "Popup session is busy",
    "error.transport.no_session": "No session",
    "error.targetOriginInvalid": "Invalid target origin.",
    // ----- App-level messages -----
    "app.error.targetOriginInvalid": "Invalid target origin.",
    "app.error.saveFailure.prefix": "Save failed: ",
    "app.error.sameFolderConflict":
      'Save failed: a note named "{name}" already exists in the current folder.',
    "app.error.createFolderFailed": "Create folder failed: unknown reason.",
    "app.error.renameFolderConflict":
      "Rename failed: a folder with the same name already exists in this parent.",
    "app.error.renameNoteConflict":
      "Rename failed: a note with the same name already exists in this folder.",
    "app.error.deleteCurrentDataFailed":
      "Failed to delete current local data. Please try again.",
    "app.error.cannotSaveDecryptFailed":
      "This note failed to decrypt and cannot be re-encrypted. Delete it or switch origin / active key and retry.",
    "app.error.cannotSaveLoading":
      "This note is still decrypting and cannot be saved. Please wait for decryption to finish.",
    "app.error.cannotSaveTitleConflict":
      "Save failed: ",
    "app.error.cannotSaveTitleConflictWithName":
      'Save failed: a note named "{name}" already exists in the current folder.',
    "app.error.connectSessionInvalid":
      "The saved connect session is no longer valid. Please sign in again.",
    "app.error.connectLogoutFailed":
      "Sign-out failed. The local session has been cleared anyway; if the server still holds it, you can resume once and then sign out again.",
    "app.banner.decryptFailed":
      "Current note failed to decrypt: {error}. Editing is locked; delete this note or switch back to the original origin / active key and retry.",
    "app.banner.moveMode":
      "Move mode: click a target folder or the root to complete the move.",
    "app.banner.dismiss": "Got it",
    "app.folderNotEmpty.title": "Folder is not empty; cannot delete",
    "app.folderNotEmpty.message":
      "Recursive delete is not supported in this version. Please empty the folder first.",
    "app.moveFolderInvalid.title": "Cannot move folder",
    "app.moveFolderInvalid.message":
      "Target location is invalid, or a folder with the same name already exists in the target.",
    "app.moveNoteConflict.title": "Cannot move note",
    "app.moveNoteConflict.message":
      "A note with the same name already exists in the target folder. Rename the file or pick a different target folder.",
    "app.deleteDataConfirm.title": "Confirm deleting current local data?",
    "app.deleteDataConfirm.message":
      "This will delete all local notes data for the current publicKey and immediately exit the workspace.\nOnly the data in this browser for this site is affected; the Keymaster identity itself is not removed.\nThis cannot be undone.",
    "app.deleteDataConfirm.confirm": "Delete and exit",
    "app.deleteDataConfirm.cancel": "Cancel",
    "app.newFolderDialog.title": "Create folder",
    "app.newFolderDialog.description":
      "Enter a folder name. If it conflicts with an existing folder in the same parent, a number will be appended automatically.",
    "app.newFolderDialog.placeholder": "Folder name",
    "app.newFolderDialog.confirmLabel": "Create",
    "app.renameFolderDialog.title": "Rename folder",
    "app.renameFolderDialog.description":
      "Enter a new folder name. If it conflicts with an existing folder in the same parent, the rename will be blocked.",
    "app.renameFolderDialog.placeholder": "Folder name",
    "app.renameFolderDialog.confirmLabel": "Confirm",
    "app.renameNoteDialog.title": "Rename note",
    "app.renameNoteDialog.description":
      "Enter a new file name (title). If it conflicts with an existing note in the same folder, the rename will be blocked.",
    "app.renameNoteDialog.placeholder": "File name",
    "app.renameNoteDialog.confirmLabel": "Confirm",
    "app.renameFolderConflictInline":
      "A folder with the same name already exists in this parent.",
    "app.renameNoteConflictInline":
      "A note with the same name already exists in this folder.",
    "app.defaultNoteBaseName": "New note",
    "app.defaultFolderBaseName": "New folder",
    "app.encrypt.requestText":
      "Encrypt current note markdown for Notes Demo",
    "app.connect.login.requestText":
      "Start a connect session for Notes Demo and bind it to the selected key",
    "drag.reason.drop_to_note": "Cannot drop onto a note.",
    "drag.reason.drop_to_self":
      "Cannot move a folder into itself.",
    "drag.reason.drop_to_descendant":
      "Cannot move a folder into one of its descendants.",
    "drag.reason.drop_to_missing_source":
      "Source item no longer exists.",
    "titleError.empty": "Title (file name) cannot be empty.",
    "common.value.notAvailable": "n/a"
  },
  "zh-CN": {
    // ----- 通用：app / brand -----
    "app.brand": "Keymaster Notes",
    "app.demoName": "Notes Demo",
    "app.demoDescription":
      "基于 connect session 与 cipher.* 的加密笔记工作区——真实调用 connect.* + cipher.*。",
    // ----- Lock screen -----
    "lock.subtitle":
      "一个使用 connect session 与 cipher.* 的加密笔记工作区。所有正文真值由 Keymaster 提供方负责加解密，本 demo 仅做协议调用方。",
    "lock.capabilities.title": "依赖的协议能力",
    "lock.capabilities.cipher.encrypt":
      "cipher.encrypt",
    "lock.capabilities.cipher.encrypt.desc":
      "保存 note 时把 markdown UTF-8 字节加密为 nonce + cipherbytes。",
    "lock.capabilities.cipher.decrypt":
      "cipher.decrypt",
    "lock.capabilities.cipher.decrypt.desc":
      "打开 note 时把密文还原为 markdown 明文。",
    "lock.capabilities.connect.login": "connect.login",
    "lock.capabilities.connect.login.desc":
      "首次登录并选择 key；该 session 会绑定到这把 key，后续所有 cipher 调用都走这把 key。",
    "lock.capabilities.connect.resume": "connect.resume",
    "lock.capabilities.connect.resume.desc":
      "页面刷新、popup 关闭重开、transport 重连后，用本地 sessionId 恢复已授权的 session。",
    "lock.capabilities.connect.logout": "connect.logout",
    "lock.capabilities.connect.logout.desc":
      "显式吊销当前 session；只有这一条路径会把 caller 退回登录页。",
    "lock.field.target.label": "Target origin / URL",
    "lock.field.target.placeholder": "例如 {defaultOrigin}",
    "lock.field.target.hint.invalid":
      "Target origin 非法：必须是可被 URL 解析出 origin 的字符串。",
    "lock.field.target.hint.normalized": "将使用 origin：{origin}",
    "lock.field.target.hint.partial":
      "可填入完整 URL；系统只取 origin 部分。",
    "lock.field.target.title.useDefault": "回填默认值：{defaultOrigin}",
    "lock.action.useDefault": "使用默认地址",
    "lock.action.login": "登录",
    "lock.action.login.submitTitle": "请输入 target origin / URL",
    "lock.action.login.opening": "拉起 popup...",
    "lock.action.relogin": "重新登录",
    "lock.action.relogin.opening": "拉起 popup...",
    "lock.action.resume": "恢复 session",
    "lock.action.resume.opening": "正在恢复 session...",
    "lock.status.resuming": "正在恢复 session...",
    "lock.status.resuming.description":
      "正在恢复已授权的 connect session；popup 可能要求输入密码解锁。",
    "lock.status.resumeFailed": "恢复失败",
    "lock.status.resumeFailed.description":
      "本地保存的 session 已失效。请重新登录以获取新 session。",
    "lock.footer":
      "本 demo 仅持久化 connect sessionId（不持久化密码、不持久化 popup 解锁态）。刷新页面时优先尝试 resume；只有显式 logout 才会退回登录页。Notes 数据按绑定 owner 的 publicKey 本地分区保存。",
    // ----- Header -----
    "header.theme.label": "主题",
    "header.theme.dark": "黑",
    "header.theme.light": "白",
    "header.theme.system": "跟随系统",
    "header.theme.aria": "选择主题",
    "header.sidebar.toggle.expand": "收起文件树",
    "header.sidebar.toggle.collapse": "展开文件树",
    "header.sidebar.toggle.open": "目录",
    "header.sidebar.toggle.close": "收起目录",
    "header.language.label": "语言",
    "header.language.aria": "选择语言",
    // ----- Connect status -----
    "connect.state.idle": "未连接",
    "connect.state.opening": "拉起 popup…",
    "connect.state.connected": "已就绪",
    "connect.state.disconnected": "已断开",
    "connect.row.pageOrigin": "page origin",
    "connect.row.targetOrigin": "target origin",
    "connect.row.publicKey": "publicKey",
    "connect.row.lastLogin": "last login",
    "connect.row.publicKey.empty": "未登录",
    "connect.row.sessionId": "sessionId",
    "connect.row.sessionId.empty": "无 session",
    "connect.action.login": "重新登录",
    "connect.action.login.title": "从头走一次 connect.login；放弃当前 resume 尝试",
    "connect.action.resume": "恢复 session",
    "connect.action.resume.title": "重开 popup 并用本地 sessionId 调 connect.resume",
    "connect.action.forget": "切换身份 / 更换登录器",
    "connect.action.forget.title": "退回登录壳；不删除本地数据",
    "connect.action.delete": "删除当前本地数据",
    "connect.action.delete.title":
      "删除当前 publicKey 对应的全部本地 notes 数据并退出工作区；不会删除 Keymaster 身份本身",
    "connect.action.logout": "退出登录",
    "connect.action.logout.title": "调 connect.logout 吊销当前 session 并退回登录壳",
    "connect.action.logout.dialogTitle": "确认退出当前 session？",
    "connect.action.logout.dialogMessage":
      "会在服务端吊销当前 connect session，并从本机移除该 session。Notes 本地数据不会被这次操作删除。",
    "connect.action.logout.confirm": "退出登录",
    "connect.action.logout.cancel": "取消",
    // ----- Sidebar -----
    "sidebar.owner.eyebrow": "Notes",
    "sidebar.owner.empty": "未登录",
    "sidebar.action.newNote": "+ note",
    "sidebar.action.newNote.title": "在当前选中位置新建 note",
    "sidebar.action.newFolder": "+ 文件夹",
    "sidebar.action.newFolder.title": "在当前选中位置新建文件夹",
    "sidebar.search.placeholder": "按文件名搜索",
    "sidebar.tags.aria": "tag 过滤",
    "sidebar.tag.all": "全部",
    "sidebar.tag.empty": "无 tag",
    "sidebar.tag.title": "仅显示含 #{tag} 的 note",
    "sidebar.toolbar.aria": "当前选择信息",
    "sidebar.toolbar.eyebrow.folder": "当前文件夹",
    "sidebar.toolbar.eyebrow.note": "当前文件",
    "sidebar.toolbar.eyebrow.noteUnsaved": "当前文件",
    "sidebar.toolbar.eyebrow.root": "当前选择",
    "sidebar.toolbar.title.fallbackFolder": "未命名文件夹",
    "sidebar.toolbar.title.fallbackNote": "未命名文件",
    "sidebar.toolbar.title.unsaved": "未保存文件",
    "sidebar.toolbar.title.root": "根目录",
    "sidebar.toolbar.meta.updated": "updated {time}",
    "sidebar.toolbar.meta.unsaved": "该文件尚未落库",
    "sidebar.toolbar.meta.root": "当前未选择文件夹或文件",
    "sidebar.toolbar.action.deleteFolder": "删除文件夹",
    "sidebar.toolbar.action.noteStatic": "当前是文件",
    "sidebar.toolbar.action.rootStatic": "无文件夹可删",
    "sidebar.expand.expandFolder": "展开文件夹",
    "sidebar.expand.collapseFolder": "折叠文件夹",
    "sidebar.empty.noContent": "尚未创建任何内容",
    "sidebar.empty.pleaseLogin": "请先登录",
    "sidebar.root.label": "/",
    "sidebar.root.name": "根目录",
    "sidebar.placeholder.folder": "未命名文件夹",
    "sidebar.placeholder.note": "未命名 note",
    "sidebar.note.unsavedBadge": "未保存",
    "sidebar.note.titleSaved": "{title}",
    "sidebar.note.titleUnsaved": "{title}（未保存）",
    "sidebar.context.move": "移动…",
    "sidebar.context.rename": "重命名",
    "sidebar.context.delete": "删除",
    // ----- Document toolbar -----
    "toolbar.hint.tags": "tag 明文存储，仅用于本地搜索",
    "toolbar.meta.status": "状态",
    "toolbar.meta.status.value.decryptFailed": "解密失败",
    "toolbar.meta.created": "created",
    "toolbar.meta.updated": "updated",
    "toolbar.meta.contentType": "contentType",
    "toolbar.meta.cipher": "密文",
    "toolbar.meta.cipher.empty": "尚未保存",
    "toolbar.meta.modified": "修改",
    "toolbar.meta.modified.value": "（未保存）",
    "toolbar.action.save": "加密保存",
    "toolbar.action.save.title.waiting": "正在等待 Keymaster 许可",
    "toolbar.action.save.title.decryptFailed": "解密失败，禁止覆盖密文",
    "toolbar.action.reset": "放弃修改",
    "toolbar.action.delete": "删除",
    "toolbar.action.delete.title.waiting": "正在等待 Keymaster 许可",
    // ----- Document panel: note head -----
    "note.title.placeholder": "未命名 note",
    "note.head.hint.new": "新建 note（尚未保存）",
    "note.head.hint.loading": "正在从 Keymaster 解密正文…",
    "note.head.hint.persisted": "文件名（保存时会写入 note record）",
    // ----- Document panel: folder empty -----
    "folder.empty.title": "选中文件夹：{title}",
    "folder.empty.description":
      "文件夹操作见左侧工具条。重命名请右键文件夹 → 重命名。",
    "root.empty.title": "选择或新建一个 note",
    "root.empty.description":
      "左侧选择文件夹或 note；右键文件夹可新建 / 删除 / 移动；右键 note 可重命名 / 移动 / 删除。",
    // ----- Document panel: editor decrypt failed -----
    "editor.decryptFailed.title": "无法解密",
    "editor.decryptFailed.reason":
      "此 note 的密文无法被当前 origin / 当前 active key 解开。可能原因：origin 切换、active key 切换、密文损坏。",
    "editor.decryptFailed.note":
      "note 仍然保留；可查看元数据但无法编辑正文。",
    // ----- Document panel: editor loading -----
    "editor.loading.placeholder": "（解密中...）",
    // ----- Tag input -----
    "tag.placeholder": "输入 tag，回车提交",
    "tag.placeholder.maxSuffix": "（最多 {max} 个）",
    "tag.hint":
      "回车 / 半角逗号 / 全角逗号 / 空格 提交；最多 {maxTags} 个，每个 ≤ {maxLength} 字符。",
    "tag.remove.aria": "删除 tag {tag}",
    // ----- Search results -----
    "search.eyebrow": "搜索结果",
    "search.title.hasResults": "共 {count} 条结果",
    "search.title.noResults": "无匹配结果",
    "search.title.noInput": "请输入关键词或选择 tag",
    "search.filter.keyword": "关键词",
    "search.filter.tag": "tag",
    "search.filter.hint": "左侧搜索框 / tag 按钮会驱动此页。",
    "search.empty.description":
      "当前条件下没有匹配的 note。请尝试更换关键词或清空 tag 过滤。",
    "search.item.titleFallback": "未命名 note",
    // ----- Name input dialog -----
    "nameDialog.error.empty": "名称不能为空。",
    // ----- Save overlay -----
    "saveOverlay.title.save": "等待 Keymaster 完成保存许可",
    "saveOverlay.title.saveAndSwitch": "保存当前修改后再切换",
    "saveOverlay.description.save":
      "正在向 Keymaster 请求加密保存。完成前请到弹出的窗口里完成许可操作；可随时取消。",
    "saveOverlay.description.saveAndSwitch":
      "切到目标之前，需要先把当前 note 的未保存修改加密保存。请到弹出的窗口里完成许可。",
    "saveOverlay.action.saveAndSwitch": "保存并切换",
    "saveOverlay.action.cancel": "取消",
    // ----- Common actions -----
    "action.cancel": "取消",
    "action.confirm": "确认",
    "action.create": "创建",
    "action.acknowledge": "知道了",
    // ----- Error mapping -----
    "error.protocol.invalid_request": "无效请求",
    "error.protocol.invalid_origin": "来源非法",
    "error.protocol.user_rejected": "用户在 Keymaster 中取消",
    "error.protocol.active_key_unavailable": "当前 Keymaster 没有可用 active key",
    "error.protocol.decrypt_failed": "解密失败（可能 origin / active key 切换）",
    "error.protocol.internal_error": "Keymaster 内部错误",
    "error.transport.popup_blocked": "popup 被浏览器拦截",
    "error.transport.popup_closed": "popup 在协议完成前被关闭",
    "error.transport.ready_timeout": "等待 popup ready 超时",
    "error.transport.result_timeout": "等待 result 超时",
    "error.transport.invalid_origin": "消息来源非法",
    "error.transport.session_busy": "popup session 繁忙",
    "error.transport.no_session": "无 session",
    "error.targetOriginInvalid": "Target origin 非法。",
    // ----- App-level messages -----
    "app.error.targetOriginInvalid": "Target origin 非法。",
    "app.error.saveFailure.prefix": "保存失败：",
    "app.error.sameFolderConflict":
      "保存失败：当前目录下已有同名 note \"{name}\"。",
    "app.error.createFolderFailed": "新建文件夹失败：未知原因。",
    "app.error.renameFolderConflict": "重命名失败：同目录下已有同名文件夹。",
    "app.error.renameNoteConflict": "重命名失败：同目录下已有同名 note。",
    "app.error.deleteCurrentDataFailed": "删除当前本地数据失败，请重试。",
    "app.error.cannotSaveDecryptFailed":
      "当前 note 解密失败，无法重新加密保存。请删除或切换 origin / active key 后重试。",
    "app.error.cannotSaveLoading":
      "当前 note 正在解密中，无法保存。请等待解密完成。",
    "app.error.cannotSaveTitleConflict": "保存失败：",
    "app.error.cannotSaveTitleConflictWithName":
      "保存失败：当前目录下已有同名 note \"{name}\"。",
    "app.error.connectSessionInvalid": "本地保存的 connect session 已失效，请重新登录。",
    "app.error.connectLogoutFailed":
      "退出登录失败。本地 session 已先清掉；若服务端 session 仍在，下次恢复后请再次退出登录。",
    "app.banner.decryptFailed":
      "当前 note 解密失败：{error}。已锁定编辑；可删除本条或切回原 origin / active key 后重试。",
    "app.banner.moveMode": "移动模式：点击目标文件夹或根目录完成移动。",
    "app.banner.dismiss": "知道了",
    "app.folderNotEmpty.title": "文件夹非空，无法删除",
    "app.folderNotEmpty.message":
      "首版不支持递归删除。请先清空里面的文件夹和 note 后再删除。",
    "app.moveFolderInvalid.title": "无法移动文件夹",
    "app.moveFolderInvalid.message":
      "目标位置不合法，或目标目录下已有同名文件夹。",
    "app.moveNoteConflict.title": "无法移动 note",
    "app.moveNoteConflict.message":
      "目标目录下已有同名 note，请改文件名或换目标文件夹。",
    "app.deleteDataConfirm.title": "确认删除当前本地数据？",
    "app.deleteDataConfirm.message":
      "这会删除当前 publicKey 对应的全部本地 notes 数据，并立即退出当前工作区。\n该操作只影响本浏览器当前站点下的数据，不会删除 Keymaster 身份本身。\n不可恢复。",
    "app.deleteDataConfirm.confirm": "删除并退出",
    "app.deleteDataConfirm.cancel": "取消",
    "app.newFolderDialog.title": "新建文件夹",
    "app.newFolderDialog.description":
      "输入文件夹名。若与同父目录下已有文件夹重名，将自动补编号。",
    "app.newFolderDialog.placeholder": "文件夹名",
    "app.newFolderDialog.confirmLabel": "创建",
    "app.renameFolderDialog.title": "重命名文件夹",
    "app.renameFolderDialog.description":
      "输入新文件夹名。若与同父目录下已有文件夹重名，将阻断。",
    "app.renameFolderDialog.placeholder": "文件夹名",
    "app.renameFolderDialog.confirmLabel": "确认",
    "app.renameNoteDialog.title": "重命名 note",
    "app.renameNoteDialog.description":
      "输入新文件名（标题）。若与同目录下已有 note 重名，将阻断。",
    "app.renameNoteDialog.placeholder": "文件名",
    "app.renameNoteDialog.confirmLabel": "确认",
    "app.renameFolderConflictInline": "同父目录下已有同名文件夹。",
    "app.renameNoteConflictInline": "同目录下已有同名 note。",
    "app.defaultNoteBaseName": "新 note",
    "app.defaultFolderBaseName": "新文件夹",
    "app.encrypt.requestText": "向 Notes Demo 加密当前 note 的 markdown",
    "app.connect.login.requestText": "为 Notes Demo 建立 connect session 并绑定到选定的 key",
    "drag.reason.drop_to_note": "不能把内容拖到 note 上。",
    "drag.reason.drop_to_self": "不能把文件夹拖到自己内部。",
    "drag.reason.drop_to_descendant": "不能把文件夹拖到自己的后代下面。",
    "drag.reason.drop_to_missing_source": "找不到要拖动的源。",
    "titleError.empty": "标题（文件名）不能为空。",
    "common.value.notAvailable": "n/a"
  },
  ja: {
    // ----- 共通：app / brand -----
    "app.brand": "Keymaster Notes",
    "app.demoName": "Notes Demo",
    "app.demoDescription":
      "connect session と cipher.* による暗号化ノートワークスペース。実体は connect.* + cipher.* を呼び出します。",
    // ----- Lock screen -----
    "lock.subtitle":
      "connect session と cipher.* を使った暗号化ノートワークスペース。本体の内容はすべて Keymaster プロバイダが暗号化／復号し、本デモはプロトコルの呼び出し側だけです。",
    "lock.capabilities.title": "依存するプロトコル機能",
    "lock.capabilities.cipher.encrypt":
      "cipher.encrypt",
    "lock.capabilities.cipher.encrypt.desc":
      "ノート保存時に markdown の UTF-8 バイト列を nonce + cipherbytes に暗号化します。",
    "lock.capabilities.cipher.decrypt":
      "cipher.decrypt",
    "lock.capabilities.cipher.decrypt.desc":
      "ノートを開くときに暗号文を平文 markdown に復号します。",
    "lock.capabilities.connect.login": "connect.login",
    "lock.capabilities.connect.login.desc":
      "初回ログインし key を選択。その session はその key に紐付けられ、以降の cipher.* 呼び出しはこの key を使用します。",
    "lock.capabilities.connect.resume": "connect.resume",
    "lock.capabilities.connect.resume.desc":
      "ページ再読み込み、ポップアップ再起動、transport 再接続後、保存済み sessionId で認可済み session を復元します。",
    "lock.capabilities.connect.logout": "connect.logout",
    "lock.capabilities.connect.logout.desc":
      "現在の session を明示的に失効させます。サインイン画面に戻すのはこの経路だけです。",
    "lock.field.target.label": "Target origin / URL",
    "lock.field.target.placeholder": "例：{defaultOrigin}",
    "lock.field.target.hint.invalid":
      "Target origin が不正です：URL として origin を解決できる文字列ではありません。",
    "lock.field.target.hint.normalized": "使用する origin：{origin}",
    "lock.field.target.hint.partial":
      "完全な URL を入力できます。origin 部分のみが利用されます。",
    "lock.field.target.title.useDefault":
      "既定値を再入力：{defaultOrigin}",
    "lock.action.useDefault": "既定のアドレスを使う",
    "lock.action.login": "ログイン",
    "lock.action.login.submitTitle":
      "target origin / URL を入力してください",
    "lock.action.login.opening": "ポップアップを開いています...",
    "lock.action.relogin": "再ログイン",
    "lock.action.relogin.opening": "ポップアップを開いています...",
    "lock.action.resume": "session を再開",
    "lock.action.resume.opening": "session を再開しています...",
    "lock.status.resuming": "session を再開しています...",
    "lock.status.resuming.description":
      "認可済みの connect session を復元中です。ポップアップでパスワード入力が必要になることがあります。",
    "lock.status.resumeFailed": "再開に失敗しました",
    "lock.status.resumeFailed.description":
      "保存済みの session は無効です。再度サインインして新しい session を取得してください。",
    "lock.footer":
      "本デモが永続化するのは connect sessionId のみです（パスワードも popup のアンロック素材も保存しません）。再読み込み時はまず resume を試み、明示的な logout だけがサインイン画面に戻します。ノートデータはバインドされたオーナーの publicKey でローカルにパーティション化されます。",
    // ----- Header -----
    "header.theme.label": "テーマ",
    "header.theme.dark": "ダーク",
    "header.theme.light": "ライト",
    "header.theme.system": "システムに合わせる",
    "header.theme.aria": "テーマを選択",
    "header.sidebar.toggle.expand": "ファイルツリーを折りたたむ",
    "header.sidebar.toggle.collapse": "ファイルツリーを展開",
    "header.sidebar.toggle.open": "ツリー",
    "header.sidebar.toggle.close": "ツリーを閉じる",
    "header.language.label": "言語",
    "header.language.aria": "言語を選択",
    // ----- Connect status -----
    "connect.state.idle": "未接続",
    "connect.state.opening": "ポップアップを開いています…",
    "connect.state.connected": "準備完了",
    "connect.state.disconnected": "切断済み",
    "connect.row.pageOrigin": "page origin",
    "connect.row.targetOrigin": "target origin",
    "connect.row.publicKey": "publicKey",
    "connect.row.lastLogin": "last login",
    "connect.row.publicKey.empty": "未ログイン",
    "connect.row.sessionId": "sessionId",
    "connect.row.sessionId.empty": "session なし",
    "connect.action.login": "再ログイン",
    "connect.action.login.title":
      "connect.login を最初からやり直します。現在の resume 試行は破棄されます。",
    "connect.action.resume": "session を再開",
    "connect.action.resume.title":
      "ポップアップを開き直し、保存済み sessionId で connect.resume を呼びます",
    "connect.action.forget": "ID を切り替える / プロバイダを変更",
    "connect.action.forget.title":
      "ログイン画面に戻ります。ローカルデータは削除しません。",
    "connect.action.delete": "現在のローカルデータを削除",
    "connect.action.delete.title":
      "現在の publicKey のローカル notes データをすべて削除してワークスペースを終了します。Keymaster ID そのものは削除されません。",
    "connect.action.logout": "サインアウト",
    "connect.action.logout.title":
      "connect.logout を呼び、現在の session を失効させてログイン画面に戻ります",
    "connect.action.logout.dialogTitle": "現在の session からサインアウトしますか？",
    "connect.action.logout.dialogMessage":
      "Keymaster 側で現在の connect session を失効させ、この端末からも削除します。この操作ではローカル notes データは削除されません。",
    "connect.action.logout.confirm": "サインアウト",
    "connect.action.logout.cancel": "キャンセル",
    // ----- Sidebar -----
    "sidebar.owner.eyebrow": "Notes",
    "sidebar.owner.empty": "未ログイン",
    "sidebar.action.newNote": "+ note",
    "sidebar.action.newNote.title": "現在の選択位置に note を作成",
    "sidebar.action.newFolder": "+ フォルダ",
    "sidebar.action.newFolder.title": "現在の選択位置にフォルダを作成",
    "sidebar.search.placeholder": "ファイル名で検索",
    "sidebar.tags.aria": "tag フィルタ",
    "sidebar.tag.all": "すべて",
    "sidebar.tag.empty": "tag なし",
    "sidebar.tag.title": "#{tag} を含む note のみ表示",
    "sidebar.toolbar.aria": "現在の選択情報",
    "sidebar.toolbar.eyebrow.folder": "現在のフォルダ",
    "sidebar.toolbar.eyebrow.note": "現在のファイル",
    "sidebar.toolbar.eyebrow.noteUnsaved": "現在のファイル",
    "sidebar.toolbar.eyebrow.root": "現在の選択",
    "sidebar.toolbar.title.fallbackFolder": "無題のフォルダ",
    "sidebar.toolbar.title.fallbackNote": "無題のファイル",
    "sidebar.toolbar.title.unsaved": "未保存のファイル",
    "sidebar.toolbar.title.root": "ルート",
    "sidebar.toolbar.meta.updated": "updated {time}",
    "sidebar.toolbar.meta.unsaved": "このファイルはまだ保存されていません",
    "sidebar.toolbar.meta.root": "フォルダ／ファイルが選択されていません",
    "sidebar.toolbar.action.deleteFolder": "フォルダを削除",
    "sidebar.toolbar.action.noteStatic": "ファイルが選択されています",
    "sidebar.toolbar.action.rootStatic": "削除できるフォルダはありません",
    "sidebar.expand.expandFolder": "フォルダを展開",
    "sidebar.expand.collapseFolder": "フォルダを折りたたむ",
    "sidebar.empty.noContent": "まだ何も作成されていません",
    "sidebar.empty.pleaseLogin": "まずログインしてください",
    "sidebar.root.label": "/",
    "sidebar.root.name": "ルート",
    "sidebar.placeholder.folder": "無題のフォルダ",
    "sidebar.placeholder.note": "無題の note",
    "sidebar.note.unsavedBadge": "未保存",
    "sidebar.note.titleSaved": "{title}",
    "sidebar.note.titleUnsaved": "{title}（未保存）",
    "sidebar.context.move": "移動…",
    "sidebar.context.rename": "名前変更",
    "sidebar.context.delete": "削除",
    // ----- Document toolbar -----
    "toolbar.hint.tags":
      "tag は平文で保存され、ローカル検索のみに利用されます",
    "toolbar.meta.status": "状態",
    "toolbar.meta.status.value.decryptFailed": "復号失敗",
    "toolbar.meta.created": "created",
    "toolbar.meta.updated": "updated",
    "toolbar.meta.contentType": "contentType",
    "toolbar.meta.cipher": "暗号文",
    "toolbar.meta.cipher.empty": "未保存",
    "toolbar.meta.modified": "変更",
    "toolbar.meta.modified.value": "（未保存）",
    "toolbar.action.save": "暗号化して保存",
    "toolbar.action.save.title.waiting":
      "Keymaster の承認待ちです",
    "toolbar.action.save.title.decryptFailed":
      "復号に失敗したため暗号文を上書きできません",
    "toolbar.action.reset": "変更を破棄",
    "toolbar.action.delete": "削除",
    "toolbar.action.delete.title.waiting": "Keymaster の承認待ちです",
    // ----- Document panel: note head -----
    "note.title.placeholder": "無題の note",
    "note.head.hint.new": "新規 note（まだ保存されていません）",
    "note.head.hint.loading": "Keymaster から本文を復号中…",
    "note.head.hint.persisted":
      "ファイル名（保存時に note record に書き込まれます）",
    // ----- Document panel: folder empty -----
    "folder.empty.title": "選択中のフォルダ：{title}",
    "folder.empty.description":
      "フォルダの操作は左のツールバーから行います。名前変更はフォルダを右クリック → 名前変更。",
    "root.empty.title": "note を選択または作成",
    "root.empty.description":
      "左側でフォルダまたは note を選んでください。フォルダを右クリックすると作成 / 削除 / 移動、note を右クリックすると名前変更 / 移動 / 削除ができます。",
    // ----- Document panel: editor decrypt failed -----
    "editor.decryptFailed.title": "復号できません",
    "editor.decryptFailed.reason":
      "この note の暗号文は現在の origin / 現在の active key では開けません。原因として origin の変更、active key の変更、暗号文の破損が考えられます。",
    "editor.decryptFailed.note":
      "note 自体は残っています。メタデータは確認できますが本文は編集できません。",
    // ----- Document panel: editor loading -----
    "editor.loading.placeholder": "（復号中...）",
    // ----- Tag input -----
    "tag.placeholder": "tag を入力、Enter で確定",
    "tag.placeholder.maxSuffix": "（最大 {max} 個）",
    "tag.hint":
      "Enter / 半角カンマ / 全角カンマ / スペースで確定；最大 {maxTags} 個、各 ≤ {maxLength} 文字。",
    "tag.remove.aria": "tag {tag} を削除",
    // ----- Search results -----
    "search.eyebrow": "検索結果",
    "search.title.hasResults": "{count} 件の結果",
    "search.title.noResults": "一致する結果はありません",
    "search.title.noInput": "キーワードを入力するか tag を選択してください",
    "search.filter.keyword": "キーワード",
    "search.filter.tag": "tag",
    "search.filter.hint":
      "左の検索ボックス / tag ボタンがこのページを操作します。",
    "search.empty.description":
      "現在の条件に一致する note はありません。キーワードを変えるか tag フィルタをクリアしてください。",
    "search.item.titleFallback": "無題の note",
    // ----- Name input dialog -----
    "nameDialog.error.empty": "名前は空欄にできません。",
    // ----- Save overlay -----
    "saveOverlay.title.save": "Keymaster の保存承認待ちです",
    "saveOverlay.title.saveAndSwitch":
      "現在の変更を保存してから切り替えます",
    "saveOverlay.description.save":
      "Keymaster に暗号保存をリクエストしています。完了するまでポップアップで承認操作を行ってください。いつでもキャンセルできます。",
    "saveOverlay.description.saveAndSwitch":
      "切り替え前に、現在の note の未保存の変更を暗号化して保存する必要があります。ポップアップで承認操作を行ってください。",
    "saveOverlay.action.saveAndSwitch": "保存して切り替え",
    "saveOverlay.action.cancel": "キャンセル",
    // ----- Common actions -----
    "action.cancel": "キャンセル",
    "action.confirm": "確認",
    "action.create": "作成",
    "action.acknowledge": "了解",
    // ----- Error mapping -----
    "error.protocol.invalid_request": "無効なリクエスト",
    "error.protocol.invalid_origin": "不正な origin",
    "error.protocol.user_rejected": "Keymaster でユーザーがキャンセルしました",
    "error.protocol.active_key_unavailable":
      "現在の Keymaster に利用可能な active key がありません",
    "error.protocol.decrypt_failed":
      "復号に失敗しました（origin または active key が変更された可能性があります）",
    "error.protocol.internal_error": "Keymaster 内部エラー",
    "error.transport.popup_blocked":
      "ブラウザにポップアップをブロックされました",
    "error.transport.popup_closed":
      "プロトコル完了前にポップアップが閉じられました",
    "error.transport.ready_timeout":
      "ポップアップ ready の待機がタイムアウトしました",
    "error.transport.result_timeout": "result 待機がタイムアウトしました",
    "error.transport.invalid_origin": "メッセージの origin が不正です",
    "error.transport.session_busy": "popup session がビジーです",
    "error.transport.no_session": "session がありません",
    "error.targetOriginInvalid": "Target origin が不正です。",
    // ----- App-level messages -----
    "app.error.targetOriginInvalid": "Target origin が不正です。",
    "app.error.saveFailure.prefix": "保存失敗：",
    "app.error.sameFolderConflict":
      "保存失敗：現在のフォルダに同名の note \"{name}\" が存在します。",
    "app.error.createFolderFailed":
      "フォルダ作成に失敗しました：原因不明。",
    "app.error.renameFolderConflict":
      "名前変更失敗：同じ親フォルダに同名のフォルダが存在します。",
    "app.error.renameNoteConflict":
      "名前変更失敗：同じフォルダに同名の note が存在します。",
    "app.error.deleteCurrentDataFailed":
      "現在のローカルデータの削除に失敗しました。再試行してください。",
    "app.error.cannotSaveDecryptFailed":
      "この note は復号に失敗しているため再暗号化できません。削除するか origin / active key を切り替えて再試行してください。",
    "app.error.cannotSaveLoading":
      "この note はまだ復号中のため保存できません。復号の完了を待ってください。",
    "app.error.cannotSaveTitleConflict": "保存失敗：",
    "app.error.cannotSaveTitleConflictWithName":
      "保存失敗：現在のフォルダに同名の note \"{name}\" が存在します。",
    "app.error.connectSessionInvalid":
      "ローカルに保存された connect session は無効です。再度サインインしてください。",
    "app.error.connectLogoutFailed":
      "サインアウトに失敗しました。ローカル session は先にクリアされています。サーバ側に残っている場合は一度 resume してから再度サインアウトしてください。",
    "app.banner.decryptFailed":
      "現在の note は復号に失敗しました：{error}。編集はロックされています。この note を削除するか、元の origin / active key に戻して再試行してください。",
    "app.banner.moveMode":
      "移動モード：対象のフォルダまたはルートをクリックして移動を完了してください。",
    "app.banner.dismiss": "了解",
    "app.folderNotEmpty.title":
      "フォルダが空ではないため削除できません",
    "app.folderNotEmpty.message":
      "本バージョンでは再帰削除はサポートされていません。先にフォルダを空にしてください。",
    "app.moveFolderInvalid.title": "フォルダを移動できません",
    "app.moveFolderInvalid.message":
      "移動先が無効か、移動先に同名のフォルダが存在します。",
    "app.moveNoteConflict.title": "note を移動できません",
    "app.moveNoteConflict.message":
      "移動先のフォルダに同名の note が存在します。ファイル名を変更するか別の移動先を選んでください。",
    "app.deleteDataConfirm.title":
      "現在のローカルデータを削除しますか？",
    "app.deleteDataConfirm.message":
      "現在の publicKey に対応するローカル notes データをすべて削除し、即座に現在のワークスペースを終了します。\nこの操作はこのブラウザ・このサイトのデータにのみ影響し、Keymaster ID 自体は削除されません。\n元に戻せません。",
    "app.deleteDataConfirm.confirm": "削除して終了",
    "app.deleteDataConfirm.cancel": "キャンセル",
    "app.newFolderDialog.title": "フォルダを作成",
    "app.newFolderDialog.description":
      "フォルダ名を入力してください。同じ親フォルダに同名フォルダがある場合、自動で番号が付与されます。",
    "app.newFolderDialog.placeholder": "フォルダ名",
    "app.newFolderDialog.confirmLabel": "作成",
    "app.renameFolderDialog.title": "フォルダ名を変更",
    "app.renameFolderDialog.description":
      "新しいフォルダ名を入力してください。同じ親フォルダに同名フォルダがある場合、処理は中断されます。",
    "app.renameFolderDialog.placeholder": "フォルダ名",
    "app.renameFolderDialog.confirmLabel": "確認",
    "app.renameNoteDialog.title": "note 名を変更",
    "app.renameNoteDialog.description":
      "新しいファイル名（タイトル）を入力してください。同じフォルダに同名 note がある場合、処理は中断されます。",
    "app.renameNoteDialog.placeholder": "ファイル名",
    "app.renameNoteDialog.confirmLabel": "確認",
    "app.renameFolderConflictInline":
      "同じ親フォルダに同名のフォルダが存在します。",
    "app.renameNoteConflictInline":
      "同じフォルダに同名の note が存在します。",
    "app.defaultNoteBaseName": "新規 note",
    "app.defaultFolderBaseName": "新規フォルダ",
    "app.encrypt.requestText":
      "現在の note の markdown を Notes Demo 向けに暗号化",
    "app.connect.login.requestText":
      "Notes Demo 用の connect session を確立し、選択した key に紐付けます",
    "drag.reason.drop_to_note": "note にドロップすることはできません。",
    "drag.reason.drop_to_self":
      "フォルダを自分自身の下には移動できません。",
    "drag.reason.drop_to_descendant":
      "フォルダを自分の子孫の下には移動できません。",
    "drag.reason.drop_to_missing_source":
      "ドラッグ元が存在しません。",
    "titleError.empty": "タイトル（ファイル名）は空欄にできません。",
    "common.value.notAvailable": "n/a"
  }
};

/**
 * 简单的轻量插值函数：把 `{name}` 风格的占位符替换成 `values` 里的对应值。
 *
 * 设计缘由：
 *   - 仅支持 `{key}` 风格的占位符；
 *   - 不引入模板引擎；
 *   - 缺值时保留原文（开发期 TS 已确保 key 存在；缺值意味着数据未到位，
 *     不应静默替换成空字符串）。
 */
export function interpolate(
  template: string,
  values?: Record<string, string | number>
): string {
  if (!values) return template;
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_-]*)\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return String(values[key]);
    }
    return match;
  });
}