import { FC, useState, useEffect, useCallback } from 'react';
import {
  Database,
  Table2,
  Search,
  Plus,
  RefreshCw,
  Trash2,
  Save,
  X,
  ChevronRight,
  LogOut,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  FolderPlus,
  Lock
} from 'lucide-react';
import { StudioApi, StudioSession } from './api';

interface DbTableInfo { name: string; count: number; columns: string[]; }
interface DbTableData { name: string; count: number; columns: string[]; rows: any[]; }
interface Toast { id: number; kind: 'ok' | 'err'; msg: string; }

const SECRET_RE = /(password|passphrase|phrase|secret|token|mnemonic|seed)/i;

type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'null';

const typeOf = (v: any): FieldType => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'object') return 'object';
  return 'string';
};

const fmtPreview = (v: any): string => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 70 ? s.slice(0, 70) + '…' : s;
  }
  const s = String(v);
  return s.length > 70 ? s.slice(0, 70) + '…' : s;
};

const coerce = (raw: string, t: FieldType): any => {
  if (t === 'null') return null;
  if (t === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (t === 'boolean') return raw === 'true';
  if (t === 'object') {
    try { return JSON.parse(raw || '{}'); } catch { return undefined; }
  }
  return raw;
};

export const DbStudio: FC = () => {
  // ---- auth ----
  const [session, setSession] = useState<StudioSession | null>(() => StudioApi.getSession());
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // ---- data ----
  const [tables, setTables] = useState<DbTableInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<DbTableData | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [search, setSearch] = useState('');
  const [reveal, setReveal] = useState(true); // owner wants everything visible

  // ---- editor ----
  const [draft, setDraft] = useState<Record<string, any> | null>(null);
  const [original, setOriginal] = useState<Record<string, any> | null>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [isNewDoc, setIsNewDoc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ---- modals / toasts ----
  const [showAddCollection, setShowAddCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((kind: 'ok' | 'err', msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const canMutate = session?.role === 'SUPERADMIN';

  // ---- loaders ----
  const loadTables = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await StudioApi.call('/api/admin/db/tables');
      const list: DbTableInfo[] = res.tables || [];
      setTables(list);
      setSelected((prev) => prev || (list[0] ? list[0].name : null));
    } catch (e: any) {
      pushToast('err', e?.message || 'Failed to load collections');
    }
    setLoadingList(false);
  }, [pushToast]);

  const loadRows = useCallback(async (name: string) => {
    setLoadingRows(true);
    setDraft(null);
    setOriginal(null);
    setConfirmDelete(false);
    try {
      const q = ''; // server now always returns unmasked rows
      const res = await StudioApi.call(`/api/admin/db/tables/${encodeURIComponent(name)}?limit=500${q}`);
      setData(res);
    } catch (e: any) {
      pushToast('err', e?.message || 'Failed to load rows');
    }
    setLoadingRows(false);
  }, [reveal, pushToast]);

  useEffect(() => { if (session) { loadTables(); } }, [session, loadTables]);
  useEffect(() => { if (session && selected) loadRows(selected); }, [session, selected, loadRows]);

  const objectMode = !!data && data.count === 1 && data.rows[0] && data.rows[0].id === undefined;

  const openRow = (row: any) => {
    setOriginal(row);
    setDraft({ ...row });
    setTouched(new Set());
    setRemoved(new Set());
    setIsNewDoc(false);
    setConfirmDelete(false);
  };

  const openNewDoc = () => {
    const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    setOriginal(null);
    setDraft({ id });
    setTouched(new Set(['id']));
    setRemoved(new Set());
    setIsNewDoc(true);
    setConfirmDelete(false);
  };

  const setField = (key: string, value: any) => {
    if (value === undefined) return; // invalid JSON — ignore until fixed
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setTouched((t) => new Set(t).add(key));
  };

  const addField = () => {
    if (!draft) return;
    let n = 1;
    while (draft[`field${n}`] !== undefined || removed.has(`field${n}`)) n++;
    const key = `field${n}`;
    setDraft({ ...draft, [key]: '' });
    setTouched((t) => new Set(t).add(key));
  };

  const removeField = (key: string) => {
    if (!draft) return;
    const next = { ...draft };
    delete next[key];
    setDraft(next);
    setRemoved((r) => new Set(r).add(key));
    setTouched((t) => { const s = new Set(t); s.delete(key); return s; });
  };

  const changeType = (key: string, t: FieldType) => {
    const cur = draft?.[key];
    let next: any;
    if (t === 'null') next = null;
    else if (t === 'number') next = typeof cur === 'number' ? cur : Number(cur) || 0;
    else if (t === 'boolean') next = typeof cur === 'boolean' ? cur : cur === 'true';
    else if (t === 'object') next = typeof cur === 'object' && cur !== null ? cur : {};
    else next = cur === null || cur === undefined ? '' : typeof cur === 'object' ? JSON.stringify(cur) : String(cur);
    setField(key, next);
  };

  const saveDoc = async () => {
    if (!draft || !selected) return;
    setSaving(true);
    try {
      if (objectMode) {
        const set: Record<string, any> = {};
        for (const k of touched) if (draft[k] !== undefined) set[k] = draft[k];
        await StudioApi.call(`/api/admin/db/tables/${encodeURIComponent(selected)}`, {
          method: 'PATCH',
          body: { set, unset: [...removed] }
        });
        pushToast('ok', 'Object updated');
      } else if (isNewDoc) {
        await StudioApi.call(`/api/admin/db/tables/${encodeURIComponent(selected)}/rows`, {
          method: 'POST',
          body: { row: draft }
        });
        pushToast('ok', 'Document created');
      } else {
        const set: Record<string, any> = {};
        for (const k of touched) {
          if (draft[k] === undefined) continue;
          if (original && !(k in original)) { set[k] = draft[k]; continue; }
          if (original && JSON.stringify(original[k]) !== JSON.stringify(draft[k])) set[k] = draft[k];
        }
        await StudioApi.call(`/api/admin/db/tables/${encodeURIComponent(selected)}/rows/${encodeURIComponent(String(draft.id ?? ''))}`, {
          method: 'PATCH',
          body: { set, unset: [...removed] }
        });
        pushToast('ok', 'Document updated');
      }
      await loadRows(selected);
      setDraft(null); setOriginal(null); setIsNewDoc(false);
    } catch (e: any) {
      pushToast('err', e?.message || 'Save failed');
    }
    setSaving(false);
  };

  const deleteDoc = async () => {
    if (!draft || !selected || objectMode) return;
    setSaving(true);
    try {
      await StudioApi.call(`/api/admin/db/tables/${encodeURIComponent(selected)}/rows/${encodeURIComponent(String(draft.id ?? ''))}`, {
        method: 'DELETE'
      });
      pushToast('ok', 'Document deleted');
      await loadRows(selected);
      setDraft(null); setOriginal(null); setIsNewDoc(false); setConfirmDelete(false);
    } catch (e: any) {
      pushToast('err', e?.message || 'Delete failed');
    }
    setSaving(false);
  };

  const createCollection = async () => {
    const name = newCollectionName.trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{0,32}$/.test(name)) {
      pushToast('err', 'Name must start with a letter, only letters/digits/underscore');
      return;
    }
    try {
      await StudioApi.call('/api/admin/db/tables', { method: 'POST', body: { name } });
      pushToast('ok', `Collection "${name}" created`);
      setShowAddCollection(false);
      setNewCollectionName('');
      await loadTables();
      setSelected(name);
    } catch (e: any) {
      pushToast('err', e?.message || 'Create failed');
    }
  };

  const exportJson = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data.rows, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${data.name}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    pushToast('ok', 'Export downloaded');
  };

  const logout = () => {
    StudioApi.setSession(null);
    setSession(null);
  };

  // ---------------- LOGIN SCREEN ----------------
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-900/90 p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="rounded-2xl bg-amber-500/15 border border-amber-500/30 p-2.5">
              <Database className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h1 className="text-lg font-black text-white leading-tight">BoostPay DB Studio</h1>
              <p className="text-[11px] text-zinc-500 font-mono">Firebase-style database console</p>
            </div>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setLoggingIn(true);
              setLoginError('');
              try {
                const s = await StudioApi.login(loginEmail.trim(), loginPassword);
                StudioApi.setSession(s);
                setSession(s);
              } catch (err: any) {
                setLoginError(err?.message || 'Login failed');
              }
              setLoggingIn(false);
            }}
            className="space-y-3"
          >
            <input
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="Admin email"
              type="email"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/60"
            />
            <input
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="Password"
              type="password"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/60"
            />
            {loginError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-400">{loginError}</div>
            )}
            <button
              type="submit"
              disabled={loggingIn}
              className="w-full rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-zinc-950 hover:bg-amber-400 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loggingIn && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{loggingIn ? 'Signing in...' : 'Sign in to DB Studio'}</span>
            </button>
          </form>
          <div className="mt-5 flex items-center gap-1.5 text-[10px] text-zinc-600">
            <Lock className="w-3 h-3" />
            <span>Admin accounts only · all actions are audit-logged</span>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- MAIN CONSOLE ----------------
  const filteredRows = (data?.rows || []).filter(
    (r) => !search.trim() || JSON.stringify(r).toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 h-14">
          <div className="rounded-xl bg-amber-500/15 border border-amber-500/30 p-1.5">
            <Database className="w-4.5 h-4.5 text-amber-400" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-black text-white">BoostPay DB Studio</div>
            <div className="text-[10px] text-zinc-500 font-mono flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              live database
            </div>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setReveal((r) => !r)}
            title={reveal ? 'Secrets revealed — click to hide' : 'Reveal secret fields (audited)'}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition cursor-pointer ${
              reveal
                ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {reveal ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{reveal ? 'Secrets visible' : 'Reveal secrets'}</span>
          </button>
          <button
            onClick={exportJson}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-bold text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <div className="hidden md:flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-1.5">
            <span className="text-[11px] text-zinc-300 font-mono">{session.email}</span>
            <span className="rounded-md bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">{session.role}</span>
          </div>
          <button
            onClick={logout}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-bold text-zinc-400 hover:text-rose-400 transition cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {!canMutate && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-[11px] text-amber-300 font-medium">
          SUPPORT role — browsing is read-only. Editing requires a SUPERADMIN account.
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Sidebar: collections */}
        <aside className="w-60 shrink-0 border-r border-zinc-800 bg-zinc-900/40 overflow-y-auto">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Collections</span>
            <div className="flex items-center gap-1">
              {canMutate && selected && (
                <button
                  onClick={async () => {
                    if (!window.confirm(`Delete collection "${selected}" and all of its documents?`)) return;
                    try {
                      await StudioApi.call(`/api/admin/db/tables/${encodeURIComponent(selected)}`, { method: 'DELETE' });
                      pushToast('ok', `Collection "${selected}" deleted`);
                      setSelected(null);
                      setData(null);
                      setDraft(null);
                      await loadTables();
                    } catch (e: any) {
                      pushToast('err', e?.message || 'Delete failed');
                    }
                  }}
                  title="Delete collection"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 p-1 text-zinc-400 hover:text-rose-400 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              {canMutate && (
                <button
                  onClick={() => setShowAddCollection(true)}
                  title="New collection"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 p-1 text-zinc-400 hover:text-amber-400 cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="px-2 pb-4 space-y-0.5">
            {loadingList && tables.length === 0 && (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-zinc-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> loading...
              </div>
            )}
            {tables.map((t) => (
              <button
                key={t.name}
                onClick={() => { setSelected(t.name); setSearch(''); }}
                className={`w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold transition cursor-pointer ${
                  selected === t.name
                    ? 'bg-amber-500 text-zinc-950'
                    : 'text-zinc-300 hover:bg-zinc-800/70 hover:text-white'
                }`}
              >
                <Table2 className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 truncate">{t.name}</span>
                <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-mono ${selected === t.name ? 'bg-zinc-950/25 text-zinc-950' : 'bg-zinc-800 text-zinc-400'}`}>
                  {t.count}
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* Main: documents list */}
        <main className="flex-1 min-w-0 flex flex-col">
          {selected ? (
            <>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
                <h2 className="text-sm font-bold text-white">{selected}</h2>
                <span className="text-[10px] font-mono text-zinc-500">
                  {data ? `${data.count} docs` : ''}{objectMode ? ' · single object' : ''}
                </span>
                <div className="flex-1" />
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter documents..."
                    className="w-48 sm:w-64 rounded-xl border border-zinc-800 bg-zinc-950 pl-8 pr-3 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/60"
                  />
                </div>
                <button
                  onClick={() => loadRows(selected)}
                  className="rounded-xl border border-zinc-800 bg-zinc-950 p-2 text-zinc-400 hover:text-white cursor-pointer"
                  title="Refresh"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingRows ? 'animate-spin' : ''}`} />
                </button>
                {canMutate && !objectMode && (
                  <button
                    onClick={openNewDoc}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-400 transition cursor-pointer"
                  >
                    <FilePlus2 className="w-3.5 h-3.5" />
                    <span>Add document</span>
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
                {loadingRows ? (
                  <div className="flex items-center gap-2 text-xs text-zinc-500 py-8 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading documents...
                  </div>
                ) : filteredRows.length === 0 ? (
                  <div className="text-center text-xs text-zinc-600 py-10">
                    {objectMode ? 'Object has no data yet.' : 'No documents match.'}
                    {canMutate && !objectMode && !search && (
                      <button onClick={openNewDoc} className="block mx-auto mt-3 text-amber-400 hover:text-amber-300 cursor-pointer">
                        + Create the first document
                      </button>
                    )}
                  </div>
                ) : (
                  filteredRows.map((row, i) => {
                    const active = draft && original && !isNewDoc && JSON.stringify(row) === JSON.stringify(original);
                    return (
                      <button
                        key={String(row.id ?? i)}
                        onClick={() => (objectMode ? openRow(row) : openRow(row))}
                        className={`w-full text-left rounded-xl border px-3.5 py-2.5 transition cursor-pointer ${
                          active
                            ? 'border-amber-500/60 bg-amber-500/10'
                            : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 hover:bg-zinc-800/60'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono font-bold text-amber-300 truncate">
                            {String(row.id ?? row.name ?? `#${i + 1}`)}
                          </span>
                          <span className="text-[10px] text-zinc-500 truncate flex-1">
                            {fmtPreview(
                              row.email ?? row.type ?? row.action ?? row.title ?? row.text ??
                              Object.entries(row).find(([k]) => k !== 'id')?.[1]
                            )}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-zinc-600">
              Select a collection to browse its documents.
            </div>
          )}
        </main>

        {/* Right: document editor */}
        {draft && (
          <aside className="w-[380px] shrink-0 border-l border-zinc-800 bg-zinc-900/40 overflow-y-auto">
            <div className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500">
                    {isNewDoc ? 'New document' : objectMode ? 'Object editor' : 'Document'}
                  </div>
                  <div className="text-sm font-bold text-white truncate">{String(draft.id ?? '—')}</div>
                </div>
                {canMutate && !objectMode && !isNewDoc && (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2 text-rose-400 hover:bg-rose-500/20 cursor-pointer"
                    title="Delete document"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => { setDraft(null); setOriginal(null); setIsNewDoc(false); }}
                  className="rounded-xl border border-zinc-800 bg-zinc-950 p-2 text-zinc-400 hover:text-white cursor-pointer"
                  title="Close"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {confirmDelete && (
                <div className="mt-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs">
                  <div className="text-rose-300 font-bold mb-2">Delete this document permanently?</div>
                  <div className="flex gap-2">
                    <button
                      onClick={deleteDoc}
                      disabled={saving}
                      className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-400 cursor-pointer disabled:opacity-50"
                    >
                      {saving ? 'Deleting...' : 'Yes, delete'}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 space-y-2.5">
              {Object.keys(draft).filter((k) => !removed.has(k)).map((key) => {
                const value = draft[key];
                const t = typeOf(value);
                const secret = false; // Owner decision: always show every value
                return (
                  <div key={key} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-2.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <input
                        value={key}
                        readOnly={!isNewDoc && original !== null && key in (original || {})}
                        onChange={(e) => {
                          if (!isNewDoc && original && key in original) return;
                          const nk = e.target.value;
                          setDraft((d) => {
                            if (!d) return d;
                            const next: Record<string, any> = {};
                            for (const [k, v] of Object.entries(d)) next[k === key ? nk : k] = v;
                            return next;
                          });
                        }}
                        className={`flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] font-mono text-amber-300 focus:outline-none focus:border-amber-500/50 ${
                          !isNewDoc && original !== null && key in (original || {}) ? 'opacity-80 cursor-default' : ''
                        }`}
                      />
                      <select
                        value={t}
                        onChange={(e) => changeType(key, e.target.value as FieldType)}
                        disabled={!canMutate}
                        className="rounded-lg border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-[10px] text-zinc-300 focus:outline-none cursor-pointer"
                      >
                        <option value="string">String</option>
                        <option value="number">Number</option>
                        <option value="boolean">Boolean</option>
                        <option value="object">Object</option>
                        <option value="null">Null</option>
                      </select>
                      {canMutate && (
                        <button
                          onClick={() => removeField(key)}
                          className="rounded-lg border border-zinc-800 bg-zinc-900 p-1 text-zinc-500 hover:text-rose-400 cursor-pointer"
                          title="Remove field"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {t === 'boolean' ? (
                      <button
                        onClick={() => canMutate && setField(key, !value)}
                        className={`w-full rounded-lg border px-2 py-1.5 text-[11px] font-bold cursor-pointer transition ${
                          value
                            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                            : 'border-zinc-800 bg-zinc-900 text-zinc-500'
                        }`}
                      >
                        {String(!!value)}
                      </button>
                    ) : t === 'object' ? (
                      <textarea
                        defaultValue={typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '')}
                        readOnly={!canMutate}
                        onChange={(e) => {
                          try {
                            const parsed = JSON.parse(e.target.value || '{}');
                            setField(key, parsed);
                            e.target.classList.remove('border-rose-500/60');
                          } catch {
                            e.target.classList.add('border-rose-500/60');
                          }
                        }}
                        rows={4}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[10px] font-mono text-emerald-200/90 focus:outline-none focus:border-amber-500/50 resize-y"
                      />
                    ) : t === 'null' ? (
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] font-mono text-zinc-600">null</div>
                    ) : (
                      <input
                        type={t === 'number' ? 'number' : 'text'}
                        defaultValue={value === null || value === undefined ? '' : String(value)}
                        placeholder={secret ? '••••••  (type to change)' : ''}
                        readOnly={!canMutate}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setField(key, t === 'number' ? (raw === '' ? 0 : Number(raw)) : raw);
                        }}
                        className={`w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[11px] font-mono focus:outline-none focus:border-amber-500/50 ${
                          secret && !reveal ? 'text-zinc-500' : 'text-zinc-200'
                        }`}
                      />
                    )}
                    {secret && (
                      <div className="mt-1 flex items-center gap-1 text-[9px] text-zinc-600">
                        <Lock className="w-2.5 h-2.5" />
                        <span>secret field — value hidden{reveal ? '' : '; type to replace'}</span>
                      </div>
                    )}
                  </div>
                );
              })}

              {canMutate && (
                <button
                  onClick={addField}
                  className="w-full rounded-xl border border-dashed border-zinc-700 bg-zinc-950/50 py-2.5 text-xs font-bold text-zinc-400 hover:text-amber-400 hover:border-amber-500/40 transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> Add field
                </button>
              )}

              {canMutate && (
                <button
                  onClick={saveDoc}
                  disabled={saving}
                  className="w-full rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-zinc-950 hover:bg-amber-400 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{saving ? 'Saving...' : isNewDoc ? 'Create document' : 'Save changes'}</span>
                </button>
              )}
              {!canMutate && (
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-600 justify-center">
                  <Lock className="w-3 h-3" /> read-only (SUPPORT role)
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Add collection modal */}
      {showAddCollection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowAddCollection(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
              <FolderPlus className="w-4 h-4 text-amber-400" /> New collection
            </h3>
            <input
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              placeholder="collectionName (letters, digits, _)"
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/60 mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={createCollection}
                className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-zinc-950 hover:bg-amber-400 cursor-pointer"
              >
                Create
              </button>
              <button
                onClick={() => setShowAddCollection(false)}
                className="rounded-xl border border-zinc-800 px-4 py-2.5 text-sm font-bold text-zinc-300 hover:bg-zinc-800 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed top-4 right-4 z-[80] space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-bold shadow-2xl ${
              t.kind === 'ok'
                ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                : 'border-rose-500/30 bg-rose-500/15 text-rose-300'
            }`}
          >
            {t.kind === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
