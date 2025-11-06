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

// ---------- Supabase (remoto) ----------
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let supabaseClientPromise = null;
async function getSupabaseClient() {
  if (!SUPABASE_ENABLED) {
    throw new Error('Supabase não configurado: verifique SUPABASE_URL e SUPABASE_ANON_KEY em config.js');
  }
  if (!supabaseClientPromise) {
    supabaseClientPromise = (async () => {
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      // Singleton: uma única instância por contexto
      return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    })();
  }
  return supabaseClientPromise;
}

function sanitizeDigits(text) {
  return String(text || '').replace(/\D+/g, '');
}

async function uploadImage(client, file) {
  if (!file) return null;
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase();
  const path = `itens/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await client.storage.from(SUPABASE_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'image/jpeg',
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
  };
  const { data, error } = await client.from(SUPABASE_TABLE).insert(payload).select('*').single();
  if (error) throw error;
  return mapRowToItem(data);
}

async function getItemsRemote() {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from(SUPABASE_TABLE)
    .select('id, numero_patrimonio, nome_objeto, localizacao_texto, foto_objeto_url, foto_localizacao_url, foto_objeto_path, foto_localizacao_path, criado_em')
    .order('id', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapRowToItem);
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