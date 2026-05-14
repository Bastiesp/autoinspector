'use strict';

const requiredItems = [
  { key: 'oilDipstick', label: 'Varilla de aceite', hint: 'Foto 1: aceite en la varilla. Foto 2: color/estado más cercano.' },
  { key: 'tires', label: 'Neumáticos', hint: 'Foto 1: dibujo/profundidad. Foto 2: costado/fecha/desgaste irregular.' },
  { key: 'engineBay', label: 'Motor / vano motor', hint: 'Foto 1: vista general. Foto 2: zonas con fugas, correas o mangueras.' }
];

const optionalItems = [
  { key: 'coolant', label: 'Refrigerante / depósito', hint: 'Color, nivel, manchas, tapa y depósito.' },
  { key: 'dashboardMileage', label: 'Tablero / kilometraje', hint: 'Kilometraje y luces de advertencia.' },
  { key: 'bodywork', label: 'Carrocería / pintura', hint: 'Paneles, diferencias de color, golpes y uniones.' },
  { key: 'interior', label: 'Interior', hint: 'Desgaste de volante, pedales, asientos y mandos.' },
  { key: 'exhaust', label: 'Escape / humo', hint: 'Salida de escape, humo o residuos visibles.' },
  { key: 'documents', label: 'Documentos / mantenciones', hint: 'Facturas, pauta de mantención o revisión técnica.' }
];

const selectedFiles = new Map();
let appConfig = {};

const $ = (selector) => document.querySelector(selector);

function showToast(message, timeout = 3600) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), timeout);
}

function createPhotoItem(item, required) {
  const wrapper = document.createElement('article');
  wrapper.className = 'photo-item';
  wrapper.innerHTML = `
    <div class="photo-item-head">
      <div>
        <h4>${item.label}</h4>
        <small>${item.hint}</small>
      </div>
      <small>${required ? 'Obligatorio' : 'Opcional'} · 2 fotos</small>
    </div>
    <div class="photo-slots">
      ${[1, 2].map((slot) => `
        <div class="photo-slot" data-field="${item.key}_${slot}">
          <div class="slot-title"><span>Toma ${slot}</span><span class="slot-status">Sin foto</span></div>
          <div class="source-buttons">
            <label>📷 Cámara
              <input type="file" accept="image/*" capture="environment" data-field="${item.key}_${slot}" data-source="camera" ${required ? 'data-required="true"' : ''}>
            </label>
            <label>🖼️ Galería
              <input type="file" accept="image/*" data-field="${item.key}_${slot}" data-source="gallery" ${required ? 'data-required="true"' : ''}>
            </label>
          </div>
          <div class="preview" id="preview_${item.key}_${slot}">Sin imagen seleccionada</div>
        </div>
      `).join('')}
    </div>
  `;
  return wrapper;
}

function renderPhotoSections() {
  const requiredContainer = $('#requiredPhotoItems');
  const optionalContainer = $('#optionalPhotoItems');
  requiredItems.forEach((item) => requiredContainer.appendChild(createPhotoItem(item, true)));
  optionalItems.forEach((item) => optionalContainer.appendChild(createPhotoItem(item, false)));
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function compressImage(file, options = {}) {
  const maxOriginalMb = 12;
  const maxSide = options.maxSide || 1400;
  const initialQuality = options.quality || 0.82;
  const targetBytes = (options.targetMb || 1.5) * 1024 * 1024;

  if (!file.type.startsWith('image/')) {
    throw new Error('Solo se permiten imágenes.');
  }

  if (file.size > maxOriginalMb * 1024 * 1024) {
    throw new Error(`La foto supera ${maxOriginalMb} MB. Elige una imagen más liviana.`);
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.drawImage(bitmap, 0, 0, width, height);

  let quality = initialQuality;
  let blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  while (blob && blob.size > targetBytes && quality > 0.48) {
    quality -= 0.08;
    blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  }

  if (!blob) throw new Error('No se pudo procesar la imagen.');

  const safeName = file.name.replace(/\.[^.]+$/, '') || 'foto';
  return new File([blob], `${safeName}-autoinspector.jpg`, { type: 'image/jpeg' });
}

async function handleFileChange(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;

  const field = input.dataset.field;
  const slot = document.querySelector(`.photo-slot[data-field="${field}"]`);
  const status = slot.querySelector('.slot-status');
  const preview = $(`#preview_${field}`);

  try {
    status.textContent = 'Comprimiendo...';
    preview.textContent = 'Optimizando imagen para subir menos peso...';
    const compressed = await compressImage(file);
    selectedFiles.set(field, compressed);

    const url = URL.createObjectURL(compressed);
    preview.innerHTML = `<img src="${url}" alt="Vista previa ${field}">`;
    preview.classList.add('done');
    status.textContent = `${(compressed.size / 1024 / 1024).toFixed(2)} MB`;
    showToast('Foto agregada y comprimida correctamente.');
  } catch (error) {
    selectedFiles.delete(field);
    input.value = '';
    status.textContent = 'Sin foto';
    preview.textContent = error.message;
    showToast(error.message, 5200);
  }
}

function appendFilesToFormData(formData) {
  for (const [field, file] of selectedFiles.entries()) {
    formData.append(field, file, file.name);
  }
}

function validateRequiredPhotos() {
  const missing = [];
  for (const item of requiredItems) {
    for (const slot of [1, 2]) {
      const field = `${item.key}_${slot}`;
      if (!selectedFiles.has(field)) missing.push(`${item.label} toma ${slot}`);
    }
  }
  return missing;
}

function listToHtml(list, fallback = 'Sin información suficiente.') {
  if (!Array.isArray(list) || !list.length) return `<li>${fallback}</li>`;
  return list.map((item) => `<li>${escapeHtml(String(item))}</li>`).join('');
}

function escapeHtml(str) {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderReport(payload) {
  const { report, photos, contact, inspectionId } = payload;
  $('#resultSection').classList.remove('hidden');
  $('#reportVerdict').textContent = report.verdict || 'Informe generado';
  $('#reportMode').textContent = `${report.mode || 'Análisis'} · ID ${inspectionId}`;
  $('#riskScore').textContent = Math.round(report.riskScore || 0);

  const price = report.prices?.analysis || {};
  $('#priceCategory').textContent = price.category || 'No evaluado';
  $('#priceSummary').textContent = `${price.summary || ''} ${price.warning || ''}`.trim();

  const concernText = report.buyerConcernOpinion || report.buyerConcern || 'No informado';
  $('#concernSummary').textContent = concernText;

  $('#alertsList').innerHTML = listToHtml(report.alerts);
  $('#positivesList').innerHTML = listToHtml(report.positives);
  $('#photoObservations').innerHTML = listToHtml(report.photoObservations, 'La IA no agregó observaciones específicas de fotos.');
  $('#questionsList').innerHTML = listToHtml(report.questions);
  $('#nextStepsList').innerHTML = listToHtml(report.nextSteps);
  $('#disclaimer').textContent = report.disclaimer || 'Este informe no reemplaza una revisión presencial de un mecánico profesional.';

  const gallery = $('#uploadedGallery');
  gallery.innerHTML = '';
  for (const photo of photos || []) {
    if (!photo.cloudinaryUrl) continue;
    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.innerHTML = `
      <img src="${photo.cloudinaryUrl}" alt="${escapeHtml(photo.itemLabel)}">
      <span>${escapeHtml(photo.itemLabel)} · toma ${photo.slot}</span>
    `;
    gallery.appendChild(card);
  }

  if (!gallery.children.length) {
    gallery.innerHTML = '<p>No hay galería persistente porque Cloudinary no está configurado. El informe se generó con las fotos recibidas temporalmente.</p>';
  }

  configureContactButtons(contact, report, inspectionId);
  $('#resultSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildContactText(report, inspectionId) {
  const vehicle = report.vehicle || {};
  return [
    'Hola, quiero agendar una revisión mecánica presencial.',
    `Informe AutoInspector: ${inspectionId || 'sin ID'}`,
    `Vehículo: ${vehicle.brand || ''} ${vehicle.model || ''} ${vehicle.year || ''}`.trim(),
    `Kilometraje: ${vehicle.mileage || 'No informado'}`,
    `Veredicto preliminar: ${report.verdict || 'No informado'}`,
    `Riesgo: ${report.riskScore ?? 'No informado'}/100`
  ].join('\n');
}

function configureContactButtons(contact = {}, report = {}, inspectionId = '') {
  const whatsapp = contact.whatsapp || appConfig.contactWhatsapp || '';
  const email = contact.email || appConfig.contactEmail || '';
  const text = buildContactText(report, inspectionId);

  const whatsappUrl = whatsapp
    ? `https://wa.me/${String(whatsapp).replace(/[^0-9]/g, '')}?text=${encodeURIComponent(text)}`
    : '#';
  const emailUrl = email
    ? `mailto:${email}?subject=${encodeURIComponent('Revisión presencial AutoInspector')}&body=${encodeURIComponent(text)}`
    : '#';

  for (const id of ['whatsappBtn', 'topContactBtn', 'reportContactBtn']) {
    const el = $(`#${id}`);
    if (el) el.href = whatsappUrl;
  }
  const emailBtn = $('#emailBtn');
  if (emailBtn) emailBtn.href = emailUrl;
}

async function handleSubmit(event) {
  event.preventDefault();
  const missing = validateRequiredPhotos();
  if (missing.length) {
    showToast(`Faltan fotos obligatorias: ${missing.join(', ')}`, 6200);
    return;
  }

  const form = event.currentTarget;
  const submitBtn = $('#submitBtn');
  const formData = new FormData(form);
  appendFilesToFormData(formData);

  submitBtn.disabled = true;
  submitBtn.textContent = 'Analizando...';
  showToast('Subiendo fotos comprimidas y generando informe.');

  try {
    const response = await fetch('/api/inspect', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'No fue posible generar el informe.');
    }
    renderReport(data);
    showToast('Informe generado correctamente.');
  } catch (error) {
    showToast(error.message, 7000);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Generar informe';
  }
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    appConfig = await response.json();
    configureContactButtons({
      whatsapp: appConfig.contactWhatsapp,
      email: appConfig.contactEmail
    }, { verdict: 'Quiero información de revisión presencial' }, 'consulta');
  } catch (_error) {
    appConfig = {};
  }
}

function init() {
  renderPhotoSections();
  document.addEventListener('change', (event) => {
    if (event.target.matches('input[type="file"][data-field]')) {
      handleFileChange(event);
    }
  });
  $('#inspectionForm').addEventListener('submit', handleSubmit);
  loadConfig();
}

init();
