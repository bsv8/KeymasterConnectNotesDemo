// src/App.tsx
// Notes Demo 页面级状态与编排。
//
// 设计缘由（施工单 2026-06-26 lock-screen-custom-provider 第 4-10 章
//          + 2026-06-26 save-tag-folder-ux 第 4-9 章）：
//   - 页面顶层固定二态：`identity === null` 时只渲染 `LockScreen`；
//     `identity !== null` 时才渲染 notes 工作区。
//   - 不在初始化时自动恢复 identity；刷新页面回到 LockScreen 是预期行为，不是缺陷。
//   - 登录成功后按 `identity.publicKeyHex` 调 `loadOwnerSpace`。
//   - "切换身份 / 更换登录器" 退回 LockScreen 时统一收口清空 notes 工作区内存态。
//   - 选中 / 右键菜单 / 拖拽 / 解密缓存等真值仍然集中在 App 这一层。
//   - 解密失败：note 仍保留；metadata 锁死；删除仍然允许。
//   - 右键菜单 / 拖拽状态集中在这里管理；sidebar 只负责"显示 + 触发"。
//   - 保存链路：**原地 patch**——不重选 note、不重置 draft、不重新解密。
//   - 命名交互：新建文件夹 / 重命名文件夹 / 重命名 note 全部走 `NameInputDialog`；
//     新建时若重名走自动补编号；重命名时若重名直接阻断。
//   - pending note 的 dirty 判定：markdown 基线 = 空字符串（尚未持久化）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeOrigin, ProtocolTransportError, type ProtocolLogEvent } from "./lib/connectClient";
import { PopupSessionClient } from "./lib/popupSessionClient";
import type { ProtocolErrorCode } from "./lib/protocol";
import {
  buildCipherDecryptRequest,
  buildCipherEncryptRequest,
  buildIdentityGetRequest,
  parseCipherDecryptResult,
  parseCipherEncryptResult,
  parseIdentityResult
} from "./lib/keymaster";
import { NOTE_CONTENT_TYPE, emptyDraft, normalizeTags, validateTitle, type NoteDraft, type StoredFolderRecord, type StoredNoteRecord } from "./lib/notes";
import {
  createFolder,
  deleteFolder,
  deleteNote,
  deleteOwnerSpace,
  findAvailableName,
  getFolder,
  getNote,
  isFolderEmpty,
  isFolderTitleConflict,
  isNoteTitleConflict,
  loadOwnerSpace,
  moveFolder,
  moveNote,
  putNote,
  renameFolder,
  saveOwnerSpace,
  type StoredNotesSpace
} from "./lib/storage";
import { checkDragLegality, describeDragLegalityReason } from "./lib/path";
import { ConnectStatus, type PopupUiState } from "./components/ConnectStatus";
import { NotesSidebar, type FolderAction, type MoveState, type NoteAction, type RootAction, type SidebarContextMenuState } from "./components/NotesSidebar";
import { NoteEditor } from "./components/NoteEditor";
import { NoteInspector } from "./components/NoteInspector";
import { LockScreen } from "./components/LockScreen";
import { NameInputDialog } from "./components/NameInputDialog";

/** 新建 note / folder 的默认基名（自动补编号时按 "基名 N" 递增）。 */
const DEFAULT_NOTE_BASE_NAME = "新 note";
const DEFAULT_FOLDER_BASE_NAME = "新文件夹";

const DEFAULT_TARGET_ORIGIN = "https://keymaster.cc";
const READY_TIMEOUT_MS = 10_000;
const RESULT_TIMEOUT_MS = 60_000;
const POPUP_WIDTH = 520;
const POPUP_HEIGHT = 760;

interface IdentitySnapshot {
  publicKeyHex: string;
  claims: Record<string, unknown>;
  resolvedAt: number;
}

interface DecryptedCache {
  noteId: string;
  markdown: string;
}

interface Selection {
  kind: "folder" | "note" | "root";
  /** folder 时是 folderId；note 时是 noteId；"root" 时为 null。 */
  id: string | null;
}

interface PendingDialog {
  title: string;
  message: string;
  /** 阻断动作；confirm 后回到正常态。 */
  onDismiss: () => void;
}

interface ConfirmDialog {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel: string;
  cancelLabel: string;
}

/**
 * 页面内命名弹层的输入定义。
 * 设计缘由（施工单 2026-06-26 save-tag-folder-ux 第 4.5 / 4.6 / 6 章）：
 *   - 三类动作（新建文件夹 / 重命名文件夹 / 重命名 note）共用同一个弹层组件；
 *   - 弹层内部 `validate` 由 App 注入，确保重命名阻断 / 新建自动补编号的语义区分；
 *   - onConfirm 拿到的是用户最终提交值；App 决定是否补编号、如何落库。
 */
type NameDialogMode =
  | {
      kind: "create-folder";
      parentId: string | null;
    }
  | {
      kind: "rename-folder";
      folderId: string;
    }
  | {
      kind: "rename-note";
      noteId: string;
    };

interface NameDialogState {
  mode: NameDialogMode;
  title: string;
  description?: string;
  initialValue: string;
  placeholder?: string;
  confirmLabel: string;
}

export default function App() {
  const currentOrigin = typeof window === "undefined" ? "" : window.location.origin;

  /* ============== 状态真值 ============== */

  const [targetOrigin, setTargetOrigin] = useState(DEFAULT_TARGET_ORIGIN);
  const [popupState, setPopupState] = useState<PopupUiState>("idle");
  const [identity, setIdentity] = useState<IdentitySnapshot | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const [space, setSpace] = useState<StoredNotesSpace>({ v: 1, folders: {}, notes: {} });
  /**
   * 未保存的 note draft；只活在内存，**不**进 localStorage。
   * 边界：note 的真值（带 cipher）只能由 `handleSave` 落库。
   * 这是硬切换的高严重性修复：新建时不再把空密文记录写到持久层。
   */
  const [pendingDrafts, setPendingDrafts] = useState<Record<string, StoredNoteRecord>>({});
  const [selection, setSelection] = useState<Selection>({ kind: "root", id: null });
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [pendingDialog, setPendingDialog] = useState<PendingDialog | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const [contextMenu, setContextMenu] = useState<SidebarContextMenuState | null>(null);
  const [dragging, setDragging] = useState<
    | { kind: "folder" | "note"; id: string }
    | null
  >(null);
  const [dropHover, setDropHover] = useState<
    | { kind: "folder" | "root"; id: string | null }
    | null
  >(null);
  const [moveState, setMoveState] = useState<MoveState | null>(null);
  /** 页面内命名弹层：null = 不显示。 */
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);

  const decryptedCacheRef = useRef<DecryptedCache | null>(null);
  const sessionRef = useRef<PopupSessionClient | null>(null);

  const normalizedTargetOrigin = useMemo(() => {
    try {
      return normalizeOrigin(targetOrigin);
    } catch {
      return "";
    }
  }, [targetOrigin]);

  /* ============== session client 单例 ============== */

  function getSessionClient(): PopupSessionClient {
    if (!sessionRef.current) {
      sessionRef.current = new PopupSessionClient({
        targetOrigin: normalizedTargetOrigin || targetOrigin,
        popupWidth: POPUP_WIDTH,
        popupHeight: POPUP_HEIGHT,
        readyTimeoutMs: READY_TIMEOUT_MS,
        resultTimeoutMs: RESULT_TIMEOUT_MS,
        onLog: (event) => pushLog(event),
        onConnectionStateChange: (state) => setPopupState(state as PopupUiState)
      });
    }
    return sessionRef.current;
  }

  // 切换 targetOrigin 时重建 session。
  useEffect(() => {
    if (sessionRef.current) {
      sessionRef.current.closeSession();
      sessionRef.current = null;
      setPopupState("idle");
    }
  }, [targetOrigin]);

  useEffect(() => {
    return () => {
      sessionRef.current?.closeSession();
      sessionRef.current = null;
    };
  }, []);

  // 全局点击 / 滚动时关闭右键菜单。
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    window.addEventListener("click", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("click", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [contextMenu]);

  /* ============== 加载当前 owner 的空间 ============== */

  useEffect(() => {
    if (!identity) {
      setSpace({ v: 1, folders: {}, notes: {} });
      setPendingDrafts({});
      setSelection({ kind: "root", id: null });
      setDraft(null);
      decryptedCacheRef.current = null;
      return;
    }
    const loaded = loadOwnerSpace(identity.publicKeyHex);
    setSpace(loaded);
    setPendingDrafts({});
    setSelection({ kind: "root", id: null });
    setDraft(null);
    decryptedCacheRef.current = null;
  }, [identity?.publicKeyHex]);

  /* ============== 日志 ============== */

  function pushLog(event: ProtocolLogEvent) {
    const prefix = `[notes-demo][${event.method ?? "system"}][${event.stage}]`;
    if (event.stage === "timeout" || event.stage === "busy_rejected") {
      console.error(prefix, event);
    } else {
      console.debug(prefix, event);
    }
  }

  /* ============== 登录 ============== */

  const handleLogin = useCallback(async () => {
    if (!normalizedTargetOrigin) {
      setLastError("Target origin 非法。");
      return;
    }
    setIsLoggingIn(true);
    setLastError(null);
    try {
      const session = getSessionClient();
      const requestId = makeRequestId();
      const request = buildIdentityGetRequest({
        origin: currentOrigin,
        text: "向 Notes Demo 提供身份以解锁加密笔记",
        ttlSeconds: 300,
        requestId
      });
      const response = await session.runRequest(request);
      if (!response.ok) {
        setLastError(formatProtocolError(response.error.code, response.error.message));
        setIsLoggingIn(false);
        return;
      }
      const parsed = parseIdentityResult(response.result as never);
      setIdentity({
        publicKeyHex: parsed.publicKeyHex,
        claims: parsed.claims as Record<string, unknown>,
        resolvedAt: parsed.resolvedAt
      });
      setPopupState("connected");
    } catch (err) {
      setLastError(formatTransportError(err));
    } finally {
      setIsLoggingIn(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedTargetOrigin, currentOrigin]);

  /* ============== 选中辅助 ============== */

  function trySelect(next: Selection) {
    // 切换 note 时若 draft 有未保存修改，弹确认。
    if (
      draft &&
      selection.kind === "note" &&
      selection.id !== null &&
      (next.kind !== "note" || next.id !== selection.id) &&
      draftHasChanges(space, pendingDrafts, selection.id, draft, decryptedCacheRef.current)
    ) {
      setConfirmDialog({
        title: "放弃未保存的修改？",
        message: "当前 note 存在未保存修改。继续切换将丢失这些修改。",
        confirmLabel: "放弃并切换",
        cancelLabel: "继续编辑",
        onConfirm: () => {
          setConfirmDialog(null);
          applySelection(next);
        },
        onCancel: () => setConfirmDialog(null)
      });
      return;
    }
    applySelection(next);
  }

  function applySelection(next: Selection) {
    setSelection(next);
    if (next.kind !== "note" || next.id === null) {
      setDraft(null);
      setDecryptError(null);
      decryptedCacheRef.current = null;
    }
  }

  /* ============== 选中后：解密 note 加载到 draft ============== */

  useEffect(() => {
    if (selection.kind !== "note" || selection.id === null) {
      setDraft(null);
      return;
    }
    const noteId = selection.id;
    const persisted = space.notes[noteId];
    const pending = pendingDrafts[noteId];
    if (!persisted && !pending) {
      setDraft(null);
      return;
    }
    if (pending) {
      // 未保存 draft：直接显示，不解密。
      setDraft({
        noteId: pending.id,
        title: pending.title,
        tags: [...pending.tags],
        markdown: decryptedCacheRef.current?.markdown ?? "",
        decryptFailed: false
      });
      setDecryptError(null);
      return;
    }
    if (decryptedCacheRef.current && decryptedCacheRef.current.noteId === persisted!.id) {
      setDraft({
        noteId: persisted!.id,
        title: persisted!.title,
        tags: [...persisted!.tags],
        markdown: decryptedCacheRef.current.markdown,
        decryptFailed: false
      });
      setDecryptError(null);
      return;
    }
    void openNote(persisted!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.kind, selection.id, space.notes, pendingDrafts]);

  async function openNote(record: StoredNoteRecord) {
    setDecryptError(null);
    setDraft({
      noteId: record.id,
      title: record.title,
      tags: [...record.tags],
      markdown: "（解密中...）",
      decryptFailed: false
    });
    try {
      const session = getSessionClient();
      const request = buildCipherDecryptRequest({
        text: "向 Notes Demo 解密该 note 的 markdown 内容",
        nonceBase64: record.cipher.nonceBase64,
        cipherbytesBase64: record.cipher.cipherbytesBase64,
        requestId: makeRequestId()
      });
      const response = await session.runRequest(request);
      if (!response.ok) {
        throw new Error(formatProtocolError(response.error.code, response.error.message));
      }
      const decrypted = parseCipherDecryptResult(response.result as never);
      decryptedCacheRef.current = { noteId: record.id, markdown: decrypted };
      setDraft({
        noteId: record.id,
        title: record.title,
        tags: [...record.tags],
        markdown: decrypted,
        decryptFailed: false
      });
      setDecryptError(null);
    } catch (err) {
      setDecryptError(formatTransportError(err));
      setDraft({
        noteId: record.id,
        title: record.title,
        tags: [...record.tags],
        markdown: "",
        decryptFailed: true
      });
      // 注意：**不**清空 record；保留密文以供后续重试。
    }
  }

  /* ============== folder / note 操作 ============== */

  function resolveCreateParent(): string | null {
    if (selection.kind === "folder" && selection.id !== null) return selection.id;
    if (selection.kind === "note" && selection.id !== null) {
      const note = space.notes[selection.id] ?? pendingDrafts[selection.id];
      return note?.folderId ?? null;
    }
    // root：根目录。
    return null;
  }

  /**
   * 显式给出 parentId 的入口——右键菜单走这条，避免 `setSelection` 异步生效
   * 导致新建位置回退到"之前选中的位置"。
   * 未传 override 时，回退到 `resolveCreateParent()`（用于顶部 + note / + 文件夹 按钮）。
   *
   * 设计缘由（施工单 2026-06-26 save-tag-folder-ux 第 4.4 / 4.5 章）：
   *   - 新建 note 走默认基名 `新 note`；同目录已有同名时自动按 `新 note 2`、`新 note 3` ... 递增；
   *   - "同目录"判断同时覆盖 `space.notes` 与 `pendingDrafts`，避免 UI 上看见重名但检查没算进去；
   *   - note **不**弹输入框，直接创建。
   */
  function handleCreateNote(parentIdOverride?: string | null) {
    if (!identity) return;
    const parentId = parentIdOverride === undefined ? resolveCreateParent() : parentIdOverride;
    // 1. 收集同目录下已有 note 的标题（persisted + pending）。
    const taken = collectNoteTitlesInFolder(parentId);
    // 2. 自动补编号。
    const title = findAvailableName(DEFAULT_NOTE_BASE_NAME, taken);
    const now = Date.now();
    const id = cryptoRandomId();
    const draftNote: StoredNoteRecord = {
      v: 2,
      id,
      folderId: parentId,
      title,
      tags: [],
      createdAt: now,
      updatedAt: now,
      cipher: { contentType: NOTE_CONTENT_TYPE, nonceBase64: "", cipherbytesBase64: "" }
    };
    // 关键：**只**写入 in-memory pendingDrafts，不进 space / localStorage。
    setPendingDrafts((prev) => ({ ...prev, [id]: draftNote }));
    setLastError(null);
    setSelection({ kind: "note", id });
    setDraft({
      noteId: id,
      title: draftNote.title,
      tags: [...draftNote.tags],
      markdown: "",
      decryptFailed: false
    });
    decryptedCacheRef.current = null;
  }

  /**
   * 在指定的父目录下，合并 persisted 与 pending，收集所有 note 的 title。
   * 用于"新建 note 时自动补编号"。
   */
  function collectNoteTitlesInFolder(folderId: string | null): string[] {
    const out: string[] = [];
    for (const n of Object.values(space.notes)) {
      if (n.folderId === folderId) out.push(n.title);
    }
    for (const n of Object.values(pendingDrafts)) {
      if (n.folderId === folderId) out.push(n.title);
    }
    return out;
  }

  /**
   * 在指定的父目录下，收集所有 folder 的 title。
   * 用于"新建 folder 时自动补编号"。
   */
  function collectFolderTitlesInParent(parentId: string | null): string[] {
    const out: string[] = [];
    for (const f of Object.values(space.folders)) {
      if (f.parentId === parentId) out.push(f.title);
    }
    return out;
  }

  /**
   * 新建文件夹：先开页面内命名弹层，让用户输入名字再真正创建。
   * 设计缘由（施工单 2026-06-26 save-tag-folder-ux 第 4.5 / 6.8 / 6.9 章）：
   *   - 不再"先创建默认名，再立刻弹重命名"；
   *   - 不再用 `window.prompt`；
   *   - 用户在弹层中输入的值 `trim` 后若非空，再走"自动补编号"；
   *   - 取消 / 关闭弹层 = 没发生过，不改 selection / draft / space。
   */
  function handleCreateFolder(parentIdOverride?: string | null) {
    if (!identity) return;
    const parentId = parentIdOverride === undefined ? resolveCreateParent() : parentIdOverride;
    setNameDialog({
      mode: { kind: "create-folder", parentId },
      title: "新建文件夹",
      description: "输入文件夹名。若与同父目录下已有文件夹重名，将自动补编号。",
      initialValue: DEFAULT_FOLDER_BASE_NAME,
      placeholder: "文件夹名",
      confirmLabel: "创建"
    });
    setLastError(null);
  }

  /**
   * 弹层确认回调：
   *   - "新建文件夹"：trim 后走 `findAvailableName` 自动补编号，然后创建；
   *   - "重命名文件夹 / 重命名 note"：trim 后直接走持久层；重名由 validate 阻断，
   *     这里只处理成功路径。
   */
  function handleNameDialogConfirm(value: string) {
    const dialog = nameDialog;
    if (!dialog) return;
    if (dialog.mode.kind === "create-folder") {
      const trimmed = value.trim();
      const taken = collectFolderTitlesInParent(dialog.mode.parentId);
      const finalTitle = findAvailableName(trimmed, taken);
      const result = createFolder(space, { parentId: dialog.mode.parentId, title: finalTitle });
      if (!result) {
        // 极端兜底：自动补编号理论上不会触发冲突，但保险起见保留路径。
        setLastError("新建文件夹失败：未知原因。");
        setNameDialog(null);
        return;
      }
      commitSpace(result.next);
      setLastError(null);
      setSelection({ kind: "folder", id: result.folder.id });
      setDraft(null);
      setNameDialog(null);
      return;
    }
    if (dialog.mode.kind === "rename-folder") {
      const trimmed = value.trim();
      const result = renameFolder(space, dialog.mode.folderId, trimmed);
      if (!result) {
        // 阻断已在弹层内做了 inline 提示，正常路径下不会进来。
        setLastError("重命名失败：同目录下已有同名文件夹。");
        setNameDialog(null);
        return;
      }
      commitSpace(result.next);
      setLastError(null);
      setNameDialog(null);
      return;
    }
    // rename-note
    const trimmed = value.trim();
    const noteId = dialog.mode.noteId;
    // pending draft
    if (pendingDrafts[noteId]) {
      const target = pendingDrafts[noteId];
      if (isNoteTitleConflictMerged(space.notes, pendingDrafts, target.folderId, trimmed, noteId)) {
        setLastError("重命名失败：同目录下已有同名 note。");
        setNameDialog(null);
        return;
      }
      setPendingDrafts((prev) => ({
        ...prev,
        [noteId]: { ...target, title: trimmed, updatedAt: Date.now() }
      }));
      if (draft && draft.noteId === noteId) {
        setDraft({ ...draft, title: trimmed });
      }
      setLastError(null);
      setNameDialog(null);
      return;
    }
    const target = space.notes[noteId];
    if (!target) {
      setNameDialog(null);
      return;
    }
    if (isNoteTitleConflict(space.notes, target.folderId, trimmed, noteId)) {
      setLastError("重命名失败：同目录下已有同名 note。");
      setNameDialog(null);
      return;
    }
    const updated: StoredNoteRecord = { ...target, title: trimmed, updatedAt: Date.now() };
    commitSpace(putNote(space, updated));
    if (draft && draft.noteId === noteId) {
      setDraft({ ...draft, title: trimmed });
    }
    setLastError(null);
    setNameDialog(null);
  }

  /**
   * 弹层关闭 / 取消回调：当作没发生过。
   * 设计缘由（施工单 7.6 章）：不改 selection / draft / space / pendingDrafts。
   */
  function handleNameDialogCancel() {
    setNameDialog(null);
  }

  /**
   * 弹层内联校验：
   *   - 重命名 folder / note：trim 后若与同父目录已有记录（排除自己）重名 → 阻断文案；
   *   - 新建 folder：弹层**不**阻断重名（直接交给自动补编号），所以 validate 返回 null。
   * 这里的语义必须分清：自动补编号 vs 阻断。
   */
  function validateNameDialogValue(value: string): string | null {
    const dialog = nameDialog;
    if (!dialog) return null;
    if (dialog.mode.kind === "create-folder") {
      return null;
    }
    if (dialog.mode.kind === "rename-folder") {
      const target = space.folders[dialog.mode.folderId];
      if (!target) return null;
      if (isFolderTitleConflict(space.folders, target.parentId, value, dialog.mode.folderId)) {
        return "同父目录下已有同名文件夹。";
      }
      return null;
    }
    // rename-note
    const target = space.notes[dialog.mode.noteId] ?? pendingDrafts[dialog.mode.noteId];
    if (!target) return null;
    if (isNoteTitleConflictMerged(space.notes, pendingDrafts, target.folderId, value, dialog.mode.noteId)) {
      return "同目录下已有同名 note。";
    }
    return null;
  }

  function handleDeleteFolder(folderId: string) {
    if (!isFolderEmpty(space, folderId)) {
      setPendingDialog({
        title: "文件夹非空，无法删除",
        message: "首版不支持递归删除。请先清空里面的文件夹和 note 后再删除。",
        onDismiss: () => setPendingDialog(null)
      });
      return;
    }
    commitSpace(deleteFolder(space, folderId));
    if (selection.kind === "folder" && selection.id === folderId) {
      setSelection({ kind: "root", id: null });
      setDraft(null);
    }
    setLastError(null);
  }

  function handleDeleteNote(noteId: string) {
    // pending draft：直接从内存里丢；不持久化、不弹任何"非空"等对话框。
    if (pendingDrafts[noteId]) {
      setPendingDrafts((prev) => {
        const next = { ...prev };
        delete next[noteId];
        return next;
      });
      if (selection.kind === "note" && selection.id === noteId) {
        setSelection({ kind: "root", id: null });
        setDraft(null);
        decryptedCacheRef.current = null;
      }
      setLastError(null);
      return;
    }
    if (!space.notes[noteId]) return;
    commitSpace(deleteNote(space, noteId));
    if (selection.kind === "note" && selection.id === noteId) {
      setSelection({ kind: "root", id: null });
      setDraft(null);
      decryptedCacheRef.current = null;
    }
    setLastError(null);
  }

  function handleMoveFolder(folderId: string, newParentId: string | null) {
    const next = moveFolder(space, folderId, newParentId);
    if (!next) {
      setPendingDialog({
        title: "无法移动文件夹",
        message: "目标位置不合法，或目标目录下已有同名文件夹。",
        onDismiss: () => setPendingDialog(null)
      });
      return;
    }
    commitSpace(next);
    setLastError(null);
  }

  function handleMoveNote(noteId: string, newFolderId: string | null) {
    // pending draft：folderId 直接在内存里改；不动 space，不写盘。
    if (pendingDrafts[noteId]) {
      const target = pendingDrafts[noteId];
      if (isNoteTitleConflictMerged(space.notes, pendingDrafts, newFolderId, target.title, noteId)) {
        setPendingDialog({
          title: "无法移动 note",
          message: "目标目录下已有同名 note，请改文件名或换目标文件夹。",
          onDismiss: () => setPendingDialog(null)
        });
        return;
      }
      setPendingDrafts((prev) => ({
        ...prev,
        [noteId]: { ...target, folderId: newFolderId, updatedAt: Date.now() }
      }));
      setLastError(null);
      return;
    }
    const next = moveNote(space, noteId, newFolderId);
    if (!next) {
      setPendingDialog({
        title: "无法移动 note",
        message: "目标目录下已有同名 note，请改文件名或换目标文件夹。",
        onDismiss: () => setPendingDialog(null)
      });
      return;
    }
    commitSpace(next);
    setLastError(null);
  }

  function commitSpace(next: StoredNotesSpace) {
    setSpace(next);
    if (identity) saveOwnerSpace(identity.publicKeyHex, next);
  }

  /* ============== 保存 ============== */

  /**
   * 保存链路：**原地 patch**。
   *
   * 设计缘由（施工单 2026-06-26 save-tag-folder-ux 第 4.1 / 5.1 / 6.6 / 6.7 章）：
   *   - 保存成功后**不**重新走 `openNote`、**不**把 draft 先置空再回填、**不**改 selection；
   *   - 步骤顺序必须为：
   *       (1) 同步 `decryptedCacheRef`；
   *       (2) 把 record 写入 space + 持久层；
   *       (3) 若是 pending note，从 `pendingDrafts` 移除（避免重新触发选中 effect）；
   *       (4) 仅 patch 当前 `draft` 的元数据（id / title / tags），markdown 保留。
   *   - 这条顺序必须保证 hydration effect 不会把刚保存好的当前 draft 又覆盖掉。
   */
  async function handleSave() {
    if (!identity || !draft) return;
    // 解密失败：禁止保存（不覆盖密文）。
    if (draft.decryptFailed) {
      setLastError("当前 note 解密失败，无法重新加密保存。请删除或切换 origin / active key 后重试。");
      return;
    }
    const titleCheck = validateTitle(draft.title);
    if (!titleCheck.ok) {
      setLastError(`保存失败：${titleCheck.failure.message}`);
      return;
    }
    const noteId = draft.noteId;
    const isPending = noteId !== null && pendingDrafts[noteId] !== undefined;
    const existingPersisted: StoredNoteRecord | null =
      noteId !== null ? space.notes[noteId] ?? null : null;
    const existingPending: StoredNoteRecord | null =
      noteId !== null ? pendingDrafts[noteId] ?? null : null;
    const existing = existingPersisted ?? existingPending;
    const isNew = existing === null;
    // 同目录冲突：drafts 与 persisted 都要纳入；排除自己。
    const folderIdForCheck = isNew ? resolveCreateParent() : existing!.folderId;
    if (isNoteTitleConflictMerged(space.notes, pendingDrafts, folderIdForCheck, titleCheck.title, noteId)) {
      setLastError(`保存失败：当前目录下已有同名 note "${titleCheck.title}"。`);
      return;
    }
    // 抓一份加密前的 draft：失败时仍按这份原样展示。
    const draftAtSave = draft;
    setLastError(null);
    try {
      const session = getSessionClient();
      const request = buildCipherEncryptRequest({
        text: "向 Notes Demo 加密当前 note 的 markdown",
        contentType: NOTE_CONTENT_TYPE,
        markdown: draftAtSave.markdown,
        requestId: makeRequestId()
      });
      const response = await session.runRequest(request);
      if (!response.ok) {
        setLastError(formatProtocolError(response.error.code, response.error.message));
        return;
      }
      const cipher = parseCipherEncryptResult(response.result as never);
      const now = Date.now();
      const record: StoredNoteRecord = {
        v: 2,
        id: existing?.id ?? cryptoRandomId(),
        folderId: folderIdForCheck,
        title: titleCheck.title,
        tags: normalizeTags(draftAtSave.tags),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        cipher: {
          contentType: NOTE_CONTENT_TYPE,
          nonceBase64: cipher.nonceBase64,
          cipherbytesBase64: cipher.cipherbytesBase64
        }
      };
      const next = putNote(space, record);
      // (1) 先同步解密缓存。
      decryptedCacheRef.current = { noteId: record.id, markdown: draftAtSave.markdown };
      // (2) 写入 space + 持久层。
      setSpace(next);
      saveOwnerSpace(identity.publicKeyHex, next);
      // (3) 若是 pending note，从 in-memory pendingDrafts 移除。
      //    顺序：先 setSpace 再 setPendingDrafts，避免 hydration effect 看到中间态。
      if (isPending && noteId !== null) {
        setPendingDrafts((prev) => {
          const c = { ...prev };
          delete c[noteId];
          return c;
        });
      }
      // (4) 原地 patch 当前 draft：
      //    - id：pending → persisted 后变化；
      //    - title / tags：保存后用最终值；
      //    - markdown：保留刚保存的明文，**不**清空；
      //    - selection / pendingDrafts 已经在上一步同步；本步**不**再触发重新打开链路。
      setDraft({
        noteId: record.id,
        title: record.title,
        tags: [...record.tags],
        markdown: draftAtSave.markdown,
        decryptFailed: false
      });
    } catch (err) {
      // 失败：当前 draft 保持原样，不清空编辑器、不清空选择状态。
      setLastError(formatTransportError(err));
    }
  }

  function handleReset() {
    if (!draft) return;
    if (draft.noteId === null) {
      setDraft(emptyDraft());
      return;
    }
    const record = space.notes[draft.noteId] ?? pendingDrafts[draft.noteId];
    if (!record) {
      setDraft(emptyDraft());
      return;
    }
    setDraft({
      noteId: record.id,
      title: record.title,
      tags: [...record.tags],
      markdown: decryptedCacheRef.current?.markdown ?? "",
      decryptFailed: false
    });
  }

  /* ============== 右键菜单触发 ============== */

  function handleFolderAction(action: FolderAction) {
    switch (action.type) {
      case "create-note":
        // 直接传 parentIdOverride，避免 setSelection 异步回退。
        handleCreateNote(action.folderId);
        return;
      case "create-folder":
        handleCreateFolder(action.folderId);
        return;
      case "rename":
        promptRenameFolder(action.folderId);
        return;
      case "delete":
        handleDeleteFolder(action.folderId);
        return;
      case "move-start":
        setMoveState({ kind: "folder", id: action.folderId });
        return;
    }
  }

  function handleNoteAction(action: NoteAction) {
    switch (action.type) {
      case "rename":
        promptRenameNote(action.noteId);
        return;
      case "delete":
        handleDeleteNote(action.noteId);
        return;
      case "move-start":
        setMoveState({ kind: "note", id: action.noteId });
        return;
    }
  }

  function handleRootAction(action: RootAction) {
    // 右键根目录 → 新建在根目录下。parentIdOverride = null。
    if (action.type === "create-note") {
      handleCreateNote(null);
      return;
    }
    if (action.type === "create-folder") {
      handleCreateFolder(null);
      return;
    }
  }

  function handleMoveTarget(target: { kind: "folder" | "root"; id: string | null }) {
    if (!moveState) return;
    const check = checkDragLegality(
      space.folders,
      { kind: moveState.kind, id: moveState.id },
      target.kind === "root" ? { kind: "root", id: null } : { kind: "folder", id: target.id }
    );
    if (!check.ok) {
      setLastError(describeDragLegalityReason(check.reason!));
      setMoveState(null);
      return;
    }
    if (moveState.kind === "folder") {
      handleMoveFolder(moveState.id, target.id);
    } else {
      handleMoveNote(moveState.id, target.id);
    }
    setMoveState(null);
  }

  function handleMoveCancel() {
    setMoveState(null);
  }

  /**
   * 触发"重命名文件夹"：开页面内命名弹层；不再使用 `window.prompt`。
   * 设计缘由（施工单 2026-06-26 save-tag-folder-ux 第 4.6 / 6.9 章）：
   *   - 同一页面不能并存"自定义命名弹层"与 `window.prompt`；
   *   - 重命名时若重名阻断并提示，**不**自动补编号。
   */
  function promptRenameFolder(folderId: string) {
    const target = getFolder(space, folderId);
    if (!target) return;
    setNameDialog({
      mode: { kind: "rename-folder", folderId },
      title: "重命名文件夹",
      description: "输入新文件夹名。若与同父目录下已有文件夹重名，将阻断。",
      initialValue: target.title,
      placeholder: "文件夹名",
      confirmLabel: "确认"
    });
    setLastError(null);
  }

  /**
   * 触发"重命名 note"：开页面内命名弹层；不再使用 `window.prompt`。
   * 初始值优先取持久化 record；若 note 是 pending draft（仅 in-memory），用 draft 的 title。
   */
  function promptRenameNote(noteId: string) {
    const target = getNote(space, noteId) ?? pendingDrafts[noteId];
    if (!target) return;
    setNameDialog({
      mode: { kind: "rename-note", noteId },
      title: "重命名 note",
      description: "输入新文件名（标题）。若与同目录下已有 note 重名，将阻断。",
      initialValue: target.title,
      placeholder: "文件名",
      confirmLabel: "确认"
    });
    setLastError(null);
  }

  /* ============== 拖拽 ============== */

  function handleDragStart(kind: "folder" | "note", id: string) {
    setDragging({ kind, id });
    setDropHover(null);
  }

  function handleDragEnd() {
    setDragging(null);
    setDropHover(null);
  }

  function handleDragOverTarget(target: { kind: "folder" | "root"; id: string | null }) {
    if (!dragging) {
      setDropHover(null);
      return;
    }
    const check = checkDragLegality(
      space.folders,
      dragging,
      target.kind === "root" ? { kind: "root", id: null } : { kind: "folder", id: target.id }
    );
    if (!check.ok) {
      setDropHover(null);
      return;
    }
    setDropHover(target);
  }

  function handleDropOnTarget(target: { kind: "folder" | "root"; id: string | null }) {
    if (!dragging) return;
    const check = checkDragLegality(
      space.folders,
      dragging,
      target.kind === "root" ? { kind: "root", id: null } : { kind: "folder", id: target.id }
    );
    if (!check.ok) {
      setLastError(describeDragLegalityReason(check.reason!));
      setDragging(null);
      setDropHover(null);
      return;
    }
    if (dragging.kind === "folder") {
      handleMoveFolder(dragging.id, target.id);
    } else {
      handleMoveNote(dragging.id, target.id);
    }
    setDragging(null);
    setDropHover(null);
  }

  /* ============== 派生 UI 数据 ============== */

  const allTags = useMemo(() => {
    const set = new Set<string>();
    // drafts 也算：用户在编辑中的 note 的 tag 也应参与聚合。
    for (const r of Object.values(space.notes)) {
      for (const t of r.tags) set.add(t.toLowerCase());
    }
    for (const r of Object.values(pendingDrafts)) {
      for (const t of r.tags) set.add(t.toLowerCase());
    }
    return [...set].sort();
  }, [space.notes, pendingDrafts]);

  /**
   * 侧栏真正显示的"view space"：持久层 + in-memory pendingDrafts。
   * drafts 永远不持久化——这里只是把它们"合并"到 UI 上，不进 localStorage。
   */
  const viewSpace = useMemo<StoredNotesSpace>(() => {
    const notes = { ...space.notes };
    for (const [id, draft] of Object.entries(pendingDrafts)) {
      // drafts 总是覆盖同名持久记录（不应该发生，作为兜底）。
      notes[id] = draft;
    }
    return { v: 1, folders: space.folders, notes };
  }, [space, pendingDrafts]);

  /**
   * 搜索 / tag 过滤后剩余的 note id 集合。
   * - searchQuery：note.title（trim + 小写）包含 query；
   * - activeTag：note.tags 含该 tag。
   * 不过滤 folder：folder 始终显示。
   */
  const visibleNoteIds = useMemo<Set<string> | null>(() => {
    const q = searchQuery.trim().toLowerCase();
    const tag = activeTag;
    if (!q && !tag) return null;
    const ids = new Set<string>();
    for (const n of Object.values(viewSpace.notes)) {
      if (tag && !n.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) continue;
      if (q && !n.title.trim().toLowerCase().includes(q)) continue;
      ids.add(n.id);
    }
    return ids;
  }, [viewSpace.notes, searchQuery, activeTag]);

  const currentFolder: StoredFolderRecord | null = useMemo(() => {
    if (selection.kind === "folder" && selection.id !== null) {
      return space.folders[selection.id] ?? null;
    }
    return null;
  }, [selection, space.folders]);

  const currentNoteRecord: StoredNoteRecord | null = useMemo(() => {
    if (selection.kind === "note" && selection.id !== null) {
      return space.notes[selection.id] ?? pendingDrafts[selection.id] ?? null;
    }
    return null;
  }, [selection, space.notes, pendingDrafts]);

  const dirty = useMemo(
    () =>
      draft && selection.kind === "note" && selection.id !== null
        ? draftHasChanges(space, pendingDrafts, selection.id, draft, decryptedCacheRef.current)
        : false,
    [space, pendingDrafts, draft, selection]
  );

  const titleError = useMemo(() => {
    if (!draft) return null;
    const check = validateTitle(draft.title);
    return check.ok ? null : check.failure.message;
  }, [draft]);

  const ownerLabel = identity ? truncate(identity.publicKeyHex, 8) : "";

  /* ============== 切换身份 / 删除当前数据 共用的退出清理 ============== */

  /**
   * 退出工作区 → 退回 LockScreen 时**统一**收口清空 notes 工作区内存态。
   *
   * 设计缘由（施工单 2026-06-26 delete-current-owner-space 第 7.2 节）：
   *   - "切换身份"与"删除当前 owner 数据成功"两个动作的最后一段清理完全一致，
   *     抽成共享函数避免代码分叉；
   *   - identity 置空 / space 置空 / pendingDrafts 置空 / selection / draft /
   *     右键菜单 / 拖拽 / move / 解密缓存 / pendingDialog / confirmDialog /
   *     searchQuery / activeTag / lastError 全清；
   *   - 同时关掉 popup session，防止旧 popup 持有 in-flight request 后
   *     异步回流污染新工作区。
   *   - **不**碰 localStorage——本函数只管内存态；是否删除数据由调用方决定。
   */
  function exitWorkspace() {
    sessionRef.current?.closeSession();
    sessionRef.current = null;
    setPopupState("idle");
    setIdentity(null);
    setSpace({ v: 1, folders: {}, notes: {} });
    setPendingDrafts({});
    setSelection({ kind: "root", id: null });
    setDraft(null);
    setDecryptError(null);
    setContextMenu(null);
    setDragging(null);
    setDropHover(null);
    setMoveState(null);
    setPendingDialog(null);
    setConfirmDialog(null);
    setNameDialog(null);
    decryptedCacheRef.current = null;
    setLastError(null);
    setSearchQuery("");
    setActiveTag(null);
  }

  /**
   * 切换身份 / 更换登录器：只退回登录壳，**不**删本地数据。
   *
   * 设计缘由（施工单 2026-06-26 lock-screen-custom-provider）：旧身份数据保留
   * 在 localStorage，再次登录同一 owner 时仍可见。
   */
  function handleSwitchIdentity() {
    exitWorkspace();
  }

  /* ============== 删除当前 owner 本地数据 ============== */

  /**
   * 删除当前 owner 的整个本地 notes 空间，然后退回 LockScreen。
   *
   * 设计缘由（施工单 2026-06-26 delete-current-owner-space）：
   *   - 唯一入口 = 已登录态页头；未登录态不放入口。
   *   - 删除前必须二次确认；一个确认框吃掉所有风险提示（含未保存 draft）。
   *   - 删除顺序硬约束（5.4 节）：先调持久层删除 → 只有返回成功才执行内存清理
   *     与退回 LockScreen；失败时不能假装成功、不能退回登录壳。
   *   - 删除对象 = `removeStorage(storageKeyForOwner(publicKeyHex))`；
   *     不递归遍历 note / folder，避免引入部分成功态。
   *   - 失败时仅展示错误文案，不动工作区，让用户可以重试。
   */
  function handleDeleteCurrentOwnerData() {
    if (!identity || isLoggingIn) return;
    const ownerHex = identity.publicKeyHex;
    setConfirmDialog({
      title: "确认删除当前本地数据？",
      message:
        "这会删除当前 publicKey 对应的全部本地 notes 数据，并立即退出当前工作区。\n" +
        "该操作只影响本浏览器当前站点下的数据，不会删除 Keymaster 身份本身。\n" +
        "不可恢复。",
      confirmLabel: "删除并退出",
      cancelLabel: "取消",
      onCancel: () => setConfirmDialog(null),
      onConfirm: () => {
        // 二次确认框先关掉，避免清空状态后旧弹窗挂在 React 树里。
        setConfirmDialog(null);
        // 删除失败时不能假装成功：先调持久层，失败仅展示错误，不清工作区。
        const ok = deleteOwnerSpace(ownerHex);
        if (!ok) {
          setLastError("删除当前本地数据失败，请重试。");
          return;
        }
        exitWorkspace();
      }
    });
  }

  /* ============== 顶层渲染 ============== */

  // 未登录态：只渲染 LockScreen；不显示 notes 工作区任何部分。
  if (!identity) {
    return (
      <LockScreen
        targetInput={targetOrigin}
        defaultTargetOrigin={DEFAULT_TARGET_ORIGIN}
        lastError={lastError}
        isLoggingIn={isLoggingIn}
        onTargetInputChange={setTargetOrigin}
        onUseDefault={() => setTargetOrigin(DEFAULT_TARGET_ORIGIN)}
        onLogin={() => void handleLogin()}
      />
    );
  }

  // 已登录态：渲染完整 notes 工作区。
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__eyebrow">Keymaster Notes</span>
          <h1>Notes Demo</h1>
          <p>真实调用 <code>identity.get</code> 与 <code>cipher.*</code> 的加密笔记工作区。</p>
        </div>
        <ConnectStatus
          state={popupState}
          currentOrigin={currentOrigin}
          targetOrigin={normalizedTargetOrigin || targetOrigin}
          publicKeyHex={identity?.publicKeyHex ?? null}
          lastLoginAt={identity?.resolvedAt ?? null}
          lastError={lastError}
          isLoggingIn={isLoggingIn}
          onLogin={() => void handleLogin()}
          onForget={handleSwitchIdentity}
          onDeleteCurrentData={handleDeleteCurrentOwnerData}
        />
      </header>

      <main className="workspace">
        <NotesSidebar
          space={viewSpace}
          visibleNoteIds={visibleNoteIds}
          selection={selection}
          searchQuery={searchQuery}
          activeTag={activeTag}
          contextMenu={contextMenu}
          dragging={dragging}
          dropHover={dropHover}
          moveState={moveState}
          ownerLabel={ownerLabel}
          disabled={isLoggingIn}
          onSelect={trySelect}
          onCreateNote={handleCreateNote}
          onCreateFolder={handleCreateFolder}
          onFolderAction={handleFolderAction}
          onNoteAction={handleNoteAction}
          onRootAction={handleRootAction}
          onContextMenu={setContextMenu}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOverTarget={handleDragOverTarget}
          onDropOnTarget={handleDropOnTarget}
          onMoveTarget={handleMoveTarget}
          onMoveCancel={handleMoveCancel}
          onSearchQueryChange={setSearchQuery}
          onActiveTagChange={setActiveTag}
          allTags={allTags}
        />

        <section className="editor-stage">
          {draft ? (
            <>
              <div className="editor-stage__header">
                <input
                  type="text"
                  className="editor-stage__filename"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="未命名 note"
                  disabled={!!draft.decryptFailed}
                  spellCheck={false}
                />
                <span className="editor-stage__filename-hint">文件名（保存时会写入 note record）</span>
              </div>
              <NoteEditor
                markdown={draft.markdown}
                editable={!!identity && !draft.decryptFailed}
                decryptFailed={draft.decryptFailed}
                onChange={(md) => setDraft((prev) => (prev ? { ...prev, markdown: md } : prev))}
              />
              {decryptError ? (
                <p className="editor-stage__error">解密失败：{decryptError}</p>
              ) : null}
            </>
          ) : (
            <div className="editor-stage__empty">
              <h2>选择或新建一个 note</h2>
              <p>
                左侧选择文件夹或 note；右键文件夹可新建 / 删除 / 移动；右键 note 可重命名 / 移动 / 删除。
              </p>
            </div>
          )}
        </section>

        {draft ? (
          <NoteInspector
            draft={draft}
            record={currentNoteRecord}
            isDirty={dirty}
            titleError={titleError}
            canEdit={!!identity && !isLoggingIn && !draft.decryptFailed}
            canDelete={!!identity && !isLoggingIn}
            decryptFailed={draft.decryptFailed}
            onChangeTitle={(t) => setDraft((prev) => (prev ? { ...prev, title: t } : prev))}
            onChangeTags={(tags) => setDraft((prev) => (prev ? { ...prev, tags } : prev))}
            onSave={() => void handleSave()}
            onDelete={() => draft.noteId && handleDeleteNote(draft.noteId)}
            onReset={handleReset}
          />
        ) : currentFolder ? (
          <NoteInspector
            draft={null}
            record={null}
            folder={currentFolder}
            isDirty={false}
            titleError={null}
            canEdit={!!identity && !isLoggingIn}
            canDelete={!!identity && !isLoggingIn}
            decryptFailed={false}
            onChangeTitle={() => undefined}
            onChangeTags={() => undefined}
            onSave={() => undefined}
            onDelete={() => handleDeleteFolder(currentFolder.id)}
            onReset={() => undefined}
          />
        ) : null}
      </main>

      {pendingDialog ? (
        <div className="confirm-dialog" role="dialog" aria-modal="true">
          <div className="confirm-dialog__box">
            <h3>{pendingDialog.title}</h3>
            <p>{pendingDialog.message}</p>
            <div className="confirm-dialog__actions">
              <button type="button" className="primary-button" onClick={pendingDialog.onDismiss}>
                知道了
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDialog ? (
        <div className="confirm-dialog" role="dialog" aria-modal="true">
          <div className="confirm-dialog__box">
            <h3>{confirmDialog.title}</h3>
            <p>{confirmDialog.message}</p>
            <div className="confirm-dialog__actions">
              <button type="button" className="secondary-button" onClick={confirmDialog.onCancel}>
                {confirmDialog.cancelLabel}
              </button>
              <button type="button" className="primary-button" onClick={confirmDialog.onConfirm}>
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {nameDialog ? (
        <NameInputDialog
          title={nameDialog.title}
          description={nameDialog.description}
          initialValue={nameDialog.initialValue}
          placeholder={nameDialog.placeholder}
          confirmLabel={nameDialog.confirmLabel}
          validate={validateNameDialogValue}
          onConfirm={handleNameDialogConfirm}
          onCancel={handleNameDialogCancel}
        />
      ) : null}
    </div>
  );
}

/* ============== 工具 ============== */

function makeRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function truncate(value: string, head: number): string {
  if (value.length <= head + 4) return value;
  return `${value.slice(0, head)}…${value.slice(-4)}`;
}

/**
 * dirty 判定：区分"已持久化 note"与"pending note"两种基线。
 *
 * 设计缘由（施工单 2026-06-26 save-tag-folder-ux 第 4.2 / 5.2 章）：
 *   - 已持久化 note：markdown 基线来自解密缓存 `cached.markdown`；
 *   - pending note（首次保存前）：markdown 基线 = 空字符串，
 *     不能因为没有 persisted cipher 就把 markdown 变化忽略掉。
 *     这是修复"新建 note 只改 markdown 时 save 按钮不亮"的关键。
 *   - 整体判断**不**依赖 tag 是否为空；tag 可空。
 *   - pendingDrafts **不**持久化明文 markdown；不在这里读 pending 做 markdown 比对。
 */
function draftHasChanges(
  space: StoredNotesSpace,
  pending: Record<string, StoredNoteRecord>,
  noteId: string | null,
  draft: NoteDraft,
  cached: DecryptedCache | null
): boolean {
  if (draft.decryptFailed) return false;
  if (noteId === null) {
    return draft.title.length > 0 || draft.tags.length > 0 || draft.markdown.length > 0;
  }
  const persisted = space.notes[noteId];
  const isPending = persisted === undefined;
  if (!persisted && !pending[noteId]) return true;
  // 共有：title / tags 跟 record 比对（pending record / persisted record 都行）。
  const record = persisted ?? pending[noteId]!;
  if (draft.title !== record.title) return true;
  if (draft.tags.join(",") !== record.tags.join(",")) return true;
  // markdown 基线按 isPending 区分。
  if (isPending) {
    // pending note 尚未保存过：markdown 基线 = 空字符串。
    return draft.markdown.length > 0;
  }
  // 已持久化：基线来自解密缓存（与该 noteId 一致时）。
  if (cached && cached.noteId === noteId) {
    return cached.markdown !== draft.markdown;
  }
  // 没缓存：保守起见视为未变化（hydration 进行中）。
  return false;
}

function formatProtocolError(code: ProtocolErrorCode, message: string): string {
  const map: Record<ProtocolErrorCode, string> = {
    invalid_request: "无效请求",
    invalid_origin: "来源非法",
    user_rejected: "用户在 Keymaster 中取消",
    active_key_unavailable: "当前 Keymaster 没有可用 active key",
    decrypt_failed: "解密失败（可能 origin / active key 切换）",
    internal_error: "Keymaster 内部错误"
  };
  return `${map[code]}: ${message}`;
}

function formatTransportError(error: unknown): string {
  if (error instanceof ProtocolTransportError) {
    const map: Record<string, string> = {
      popup_blocked: "popup 被浏览器拦截",
      popup_closed: "popup 在协议完成前被关闭",
      ready_timeout: "等待 popup ready 超时",
      result_timeout: "等待 result 超时",
      invalid_origin: "消息来源非法",
      session_busy: "popup session 繁忙",
      no_session: "无 session"
    };
    return `${map[error.code] ?? error.code}: ${error.message}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * 把持久层 notes 与 in-memory pendingDrafts 合并后再做"同目录重名"判断。
 * 用途：drag / 右键菜单新建 / 右键菜单移动 / 保存重命名 等所有可能跨越两层来源的动作。
 */
function isNoteTitleConflictMerged(
  persisted: Record<string, StoredNoteRecord>,
  pending: Record<string, StoredNoteRecord>,
  folderId: string | null,
  title: string,
  excludeNoteId: string | null
): boolean {
  const trimmed = title.trim();
  for (const n of Object.values(persisted)) {
    if (excludeNoteId !== null && n.id === excludeNoteId) continue;
    if (n.folderId !== folderId) continue;
    if (n.title.trim() === trimmed) return true;
  }
  for (const n of Object.values(pending)) {
    if (excludeNoteId !== null && n.id === excludeNoteId) continue;
    if (n.folderId !== folderId) continue;
    if (n.title.trim() === trimmed) return true;
  }
  return false;
}