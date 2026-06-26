// src/App.tsx
// Notes Demo 页面级状态与编排。
//
// 设计缘由（施工单 2026-06-26 lock-screen-custom-provider 第 4-10 章）：
//   - 页面顶层固定二态：`identity === null` 时只渲染 `LockScreen`；
//     `identity !== null` 时才渲染 notes 工作区。
//   - 不在初始化时自动恢复 identity；刷新页面回到 LockScreen 是预期行为，不是缺陷。
//   - 登录成功后按 `identity.publicKeyHex` 调 `loadOwnerSpace`。
//   - "切换身份 / 更换登录器" 退回 LockScreen 时统一收口清空 notes 工作区内存态。
//   - 选中 / 右键菜单 / 拖拽 / 解密缓存等真值仍然集中在 App 这一层。
//   - 解密失败：note 仍保留；metadata 锁死；删除仍然允许。
//   - 右键菜单 / 拖拽状态集中在这里管理；sidebar 只负责"显示 + 触发"。

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
   */
  function handleCreateNote(parentIdOverride?: string | null) {
    if (!identity) return;
    const parentId = parentIdOverride === undefined ? resolveCreateParent() : parentIdOverride;
    const now = Date.now();
    const id = cryptoRandomId();
    // 同目录重名检查：space.notes + pendingDrafts 都要纳入。
    if (isNoteTitleConflictMerged(space.notes, pendingDrafts, parentId, "新 note", null)) {
      setLastError("新建 note 失败：同目录下已有同名 note。");
      return;
    }
    const draftNote: StoredNoteRecord = {
      v: 2,
      id,
      folderId: parentId,
      title: "新 note",
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

  function handleCreateFolder(parentIdOverride?: string | null) {
    if (!identity) return;
    const parentId = parentIdOverride === undefined ? resolveCreateParent() : parentIdOverride;
    const result = createFolder(space, { parentId, title: "新文件夹" });
    if (!result) {
      setLastError("新建文件夹失败：同目录下已有同名文件夹。");
      return;
    }
    commitSpace(result.next);
    setLastError(null);
    setSelection({ kind: "folder", id: result.folder.id });
    setDraft(null);
  }

  function handleRenameFolder(folderId: string, title: string) {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setLastError("文件夹名不能为空。");
      return;
    }
    const result = renameFolder(space, folderId, trimmed);
    if (!result) {
      setLastError("重命名失败：同目录下已有同名文件夹。");
      return;
    }
    commitSpace(result.next);
    setLastError(null);
  }

  function handleRenameNote(noteId: string, title: string) {
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setLastError("文件名（标题）不能为空。");
      return;
    }
    // pending draft
    if (pendingDrafts[noteId]) {
      const target = pendingDrafts[noteId];
      if (isNoteTitleConflictMerged(space.notes, pendingDrafts, target.folderId, trimmed, noteId)) {
        setLastError("重命名失败：同目录下已有同名 note。");
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
      return;
    }
    const target = space.notes[noteId];
    if (!target) return;
    if (isNoteTitleConflict(space.notes, target.folderId, trimmed, noteId)) {
      setLastError("重命名失败：同目录下已有同名 note。");
      return;
    }
    const updated: StoredNoteRecord = { ...target, title: trimmed, updatedAt: Date.now() };
    commitSpace(putNote(space, updated));
    if (draft && draft.noteId === noteId) {
      setDraft({ ...draft, title: trimmed });
    }
    setLastError(null);
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
    setLastError(null);
    try {
      const session = getSessionClient();
      const request = buildCipherEncryptRequest({
        text: "向 Notes Demo 加密当前 note 的 markdown",
        contentType: NOTE_CONTENT_TYPE,
        markdown: draft.markdown,
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
        tags: normalizeTags(draft.tags),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        cipher: {
          contentType: NOTE_CONTENT_TYPE,
          nonceBase64: cipher.nonceBase64,
          cipherbytesBase64: cipher.cipherbytesBase64
        }
      };
      const next = putNote(space, record);
      // 真值已带密文：落库；同时把这条 note 从 in-memory pendingDrafts 移除。
      setSpace(next);
      if (identity) saveOwnerSpace(identity.publicKeyHex, next);
      if (isPending && noteId !== null) {
        setPendingDrafts((prev) => {
          const c = { ...prev };
          delete c[noteId];
          return c;
        });
      }
      decryptedCacheRef.current = { noteId: record.id, markdown: draft.markdown };
      setSelection({ kind: "note", id: record.id });
      setDraft({
        noteId: record.id,
        title: record.title,
        tags: [...record.tags],
        markdown: draft.markdown,
        decryptFailed: false
      });
    } catch (err) {
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

  function promptRenameFolder(folderId: string) {
    const target = getFolder(space, folderId);
    if (!target) return;
    const next = window.prompt("重命名文件夹", target.title);
    if (next === null) return;
    handleRenameFolder(folderId, next);
  }

  function promptRenameNote(noteId: string) {
    const target = getNote(space, noteId);
    if (!target) return;
    const next = window.prompt("重命名 note", target.title);
    if (next === null) return;
    handleRenameNote(noteId, next);
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

  /* ============== 切换身份 / 更换登录器 ============== */

  /**
   * 退回 LockScreen 时统一收口清空 notes 工作区内存态：
   * - identity 置空；
   * - 当前 space 置空；
   * - pendingDrafts 置空；
   * - selection / draft / 右键菜单 / 拖拽态 / move 态全清；
   * - 解密缓存清空；
   * - pendingDialog / confirmDialog 弹窗态全清——否则旧弹窗会在下一次
   *   登录后重新出现，污染新 owner 的工作区。
   *
   * 不删除 localStorage 中已有 owner 分区数据。
   */
  function handleSwitchIdentity() {
    // 关掉已有 session，确保 popup 不再持有 in-flight request。
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
    decryptedCacheRef.current = null;
    setLastError(null);
    setSearchQuery("");
    setActiveTag(null);
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
  const record = space.notes[noteId] ?? pending[noteId];
  if (!record) return true;
  if (draft.title !== record.title) return true;
  if (draft.tags.join(",") !== record.tags.join(",")) return true;
  if (cached && cached.noteId === noteId) {
    return cached.markdown !== draft.markdown;
  }
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