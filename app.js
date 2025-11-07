import { addItem, getItems, deleteItem, getBackendStatus } from './db.js';

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
const scanBtn = document.getElementById('scanPatrimonio');
const scannerOverlay = document.getElementById('scannerOverlay');
const scannerVideo = document.getElementById('scannerVideo');
const fecharScanner = document.getElementById('fecharScanner');
const numeroPatrimonioInput = document.getElementById('numeroPatrimonio');
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmText = document.getElementById('confirmText');
const confirmDeleteBtn = document.getElementById('confirmDelete');
const cancelDeleteBtn = document.getElementById('cancelDelete');

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

fotoObjetoInput.addEventListener('change', () => {
  renderPreview(fotoObjetoInput, previewFotoObjeto);
  updateClearButtons();
});
fotoLocalizacaoInput.addEventListener('change', () => {
  renderPreview(fotoLocalizacaoInput, previewFotoLocalizacao);
  updateClearButtons();
});

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
  return /^(https?:|blob:|data:)/i.test(s) ? s : '';
}

function cardTemplate(item) {
  const nome = escapeHtml(item.nomeObjeto);
  const patrimonio = escapeHtml(item.numeroPatrimonio);
  const localTxt = escapeHtml(item.localizacaoTexto || '');
  const objUrl = safeImgUrl(item.fotoObjeto);
  const locUrl = safeImgUrl(item.fotoLocalizacao);
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
      </div>
      <div class="row-actions">
        <button class="btn icon" data-action="remover" aria-label="Remover item" title="Remover">🗑️</button>
      </div>
    </div>
  `;
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
  lista.innerHTML = filtrados.map(cardTemplate).join('');
}

let pendingDeleteId = null;

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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const numeroPatrimonio = document.getElementById('numeroPatrimonio').value.trim();
  const nomeObjeto = document.getElementById('nomeObjeto').value;
  const localizacaoTexto = localizacaoTextoInput?.value?.trim() || '';
  const fotoObjetoFile = fotoObjetoInput.files[0];
  const fotoLocalizacaoFile = fotoLocalizacaoInput.files[0];

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

  await addItem(item, { fotoObjetoFile, fotoLocalizacaoFile });
  form.reset();
  previewFotoObjeto.innerHTML = '';
  previewFotoLocalizacao.innerHTML = '';
  updateClearButtons();
  await carregarLista(busca.value);
});

// Garantir que o reset manual também limpe prévias e desabilite os botões
form.addEventListener('reset', () => {
  previewFotoObjeto.innerHTML = '';
  previewFotoLocalizacao.innerHTML = '';
  updateClearButtons();
});

busca.addEventListener('input', (e) => carregarLista(e.target.value));

// Inicialização
carregarLista();

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