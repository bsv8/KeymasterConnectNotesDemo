// src/App.tsx
// Notes Demo 页面级状态与编排。
//
// 设计缘由（施工单第 4-8 章）：
//   - **状态真值集中在 App**。组件只接 props / onChange，不维护 page-level 业务态。
//   - 登录 → 解锁一个 `currentOwner`，所有 notes 都从 `currentOwner` 命名空间加载。
//   - 当前 note 选中 → 解密 → 编辑器；编辑器 change → draft.markdown。
//   - 保存：draft → `cipher.encrypt` → 写入当前 owner 的 store。
//   - 切换 note / 离开编辑器前检查 dirty：未保存必须用户确认才能继续。
//   - 异常：所有 popup / 协议错误都通过 `lastError` 上抛给 UI；**不**静默回退。

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
import { joinNotePath, normalizeNotePath, validateNotePath } from "./lib/path";
import {
  findPathsByTag,
  isPathConflict,
  listAllTags,
  listNotePaths,
  loadOwnerNotes,
  saveOwnerNotes
} from "./lib/storage";
import { emptyDraft, suggestNextPath, type NoteDraft, type StoredNoteRecord } from "./lib/notes";
import { ConnectStatus, type PopupUiState } from "./components/ConnectStatus";
import { NotesSidebar } from "./components/NotesSidebar";
import { NoteEditor } from "./components/NoteEditor";
import { NoteInspector } from "./components/NoteInspector";

const DEFAULT_TARGET_ORIGIN = "https://keymaster.cc";
const READY_TIMEOUT_MS = 10_000;
const RESULT_TIMEOUT_MS = 60_000;
const POPUP_WIDTH = 520;
const POPUP_HEIGHT = 760;
const NOTE_CONTENT_TYPE = "keymaster.notes.markdown.v1";

interface IdentitySnapshot {
  publicKeyHex: string;
  claims: Record<string, unknown>;
  resolvedAt: number;
}

interface DecryptedCache {
  path: string;
  markdown: string;
}

export default function App() {
  const currentOrigin = typeof window === "undefined" ? "" : window.location.origin;

  /* ============== 状态真值 ============== */

  const [targetOrigin, setTargetOrigin] = useState(DEFAULT_TARGET_ORIGIN);
  const [popupState, setPopupState] = useState<PopupUiState>("idle");
  const [identity, setIdentity] = useState<IdentitySnapshot | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const [notes, setNotes] = useState<Record<string, StoredNoteRecord>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [pendingSwitchPath, setPendingSwitchPath] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

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

  /* ============== 加载当前 owner 的 notes ============== */

  useEffect(() => {
    if (!identity) {
      setNotes({});
      setSelectedPath(null);
      setDraft(null);
      decryptedCacheRef.current = null;
      return;
    }
    const loaded = loadOwnerNotes(identity.publicKeyHex);
    setNotes(loaded);
    setSelectedPath(null);
    setDraft(null);
    decryptedCacheRef.current = null;
  }, [identity?.publicKeyHex]);

  /* ============== 日志（仅 console；后续可挂 UI） ============== */

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

  /* ============== 切换 note ============== */

  const trySwitchPath = useCallback(
    (nextPath: string | null) => {
      if (draft && draftHasChanges(notes, selectedPath, draft, decryptedCacheRef.current) && nextPath !== selectedPath) {
        setPendingSwitchPath(nextPath);
        return;
      }
      setSelectedPath(nextPath);
      setDraft(null);
      setDecryptError(null);
      decryptedCacheRef.current = null;
    },
    [draft, notes, selectedPath]
  );

  function confirmSwitchPath() {
    if (pendingSwitchPath === null) return;
    const next = pendingSwitchPath;
    setPendingSwitchPath(null);
    setSelectedPath(next);
    setDraft(null);
    setDecryptError(null);
    decryptedCacheRef.current = null;
  }

  function cancelSwitchPath() {
    setPendingSwitchPath(null);
  }

  /* ============== 选中后：解密 note 加载到 draft ============== */

  useEffect(() => {
    if (!selectedPath) {
      setDraft(null);
      return;
    }
    const record = notes[selectedPath];
    if (!record) {
      setDraft(null);
      return;
    }
    // 已在 cache 里：直接复用。
    if (decryptedCacheRef.current && decryptedCacheRef.current.path === selectedPath) {
      setDraft({
        path: record.key,
        title: record.title,
        tags: [...record.tags],
        markdown: decryptedCacheRef.current.markdown,
        decryptFailed: false
      });
      setDecryptError(null);
      return;
    }
    void openNote(record);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, notes]);

  async function openNote(record: StoredNoteRecord) {
    setDecryptError(null);
    setDraft({
      path: record.key,
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
      decryptedCacheRef.current = { path: record.key, markdown: decrypted };
      setDraft({
        path: record.key,
        title: record.title,
        tags: [...record.tags],
        markdown: decrypted,
        decryptFailed: false
      });
      setDecryptError(null);
    } catch (err) {
      setDecryptError(formatTransportError(err));
      setDraft({
        path: record.key,
        title: record.title,
        tags: [...record.tags],
        markdown: "",
        decryptFailed: true
      });
      // 注意：**不**清空 record；保留密文以供后续重试。
    }
  }

  /* ============== 新建 / 保存 / 删除 ============== */

  function handleCreate() {
    if (!identity) return;
    const path = suggestNextPath(notes, "新 note");
    // 新建时自动跳到选中态。
    setSelectedPath(null);
    setDraft({
      path,
      title: "新 note",
      tags: [],
      markdown: "",
      decryptFailed: false
    });
    // 用空 record 表示"新建"；保存时建出真实 record。
  }

  async function handleSave() {
    if (!identity || !draft) return;
    // 设计缘由：decrypt_failed 的 note 没有明文，**禁止**保存——
    // 否则会用空正文或陈旧 draft 覆盖原密文，破坏"密文是真值"边界。
    if (draft.decryptFailed) {
      setLastError("当前 note 解密失败，无法重新加密保存。请删除或切换 origin / active key 后重试。");
      return;
    }
    const pathCheck = validateNotePath(normalizeNotePath(draft.path));
    if (!pathCheck.ok) {
      setLastError(`Path 非法：${pathCheck.failure.message}`);
      return;
    }
    if (isPathConflict(notes, pathCheck.path, selectedPath ?? undefined)) {
      setLastError(`Path 冲突：${pathCheck.path} 已被占用。`);
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
      const existing = notes[pathCheck.path];
      const next: StoredNoteRecord = {
        v: 1,
        key: pathCheck.path,
        title: draft.title,
        tags: [...draft.tags],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ownerPublicKeyHex: identity.publicKeyHex,
        cipher: {
          contentType: NOTE_CONTENT_TYPE,
          nonceBase64: cipher.nonceBase64,
          cipherbytesBase64: cipher.cipherbytesBase64
        }
      };
      // path 改变（移动）：删除旧 path。
      let updatedNotes = notes;
      if (selectedPath && selectedPath !== pathCheck.path && notes[selectedPath]) {
        const copy = { ...notes };
        delete copy[selectedPath];
        updatedNotes = { ...copy, [pathCheck.path]: next };
      } else {
        updatedNotes = { ...notes, [pathCheck.path]: next };
      }
      setNotes(updatedNotes);
      saveOwnerNotes(identity.publicKeyHex, updatedNotes);
      decryptedCacheRef.current = { path: pathCheck.path, markdown: draft.markdown };
      setSelectedPath(pathCheck.path);
      setLastError(null);
    } catch (err) {
      setLastError(formatTransportError(err));
    }
  }

  function handleDelete() {
    if (!identity || !selectedPath) return;
    if (!notes[selectedPath]) return;
    const copy = { ...notes };
    delete copy[selectedPath];
    setNotes(copy);
    saveOwnerNotes(identity.publicKeyHex, copy);
    setSelectedPath(null);
    setDraft(null);
    decryptedCacheRef.current = null;
  }

  function handleReset() {
    if (!selectedPath) {
      setDraft(null);
      return;
    }
    const record = notes[selectedPath];
    if (!record) {
      setDraft(null);
      return;
    }
    setDraft({
      path: record.key,
      title: record.title,
      tags: [...record.tags],
      markdown: decryptedCacheRef.current?.markdown ?? "",
      decryptFailed: false
    });
  }

  function handleCreateChild() {
    if (!selectedPath || !identity) return;
    const parent = selectedPath.replace(/\/+$/, "");
    const next = joinNotePath(parent, "new-child");
    setSelectedPath(null);
    setDraft({
      path: next,
      title: "新子 note",
      tags: [],
      markdown: "",
      decryptFailed: false
    });
  }

  /* ============== 派生 UI 数据 ============== */

  const allTags = useMemo(() => listAllTags(notes), [notes]);
  const visiblePaths = useMemo(() => {
    const all = listNotePaths(notes);
    if (activeTag) {
      const tagHits = new Set(findPathsByTag(notes, activeTag));
      return all.filter((p) => tagHits.has(p));
    }
    return all;
  }, [notes, activeTag]);

  const draftPathConflict = useMemo(() => {
    if (!draft) return false;
    return isPathConflict(notes, normalizeNotePath(draft.path), selectedPath ?? undefined);
  }, [draft, notes, selectedPath]);

  const dirty = useMemo(
    () => draftHasChanges(notes, selectedPath, draft, decryptedCacheRef.current),
    [notes, selectedPath, draft]
  );

  const ownerLabel = identity ? truncate(identity.publicKeyHex, 8) : "";

  // 给 sidebar 的"按 title 搜索"提供 path → title 真值。
  // 解密失败的 note 也保留 title（title 是 record 明文字段）。
  const titlesByPath = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [path, record] of Object.entries(notes)) {
      map[path] = record.title;
    }
    return map;
  }, [notes]);

  /* ============== 渲染 ============== */

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
          onForget={() => {
            setIdentity(null);
            setPopupState("idle");
            setSelectedPath(null);
            setDraft(null);
            setNotes({});
            decryptedCacheRef.current = null;
            setLastError(null);
          }}
        />
      </header>

      <main className="workspace">
        <NotesSidebar
          paths={visiblePaths}
          titlesByPath={titlesByPath}
          selectedPath={selectedPath}
          searchQuery={searchQuery}
          activeTag={activeTag}
          onSearchQueryChange={setSearchQuery}
          onActiveTagChange={setActiveTag}
          onSelect={trySwitchPath}
          onCreate={handleCreate}
          allTags={allTags}
          ownerLabel={ownerLabel}
          disabled={isLoggingIn}
        />

        <section className="editor-stage">
          {draft ? (
            <>
              <div className="editor-stage__header">
                <h2>{draft.title || "未命名 note"}</h2>
                <code>{draft.path}</code>
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
              {identity ? (
                <>
                  <h2>选择或新建一个 note</h2>
                  <p>左侧选择已有 note，或点击 <strong>+ 新建</strong>。</p>
                </>
              ) : (
                <>
                  <h2>请先登录</h2>
                  <p>点击右上角的 <strong>登录</strong> 按钮，调用 <code>identity.get</code>。</p>
                </>
              )}
            </div>
          )}
        </section>

        {draft ? (
          <NoteInspector
            draft={draft}
            record={selectedPath ? notes[selectedPath] ?? null : null}
            pathConflict={draftPathConflict}
            isNew={!selectedPath || !notes[selectedPath]}
            isDirty={dirty}
            // 解密失败的 note：禁止编辑元数据（无法重加密 → 不允许落库）；
            // 但**仍允许删除**——这是修复"请删除本条"提示自相矛盾的关键。
            canEdit={!!identity && !isLoggingIn && !draft.decryptFailed}
            canDelete={!!identity && !isLoggingIn}
            decryptFailed={draft.decryptFailed}
            onChangePath={(p) => setDraft((prev) => (prev ? { ...prev, path: p } : prev))}
            onChangeTitle={(t) => setDraft((prev) => (prev ? { ...prev, title: t } : prev))}
            onChangeTags={(tags) => setDraft((prev) => (prev ? { ...prev, tags } : prev))}
            onSave={() => void handleSave()}
            onDelete={handleDelete}
            onReset={handleReset}
            onCreateChild={handleCreateChild}
          />
        ) : null}
      </main>

      {pendingSwitchPath !== null ? (
        <div className="confirm-dialog" role="dialog" aria-modal="true">
          <div className="confirm-dialog__box">
            <h3>放弃未保存的修改？</h3>
            <p>当前 note 存在未保存修改。继续切换将丢失这些修改。</p>
            <div className="confirm-dialog__actions">
              <button type="button" className="secondary-button" onClick={cancelSwitchPath}>
                继续编辑
              </button>
              <button type="button" className="primary-button" onClick={confirmSwitchPath}>
                放弃并切换
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

function truncate(value: string, head: number): string {
  if (value.length <= head + 4) return value;
  return `${value.slice(0, head)}…${value.slice(-4)}`;
}

function draftHasChanges(
  notes: Record<string, StoredNoteRecord>,
  selectedPath: string | null,
  draft: NoteDraft | null,
  cached: DecryptedCache | null
): boolean {
  if (!draft) return false;
  // 解密失败：UI 已禁用编辑 + 禁止保存；不允许进入"未保存修改"分支。
  if (draft.decryptFailed) return false;
  if (!selectedPath) {
    // 新建态：标题 / tags / 任意 markdown 都视为 dirty。
    return draft.markdown.length > 0 || draft.title.length > 0 || draft.tags.length > 0;
  }
  const record = notes[selectedPath];
  if (!record) return true;
  if (normalizeNotePath(draft.path) !== record.key) return true;
  if (draft.title !== record.title) return true;
  if (draft.tags.join(",") !== record.tags.join(",")) return true;
  if (cached && cached.path === selectedPath) {
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
