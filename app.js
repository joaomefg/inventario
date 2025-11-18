import { addItem, getItems, deleteItem, getBackendStatus, signIn, signOut, getAuthUser, isAdmin, updateItem } from './db.js';

const form = document.getElementById('item-form');
const lista = document.getElementById('itens-lista');
const busca = document.getElementById('busca');

const fotoObjetoInput = document.getElementById('fotoObjeto');
const fotoLocalizacaoInput = document.getElementById('fotoLocalizacao');
const localizacaoTextoInput = document.getElementById('localizacaoTexto');
const previewFotoObjeto = document.getElementById('previewFotoObjeto');
const previewFotoLocalizacao = document.getElementById('previewFotoLocalizacao');
const clearFotoObjetoBtn = document.getElementById('clearFotoObjeto');
const clearFotoLocalizacaoBtn = document.getElementById('clearFotoLocalizacao');
const cameraFotoObjetoBtn = document.getElementById('cameraFotoObjeto');
const galleryFotoObjetoBtn = document.getElementById('galleryFotoObjeto');
const cameraFotoLocalizacaoBtn = document.getElementById('cameraFotoLocalizacao');
const galleryFotoLocalizacaoBtn = document.getElementById('galleryFotoLocalizacao');
const scanBtn = document.getElementById('scanPatrimonio');
const scannerOverlay = document.getElementById('scannerOverlay');
const scannerVideo = document.getElementById('scannerVideo');
const fecharScanner = document.getElementById('fecharScanner');
const numeroPatrimonioInput = document.getElementById('numeroPatrimonio');
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmText = document.getElementById('confirmText');
const confirmDeleteBtn = document.getElementById('confirmDelete');
const cancelDeleteBtn = document.getElementById('cancelDelete');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userStatus = document.getElementById('userStatus');
const adminEmailInput = document.getElementById('adminEmail');
const adminPasswordInput = document.getElementById('adminPassword');
const listSection = document.getElementById('listSection');
const authRequiredOverlay = document.getElementById('authRequiredOverlay');
const goLoginBtn = document.getElementById('goLogin');
const closeAuthRequiredBtn = document.getElementById('closeAuthRequired');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');
const duplicateOverlay = document.getElementById('duplicateOverlay');
const duplicateText = document.getElementById('duplicateText');
const closeDuplicateBtn = document.getElementById('closeDuplicate');

// Estado: se o usuário atual é admin (controla botão Remover)
let userIsAdmin = false;
let currentUserEmail = null;
let currentUserId = null;
let itensCache = [];

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderPreview(inputEl, previewEl) {
  previewEl.innerHTML = '';
  const files = Array.from(inputEl.files || []);
  files.forEach(async (file) => {
    const url = URL.createObjectURL(file);
    const img = document.createElement('img');
    img.src = url;
    previewEl.appendChild(img);
  });
}

function updateClearButtons() {
  clearFotoObjetoBtn.disabled = !(fotoObjetoInput.files && fotoObjetoInput.files.length);
  clearFotoLocalizacaoBtn.disabled = !(fotoLocalizacaoInput.files && fotoLocalizacaoInput.files.length);
}

function abrirEscolhaArquivo(inputEl, modo) {
  // modo: 'camera' | 'arquivo'
  try {
    if (modo === 'camera') {
      inputEl.setAttribute('capture', 'environment');
      inputEl.setAttribute('accept', 'image/*');
    } else {
      inputEl.removeAttribute('capture');
      inputEl.setAttribute('accept', 'image/*');
    }
  } catch {}
  // Dispara a caixa de diálogo do sistema
  try { inputEl.click(); } catch {}
}

fotoObjetoInput.addEventListener('change', () => {
  renderPreview(fotoObjetoInput, previewFotoObjeto);
  updateClearButtons();
});
fotoLocalizacaoInput.addEventListener('change', () => {
  renderPreview(fotoLocalizacaoInput, previewFotoLocalizacao);
  updateClearButtons();
});

// Botões de escolha de origem (formulário de novo item)
cameraFotoObjetoBtn?.addEventListener('click', () => abrirEscolhaArquivo(fotoObjetoInput, 'camera'));
galleryFotoObjetoBtn?.addEventListener('click', () => abrirEscolhaArquivo(fotoObjetoInput, 'arquivo'));
cameraFotoLocalizacaoBtn?.addEventListener('click', () => abrirEscolhaArquivo(fotoLocalizacaoInput, 'camera'));
galleryFotoLocalizacaoBtn?.addEventListener('click', () => abrirEscolhaArquivo(fotoLocalizacaoInput, 'arquivo'));

clearFotoObjetoBtn.addEventListener('click', () => {
  // Evita ação se não há arquivo selecionado
  if (!(fotoObjetoInput.files && fotoObjetoInput.files.length)) return;
  const ok = window.confirm('Tem certeza que deseja remover a foto do objeto?');
  if (!ok) return;
  fotoObjetoInput.value = '';
  previewFotoObjeto.innerHTML = '';
  updateClearButtons();
});

clearFotoLocalizacaoBtn.addEventListener('click', () => {
  // Evita ação se não há arquivo selecionado
  if (!(fotoLocalizacaoInput.files && fotoLocalizacaoInput.files.length)) return;
  const ok = window.confirm('Tem certeza que deseja remover a foto da localização?');
  if (!ok) return;
  fotoLocalizacaoInput.value = '';
  previewFotoLocalizacao.innerHTML = '';
  updateClearButtons();
});

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeImgUrl(url) {
  const s = String(url || '');
  if (!/^(https?:|blob:|data:)/i.test(s)) return '';
  // Evita servir recurso público em cache: adiciona cache-buster para Supabase Storage
  if (/\/storage\/v1\/object\/public\//.test(s)) {
    const sep = s.includes('?') ? '&' : '?';
    return `${s}${sep}v=${Date.now()}`;
  }
  return s;
}

function shortId(id) {
  try {
    const s = String(id || '');
    if (!s) return '';
    return s.length > 8 ? s.slice(0, 8) : s;
  } catch { return ''; }
}

function cardTemplate(item) {
  const nome = escapeHtml(item.nomeObjeto);
  const patrimonio = escapeHtml(item.numeroPatrimonio);
  const localTxt = escapeHtml(item.localizacaoTexto || '');
  const objUrl = safeImgUrl(item.fotoObjeto);
  const locUrl = safeImgUrl(item.fotoLocalizacao);
  const addedByYou = item.ownerId && currentUserId && String(item.ownerId) === String(currentUserId);
  const ownerEmailText = item.ownerEmail ? escapeHtml(item.ownerEmail) : '';
  const ownerIdText = item.ownerId ? escapeHtml(shortId(item.ownerId)) : '';
  const addedByLabel = addedByYou ? 'Você' : (ownerEmailText || ownerIdText || 'Desconhecido');
  const actions = userIsAdmin
    ? `
        <button class="btn icon" data-action="editar" aria-label="Editar item" title="Editar">✏️</button>
        <button class="btn icon" data-action="remover" aria-label="Remover item" title="Remover">🗑️</button>
      `
    : '';
  return `
    <div class="item-card list-row" data-id="${item.id}">
      <div class="thumbs">
        ${objUrl ? `<img src="${objUrl}" alt="Objeto" />` : ''}
        ${locUrl ? `<img src="${locUrl}" alt="Localização" />` : ''}
      </div>
      <div class="content">
        <h3 class="title">${nome}</h3>
        <p class="meta">Patrimônio: ${patrimonio}</p>
        ${localTxt ? `<p class="meta">Localização: ${localTxt}</p>` : ''}
        <p class="meta">Adicionado por: ${addedByLabel}</p>
      </div>
      <div class="row-actions">
        ${actions}
      </div>
    </div>
  `;
}

function attachListImageErrorHandlers() {
  try {
    const imgs = lista?.querySelectorAll('.item-card img') || [];
    imgs.forEach((img) => {
      img.addEventListener('error', () => {
        try {
          img.src = '';
          img.style.display = 'none';
        } catch {}
      }, { once: true });
    });
  } catch {}
}

async function carregarLista(filtro = '') {
  const itens = await getItems();
  const termo = filtro.trim().toLowerCase();
  const filtrados = !termo
    ? itens
    : itens.filter((i) =>
        String(i.numeroPatrimonio).toLowerCase().includes(termo) ||
        String(i.nomeObjeto).toLowerCase().includes(termo) ||
        String(i.localizacaoTexto || '').toLowerCase().includes(termo)
      );
  itensCache = filtrados;
  lista.innerHTML = filtrados.map(cardTemplate).join('');
  attachListImageErrorHandlers();
}

let pendingDeleteId = null;
let pendingEditId = null;

// Elementos do modal de edição
const editOverlay = document.getElementById('editOverlay');
const editNumeroPatrimonio = document.getElementById('editNumeroPatrimonio');
const editNomeObjeto = document.getElementById('editNomeObjeto');
const editLocalizacaoTexto = document.getElementById('editLocalizacaoTexto');
const saveEditBtn = document.getElementById('saveEdit');
const cancelEditBtn = document.getElementById('cancelEdit');
const editFotoObjeto = document.getElementById('editFotoObjeto');
const editPreviewFotoObjeto = document.getElementById('editPreviewFotoObjeto');
const editClearFotoObjeto = document.getElementById('editClearFotoObjeto');
const editFotoLocalizacao = document.getElementById('editFotoLocalizacao');
const editPreviewFotoLocalizacao = document.getElementById('editPreviewFotoLocalizacao');
const editClearFotoLocalizacao = document.getElementById('editClearFotoLocalizacao');
const editCameraFotoObjetoBtn = document.getElementById('editCameraFotoObjeto');
const editGalleryFotoObjetoBtn = document.getElementById('editGalleryFotoObjeto');
const editCameraFotoLocalizacaoBtn = document.getElementById('editCameraFotoLocalizacao');
const editGalleryFotoLocalizacaoBtn = document.getElementById('editGalleryFotoLocalizacao');
let editRemoveFotoObjeto = false;
let editRemoveFotoLocalizacao = false;

lista.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const card = e.target.closest('.item-card');
  const id = Number(card?.dataset?.id);
  const action = btn.dataset.action;
  if (action === 'remover' && id) {
    // Prepara e abre modal de confirmação
    pendingDeleteId = id;
    const title = card.querySelector('.title')?.textContent || 'Item';
    const patrimonioText = card.querySelector('.meta')?.textContent || '';
    confirmText.textContent = `Tem certeza que deseja remover "${title}" (${patrimonioText})?`;
    confirmOverlay.classList.remove('hidden');
    confirmOverlay.setAttribute('aria-hidden', 'false');
  } else if (action === 'editar' && id) {
    // Prepara e abre modal de edição com valores atuais
    pendingEditId = id;
    const itemObj = itensCache.find((i) => Number(i.id) === id) || null;
    const title = itemObj?.nomeObjeto || card.querySelector('.title')?.textContent || '';
    const patrimonioText = itemObj?.numeroPatrimonio || (card.querySelector('.meta')?.textContent || '').replace('Patrimônio: ', '');
    const localTxt = itemObj?.localizacaoTexto || '';
    editNomeObjeto.value = title;
    editNumeroPatrimonio.value = patrimonioText;
    editLocalizacaoTexto.value = localTxt;

    // Reset de estado de fotos e previews
    editRemoveFotoObjeto = false;
    editRemoveFotoLocalizacao = false;
    editPreviewFotoObjeto.innerHTML = itemObj?.fotoObjeto ? `<img src="${safeImgUrl(itemObj.fotoObjeto)}" alt="Objeto" />` : '';
    editPreviewFotoLocalizacao.innerHTML = itemObj?.fotoLocalizacao ? `<img src="${safeImgUrl(itemObj.fotoLocalizacao)}" alt="Localização" />` : '';
    editClearFotoObjeto.disabled = !itemObj?.fotoObjeto;
    editClearFotoLocalizacao.disabled = !itemObj?.fotoLocalizacao;
    if (editFotoObjeto) editFotoObjeto.value = '';
    if (editFotoLocalizacao) editFotoLocalizacao.value = '';
    editOverlay.classList.remove('hidden');
    editOverlay.setAttribute('aria-hidden', 'false');
    // Bloqueia rolagem do fundo enquanto o modal estiver aberto
    try {
      document.body.classList.add('no-scroll');
      document.documentElement.classList.add('no-scroll');
    } catch {}
  }
});

async function fecharConfirmOverlay() {
  confirmOverlay.classList.add('hidden');
  confirmOverlay.setAttribute('aria-hidden', 'true');
}

confirmDeleteBtn?.addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  try {
    await deleteItem(pendingDeleteId);
  } catch (err) {
    console.error('Erro ao remover item:', err);
    alert('Não foi possível remover o item. Tente novamente.');
  }
  pendingDeleteId = null;
  await carregarLista(busca.value);
  fecharConfirmOverlay();
});

cancelDeleteBtn?.addEventListener('click', () => {
  pendingDeleteId = null;
  fecharConfirmOverlay();
});

function fecharEditOverlay() {
  editOverlay?.classList.add('hidden');
  editOverlay?.setAttribute('aria-hidden', 'true');
  // Reabilita a rolagem do fundo ao fechar o modal
  try {
    document.body.classList.remove('no-scroll');
    document.documentElement.classList.remove('no-scroll');
  } catch {}
}

// Handlers de preview e limpeza para edição de fotos
editFotoObjeto?.addEventListener('change', () => {
  editRemoveFotoObjeto = false;
  if (editClearFotoObjeto) editClearFotoObjeto.disabled = false;
  const file = editFotoObjeto.files?.[0] || null;
  if (!file) { editPreviewFotoObjeto.innerHTML = ''; return; }
  const reader = new FileReader();
  reader.onload = () => { editPreviewFotoObjeto.innerHTML = `<img src="${reader.result}" alt="Objeto" />`; };
  reader.readAsDataURL(file);
});
editFotoLocalizacao?.addEventListener('change', () => {
  editRemoveFotoLocalizacao = false;
  if (editClearFotoLocalizacao) editClearFotoLocalizacao.disabled = false;
  const file = editFotoLocalizacao.files?.[0] || null;
  if (!file) { editPreviewFotoLocalizacao.innerHTML = ''; return; }
  const reader = new FileReader();
  reader.onload = () => { editPreviewFotoLocalizacao.innerHTML = `<img src="${reader.result}" alt="Localização" />`; };
  reader.readAsDataURL(file);
});

// Botões de escolha de origem (edição)
editCameraFotoObjetoBtn?.addEventListener('click', () => abrirEscolhaArquivo(editFotoObjeto, 'camera'));
editGalleryFotoObjetoBtn?.addEventListener('click', () => abrirEscolhaArquivo(editFotoObjeto, 'arquivo'));
editCameraFotoLocalizacaoBtn?.addEventListener('click', () => abrirEscolhaArquivo(editFotoLocalizacao, 'camera'));
editGalleryFotoLocalizacaoBtn?.addEventListener('click', () => abrirEscolhaArquivo(editFotoLocalizacao, 'arquivo'));
editClearFotoObjeto?.addEventListener('click', () => {
  const ok = window.confirm('Tem certeza que deseja remover a foto do objeto?');
  if (!ok) return;
  editRemoveFotoObjeto = true;
  if (editFotoObjeto) editFotoObjeto.value = '';
  editPreviewFotoObjeto.innerHTML = '';
});
editClearFotoLocalizacao?.addEventListener('click', () => {
  const ok = window.confirm('Tem certeza que deseja remover a foto da localização?');
  if (!ok) return;
  editRemoveFotoLocalizacao = true;
  if (editFotoLocalizacao) editFotoLocalizacao.value = '';
  editPreviewFotoLocalizacao.innerHTML = '';
});

saveEditBtn?.addEventListener('click', async () => {
  if (!pendingEditId) return;
  const updates = {
    numeroPatrimonio: editNumeroPatrimonio.value.trim(),
    nomeObjeto: editNomeObjeto.value.trim(),
    localizacaoTexto: editLocalizacaoTexto.value.trim(),
    removeFotoObjeto: editRemoveFotoObjeto,
    removeFotoLocalizacao: editRemoveFotoLocalizacao,
  };
  const files = {
    fotoObjetoFile: editFotoObjeto?.files?.[0] || null,
    fotoLocalizacaoFile: editFotoLocalizacao?.files?.[0] || null,
  };
  try {
    loadingText.textContent = 'Salvando edição…';
    loadingOverlay.classList.remove('hidden');
    loadingOverlay.setAttribute('aria-hidden', 'false');
    await updateItem(pendingEditId, updates, files);

    // Atualização otimista do cache e da UI para refletir mudança imediata
    const idx = itensCache.findIndex((i) => Number(i.id) === Number(pendingEditId));
    if (idx >= 0) {
      const changed = { ...itensCache[idx] };
      changed.numeroPatrimonio = updates.numeroPatrimonio || changed.numeroPatrimonio;
      changed.nomeObjeto = updates.nomeObjeto || changed.nomeObjeto;
      changed.localizacaoTexto = updates.localizacaoTexto || changed.localizacaoTexto;
      // Fotos: se removeu, zera; se escolheu arquivo, usa dataURL temporária
      if (updates.removeFotoObjeto) {
        changed.fotoObjeto = null;
      } else if (files.fotoObjetoFile) {
        try {
          changed.fotoObjeto = await readFileAsDataURL(files.fotoObjetoFile);
        } catch {}
      }
      if (updates.removeFotoLocalizacao) {
        changed.fotoLocalizacao = null;
      } else if (files.fotoLocalizacaoFile) {
        try {
          changed.fotoLocalizacao = await readFileAsDataURL(files.fotoLocalizacaoFile);
        } catch {}
      }
      itensCache[idx] = changed;
      lista.innerHTML = itensCache.map(cardTemplate).join('');
      attachListImageErrorHandlers();
    }
  } catch (err) {
    console.error('Erro ao editar item:', err);
    alert('Não foi possível salvar as alterações. Tente novamente.');
    return;
  }
  pendingEditId = null;
  fecharEditOverlay();
  loadingOverlay.classList.add('hidden');
  loadingOverlay.setAttribute('aria-hidden', 'true');
  await carregarLista(busca.value);
});

cancelEditBtn?.addEventListener('click', () => {
  pendingEditId = null;
  fecharEditOverlay();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  // Bloqueia criação se não estiver autenticado e mostra modal
  try {
    const user = await getAuthUser();
    if (!user) {
      if (authRequiredOverlay) {
        authRequiredOverlay.classList.remove('hidden');
        authRequiredOverlay.setAttribute('aria-hidden', 'false');
      } else {
        alert('Você precisa estar autenticado para adicionar itens.');
      }
      return;
    }
  } catch (e) {
    if (authRequiredOverlay) {
      authRequiredOverlay.classList.remove('hidden');
      authRequiredOverlay.setAttribute('aria-hidden', 'false');
    } else {
      alert('Autenticação indisponível. Faça login para continuar.');
    }
    return;
  }
  // Exibe overlay de carregamento
  try {
    if (loadingOverlay) {
      if (loadingText) loadingText.textContent = 'Salvando item…';
      loadingOverlay.classList.remove('hidden');
      loadingOverlay.setAttribute('aria-hidden', 'false');
    }
  } catch {}
  const numeroPatrimonio = document.getElementById('numeroPatrimonio').value.trim();
  const nomeObjeto = document.getElementById('nomeObjeto').value;
  const localizacaoTexto = localizacaoTextoInput?.value?.trim() || '';
  const fotoObjetoFile = fotoObjetoInput.files[0];
  const fotoLocalizacaoFile = fotoLocalizacaoInput.files[0];

  try {
    const normalized = String(numeroPatrimonio).replace(/\D+/g, '');
    const existentes = await getItems();
    const duplicado = (existentes || []).some((i) => String(i?.numeroPatrimonio || '').replace(/\D+/g, '') === normalized);
    if (duplicado) {
      try {
        if (loadingOverlay) {
          loadingOverlay.classList.add('hidden');
          loadingOverlay.setAttribute('aria-hidden', 'true');
        }
      } catch {}
      if (duplicateOverlay) {
        if (duplicateText) duplicateText.textContent = `Já existe um item com o número de patrimônio ${normalized}.`;
        duplicateOverlay.classList.remove('hidden');
        duplicateOverlay.setAttribute('aria-hidden', 'false');
      } else {
        alert(`Já existe um item com o número de patrimônio ${normalized}.`);
      }
      return;
    }
  } catch {}

  const [fotoObjeto, fotoLocalizacao] = await Promise.all([
    readFileAsDataURL(fotoObjetoFile),
    readFileAsDataURL(fotoLocalizacaoFile),
  ]);

  const item = {
    numeroPatrimonio,
    nomeObjeto,
    localizacaoTexto,
    fotoObjeto,
    fotoLocalizacao,
    criadoEm: Date.now(),
  };

  try {
    await addItem(item, { fotoObjetoFile, fotoLocalizacaoFile });
    form.reset();
    previewFotoObjeto.innerHTML = '';
    previewFotoLocalizacao.innerHTML = '';
    updateClearButtons();
    await carregarLista(busca.value);
  } catch (err) {
    console.error('Erro ao adicionar item:', err);
    alert('Não foi possível salvar o item. Tente novamente.');
  } finally {
    // Oculta overlay de carregamento
    try {
      if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
        loadingOverlay.setAttribute('aria-hidden', 'true');
      }
    } catch {}
  }
});

// Garantir que o reset manual também limpe prévias e desabilite os botões
form.addEventListener('reset', () => {
  previewFotoObjeto.innerHTML = '';
  previewFotoLocalizacao.innerHTML = '';
  updateClearButtons();
});

busca.addEventListener('input', (e) => carregarLista(e.target.value));

// Inicialização: não carregar lista antes de confirmar autenticação
// A lista será carregada dentro de updateAuthUI()

// Status de backend (Supabase vs local)
async function updateBackendStatus() {
  const el = document.getElementById('backendStatus');
  if (!el) return;
  try {
    const status = await getBackendStatus();
    if (!status.supabaseEnabled) {
      el.textContent = 'Modo local (IndexedDB) — credenciais ausentes';
      el.className = 'backend-status offline';
    } else if (status.supabaseReachable) {
      el.textContent = 'Conectado ao Supabase';
      el.className = 'backend-status ok';
    } else {
      el.textContent = `Falha no Supabase — usando local (${status.error || 'erro desconhecido'})`;
      el.className = 'backend-status offline';
    }
  } catch (e) {
    const el = document.getElementById('backendStatus');
    if (el) {
      el.textContent = `Diagnóstico indisponível: ${e?.message || e}`;
      el.className = 'backend-status offline';
    }
  }
}

updateBackendStatus();

// ---------- Autenticação (admin) ----------
async function updateAuthUI() {
  if (!userStatus) return;
  try {
    const user = await getAuthUser();
    if (user) {
      userStatus.textContent = `Autenticado: ${user.email}`;
      currentUserEmail = user.email;
      currentUserId = user.id;
      // Atualiza flag de admin e re-renderiza lista para refletir ação de remover
      try { userIsAdmin = await isAdmin(); } catch { userIsAdmin = false; }
      if (loginBtn) loginBtn.style.display = 'none';
      if (logoutBtn) logoutBtn.style.display = 'inline-block';
      if (adminEmailInput) adminEmailInput.style.display = 'none';
      if (adminPasswordInput) adminPasswordInput.style.display = 'none';
      if (listSection) listSection.hidden = false;
      await carregarLista(busca.value);
    } else {
      userStatus.textContent = 'Não autenticado';
      userIsAdmin = false;
      currentUserEmail = null;
      currentUserId = null;
      if (loginBtn) loginBtn.style.display = 'inline-block';
      if (logoutBtn) logoutBtn.style.display = 'none';
      if (adminEmailInput) adminEmailInput.style.display = 'inline-block';
      if (adminPasswordInput) adminPasswordInput.style.display = 'inline-block';
      if (listSection) listSection.hidden = true;
      await carregarLista(busca.value);
    }
  } catch {
    userStatus.textContent = 'Autenticação indisponível';
    userIsAdmin = false;
    if (listSection) listSection.hidden = true;
    await carregarLista(busca.value);
  }
}

loginBtn?.addEventListener('click', async () => {
  const email = adminEmailInput?.value?.trim();
  const password = adminPasswordInput?.value || '';
  if (!email || !password) {
    window.alert('Informe e-mail e senha');
    return;
  }
  try {
    await signIn(email, password);
    await updateAuthUI();
    await updateBackendStatus();
    if (adminPasswordInput) adminPasswordInput.value = '';
  } catch (e) {
    window.alert(`Falha ao autenticar: ${e?.message || e}`);
  }
});

logoutBtn?.addEventListener('click', async () => {
  try {
    await signOut();
    // Limpa e oculta imediatamente a lista para não mostrar itens da sessão anterior
    try {
      if (busca) busca.value = '';
      if (lista) lista.innerHTML = '';
      if (listSection) listSection.hidden = true;
    } catch {}
    await updateAuthUI();
    await updateBackendStatus();
  } catch (e) {
    window.alert(`Falha ao sair: ${e?.message || e}`);
  }
});

updateAuthUI();

// Modal: Autenticação necessária
goLoginBtn?.addEventListener('click', () => {
  if (authRequiredOverlay) {
    authRequiredOverlay.classList.add('hidden');
    authRequiredOverlay.setAttribute('aria-hidden', 'true');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  adminEmailInput?.focus();
});

closeAuthRequiredBtn?.addEventListener('click', () => {
  authRequiredOverlay?.classList.add('hidden');
  authRequiredOverlay?.setAttribute('aria-hidden', 'true');
});
 
closeDuplicateBtn?.addEventListener('click', () => {
  duplicateOverlay?.classList.add('hidden');
  duplicateOverlay?.setAttribute('aria-hidden', 'true');
});

// --- Scanner de código de barras ---
let codeReader = null;
let scanning = false;

async function abrirScanner() {
  if (scanning) return;
  scanning = true;
  scannerOverlay.classList.remove('hidden');
  scannerOverlay.setAttribute('aria-hidden', 'false');
  try {
    const {
      BrowserMultiFormatReader,
      BarcodeFormat,
      DecodeHintType,
    } = await import('https://cdn.jsdelivr.net/npm/@zxing/library@0.20.0/+esm');

    codeReader = new BrowserMultiFormatReader();

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.ITF,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
    ]);

    const devices = await codeReader.listVideoInputDevices();
    let selectedDeviceId = devices?.[0]?.deviceId || undefined;
    const rear = devices.find((d) => /back|traseira|rear|environment/i.test(d.label));
    if (rear) selectedDeviceId = rear.deviceId;

    const result = await codeReader.decodeOnceFromVideoDevice(selectedDeviceId, scannerVideo, hints);
    const text = result?.text || result?.getText?.();
    if (text) {
      numeroPatrimonioInput.value = text.replace(/\D+/g, '');
    }
  } catch (err) {
    console.error('Erro ao escanear:', err);
    alert('Não foi possível acessar a câmera ou ler o código de barras. Verifique permissões e tente novamente.');
  } finally {
    fecharScannerModal();
  }
}

function fecharScannerModal() {
  try {
    if (codeReader) {
      codeReader.reset();
    }
  } catch {}
  scanning = false;
  scannerOverlay.classList.add('hidden');
  scannerOverlay.setAttribute('aria-hidden', 'true');
}

scanBtn?.addEventListener('click', abrirScanner);
fecharScanner?.addEventListener('click', fecharScannerModal);