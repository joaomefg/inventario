// Camada de dados: Supabase (remoto) com fallback para IndexedDB (local)

import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_BUCKET, SUPABASE_TABLE } from './config.js';

// ---------- IndexedDB (fallback local) ----------
const DB_NAME = 'inventarioDb';
const DB_VERSION = 1;
const STORE = 'itens';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

async function addItemLocal(item) {
  return withStore('readwrite', (store) => store.add(item));
}

async function getItemsLocal() {
  return withStore('readonly', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

async function deleteItemLocal(id) {
  return withStore('readwrite', (store) => store.delete(id));
}

// Limpa todos os itens do IndexedDB (somente cliente)
async function clearLocalItems() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Silencioso: melhor esforço
  }
}

// ---------- Supabase (remoto) ----------
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const SESSION_STORAGE_KEY = 'inventarioSessionId';
let _createClientFn = null;
let supabaseClient = null;
let currentSessionId = null; // id lógico por sessão de login

function loadSessionId() {
  try {
    const v = localStorage.getItem(SESSION_STORAGE_KEY);
    return v || null;
  } catch { return null; }
}

function saveSessionId(id) {
  try { localStorage.setItem(SESSION_STORAGE_KEY, String(id || '')); } catch {}
}

function clearSessionId() {
  try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch {}
}
async function getSupabaseClient() {
  if (!SUPABASE_ENABLED) {
    throw new Error('Supabase não configurado: verifique SUPABASE_URL e SUPABASE_ANON_KEY em config.js');
  }
  if (!_createClientFn) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    _createClientFn = createClient;
  }
  // Recria cliente se cabeçalho de sessão mudou
  const needsNew = !supabaseClient || supabaseClient.__sessionId !== (currentSessionId || '');
  if (needsNew) {
    supabaseClient = _createClientFn(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { 'x-session-id': String(currentSessionId || '') } },
    });
    supabaseClient.__sessionId = String(currentSessionId || '');
  }
  return supabaseClient;
}

function sanitizeDigits(text) {
  return String(text || '').replace(/\D+/g, '');
}

async function uploadImage(client, file) {
  if (!file) return null;
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED_EXT = ['jpg','jpeg','png','webp'];
  const ALLOWED_TYPES = ['image/jpeg','image/png','image/webp'];
  if (file.size > MAX_SIZE) {
    throw new Error('Arquivo excede 10MB');
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Tipo de arquivo não permitido');
  }
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    throw new Error('Extensão de arquivo não permitida');
  }
  const path = `itens/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await client.storage.from(SUPABASE_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  });
  if (error) throw error;
  const { data } = client.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl || null, path };
}

function mapRowToItem(row) {
  return {
    id: row.id,
    numeroPatrimonio: sanitizeDigits(row.numero_patrimonio),
    nomeObjeto: row.nome_objeto,
    localizacaoTexto: row.localizacao_texto || null,
    fotoObjeto: row.foto_objeto_url || null,
    fotoLocalizacao: row.foto_localizacao_url || null,
    fotoObjetoPath: row.foto_objeto_path || null,
    fotoLocalizacaoPath: row.foto_localizacao_path || null,
    criadoEm: row.criado_em ? new Date(row.criado_em).getTime() : Date.now(),
  };
}

async function addItemRemote(item, files) {
  const client = await getSupabaseClient();
  // Garantir vínculo do item ao usuário autenticado para passar nas policies
  const { data: auth } = await client.auth.getUser();
  const ownerId = auth?.user?.id || null;
  if (!ownerId) {
    throw new Error('Usuário não autenticado — faça login para salvar no Supabase');
  }
  const sessionId = currentSessionId || '';
  const objUpload = await uploadImage(client, files?.fotoObjetoFile);
  const locUpload = await uploadImage(client, files?.fotoLocalizacaoFile);
  const payload = {
    numero_patrimonio: sanitizeDigits(item.numeroPatrimonio),
    nome_objeto: item.nomeObjeto,
    localizacao_texto: item.localizacaoTexto || null,
    foto_objeto_url: objUpload?.url || null,
    foto_localizacao_url: locUpload?.url || null,
    foto_objeto_path: objUpload?.path || null,
    foto_localizacao_path: locUpload?.path || null,
    criado_em: new Date().toISOString(),
    owner_id: ownerId,
    session_id: sessionId,
  };
  // Não encadear .select() para evitar falha de RLS na leitura pós-inserção
  const { error } = await client.from(SUPABASE_TABLE).insert(payload);
  if (error) throw error;
  // UI recarrega a lista depois do addItem; retorno detalhado não é necessário
  return true;
}

async function getItemsRemote() {
  const client = await getSupabaseClient();
  // Garantir session_id carregado para usuários autenticados
  try {
    const { data: auth } = await client.auth.getUser();
    const user = auth?.user || null;
    if (user && !currentSessionId) {
      currentSessionId = loadSessionId();
      if (!currentSessionId) {
        try {
          currentSessionId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        } catch {
          currentSessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }
        saveSessionId(currentSessionId);
      }
      await getSupabaseClient();
    }

    // Admin vê tudo; não-admin filtra por owner e sessão
    let query = client.from(SUPABASE_TABLE).select('*').order('id', { ascending: false });
    if (user) {
      // Verifica admin de modo leve (falha silenciosa trata como não-admin)
      let isAdminUser = false;
      try {
        const { data: adminRows } = await client
          .from('admins')
          .select('email')
          .ilike('email', user.email)
          .limit(1);
        isAdminUser = Array.isArray(adminRows) && adminRows.length > 0;
      } catch {}
      if (!isAdminUser) {
        query = client
          .from(SUPABASE_TABLE)
          .select('*')
          .eq('owner_id', user.id)
          .eq('session_id', String(currentSessionId || ''))
          .order('id', { ascending: false });
      }
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapRowToItem);
  } catch (e) {
    // Mantém comportamento anterior
    const { data, error } = await client
      .from(SUPABASE_TABLE)
      .select('*')
      .order('id', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapRowToItem);
  }
}

async function deleteItemRemote(id) {
  const client = await getSupabaseClient();
  // Buscar paths para remover arquivos do Storage
  const { data: row, error: getErr } = await client
    .from(SUPABASE_TABLE)
    .select('foto_objeto_path, foto_localizacao_path, foto_objeto_url, foto_localizacao_url')
    .eq('id', id)
    .single();
  if (getErr && getErr.code !== 'PGRST116') throw getErr; // ignora no caso de não encontrado

  const paths = [];
  if (row?.foto_objeto_path) paths.push(row.foto_objeto_path);
  if (row?.foto_localizacao_path) paths.push(row.foto_localizacao_path);

  // Se não houver path salvo, tentar derivar do URL público
  function derivePath(url) {
    try {
      if (!url) return null;
      const u = new URL(url);
      // URL típica: /storage/v1/object/public/<bucket>/<path>
      const parts = u.pathname.split('/');
      const idx = parts.indexOf('public');
      if (idx >= 0 && parts[idx + 1] === SUPABASE_BUCKET) {
        return decodeURIComponent(parts.slice(idx + 2).join('/'));
      }
      // Variante signed: /storage/v1/object/sign/<bucket>/<path>
      const sIdx = parts.indexOf('sign');
      if (sIdx >= 0 && parts[sIdx + 1] === SUPABASE_BUCKET) {
        return decodeURIComponent(parts.slice(sIdx + 2).join('/'));
      }
      return null;
    } catch { return null; }
  }
  if (!row?.foto_objeto_path) {
    const p = derivePath(row?.foto_objeto_url);
    if (p) paths.push(p);
  }
  if (!row?.foto_localizacao_path) {
    const p = derivePath(row?.foto_localizacao_url);
    if (p) paths.push(p);
  }

  if (paths.length) {
    await client.storage.from(SUPABASE_BUCKET).remove(paths);
  }

  const { error } = await client.from(SUPABASE_TABLE).delete().eq('id', id);
  if (error) throw error;
}

// ---------- API pública usada pela UI ----------
export async function addItem(item, files) {
  if (SUPABASE_ENABLED) {
    try {
      return await addItemRemote(item, files);
    } catch (e) {
      console.error('Falha ao salvar no Supabase, usando local:', e);
      return addItemLocal(item);
    }
  }
  return addItemLocal(item);
}

export async function getItems() {
  if (SUPABASE_ENABLED) {
    try {
      return await getItemsRemote();
    } catch (e) {
      console.error('Falha ao listar do Supabase, usando local:', e);
      // Evita mostrar itens locais quando não autenticado
      try {
        const client = await getSupabaseClient();
        const { data } = await client.auth.getUser();
        const user = data?.user || null;
        if (!user) return [];
      } catch {}
      return getItemsLocal();
    }
  }
  return getItemsLocal();
}

export async function deleteItem(id) {
  if (SUPABASE_ENABLED) {
    try {
      await deleteItemRemote(id);
      return true;
    } catch (e) {
      console.error('Falha ao remover no Supabase, tentando local:', e);
      return deleteItemLocal(id);
    }
  }
  return deleteItemLocal(id);
}

// ---------- Diagnóstico de backend ----------
// Retorna estado do Supabase e, se habilitado, testa conectividade/tabela.
export async function getBackendStatus() {
  const status = { supabaseEnabled: SUPABASE_ENABLED, supabaseReachable: false, error: null };
  if (!SUPABASE_ENABLED) return status;
  try {
    const client = await getSupabaseClient();
    const { error } = await client
      .from(SUPABASE_TABLE)
      .select('id')
      .limit(1);
    if (error) {
      status.error = `${error.code || 'ERR'}: ${error.message || 'Falha ao consultar tabela'}`;
    } else {
      status.supabaseReachable = true;
    }
  } catch (e) {
    status.error = e?.message || String(e);
  }
  return status;
}

// ---------- Autenticação (Admin) ----------
export async function signIn(email, password) {
  const client = await getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  // Gera um session_id lógico e recria o cliente com cabeçalho
  try {
    currentSessionId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  } catch {
    currentSessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  saveSessionId(currentSessionId);
  // Recria cliente com o novo header
  await getSupabaseClient();
  return data?.user || null;
}

export async function signOut() {
  const client = await getSupabaseClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
  // Limpa header de sessão e recria cliente
  currentSessionId = null;
  clearSessionId();
  await getSupabaseClient();
  // Limpa itens locais ao sair para que não persistam entre sessões
  await clearLocalItems();
  return true;
}

export async function getAuthUser() {
  const client = await getSupabaseClient();
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  const user = data?.user || null;
  // Se existe usuário autenticado mas não temos session_id, restabelece da storage ou cria
  if (user && !currentSessionId) {
    currentSessionId = loadSessionId();
    if (!currentSessionId) {
      try {
        currentSessionId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      } catch {
        currentSessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      saveSessionId(currentSessionId);
    }
    // Reaplica o cabeçalho no cliente atual
    await getSupabaseClient();
  }
  return user;
}

// Verifica se o usuário autenticado é admin (pela tabela public.admins)
export async function isAdmin() {
  const client = await getSupabaseClient();
  const { data: auth } = await client.auth.getUser();
  const email = auth?.user?.email || null;
  if (!email) return false;
  try {
    const { data, error } = await client
      .from('admins')
      .select('email')
      .ilike('email', email)
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}