const form = document.getElementById('inspectionForm');
const submitBtn = document.getElementById('submitBtn');
const resultSection = document.getElementById('resultado');
const reportBox = document.getElementById('reportBox');
const whatsappLink = document.getElementById('whatsappLink');
const compressionStatus = document.getElementById('compressionStatus');

const MAX_ORIGINAL_MB = 12;
const MAX_COMPRESSED_MB = 1.5;
const MAX_WIDTH_OR_HEIGHT = 1400;
const JPEG_QUALITY = 0.72;

const compressedFiles = new Map();

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function bytesToMb(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

function setCompressionStatus(message, type = 'info') {
  if (!compressionStatus) return;
  compressionStatus.textContent = message;
  compressionStatus.className = `compression-status ${type}`;
}

function list(items) {
  if (!items || !items.length) return '<p>No se registran elementos en esta sección.</p>';
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderPhotoObservations(items) {
  if (!items || !items.length) return '';
  return `
    <div class="report-card">
      <h3>Observaciones de fotos</h3>
      <ul>
        ${items.map((item) => `
          <li>
            <strong>${escapeHtml(item.item)}:</strong>
            ${escapeHtml(item.observation)}
            <em>(${escapeHtml(item.risk)})</em>
          </li>
        `).join('')}
      </ul>
    </div>
  `;
}

function renderUploadedPhotos(photos) {
  if (!photos || !photos.length) return '';

  return `
    <div class="report-card">
      <h3>Fotos procesadas</h3>
      <div class="photo-results">
        ${photos.map((photo) => `
          <div class="photo-result-item">
            ${photo.secure_url ? `<img src="${escapeHtml(photo.secure_url)}" alt="${escapeHtml(photo.label || photo.fieldname)}" />` : ''}
            <div>
              <strong>${escapeHtml(photo.label || photo.fieldname)}</strong>
              <small>${escapeHtml(bytesToMb(photo.bytes || photo.size || 0))} MB ${photo.secure_url ? '· guardada en Cloudinary' : '· no guardada permanentemente'}</small>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderReport(data) {
  const report = data.report;
  const vehicle = data.vehicle;
  const score = Number(report.riskScore || 0);
  const contactWhatsapp = report.contact?.whatsapp || '';

  const whatsappText = encodeURIComponent(
    `Hola, quiero coordinar una revisión profesional para este vehículo: ${vehicle.brand} ${vehicle.model} ${vehicle.year}, ${vehicle.mileage} km.`
  );

  if (contactWhatsapp) {
    whatsappLink.href = `https://wa.me/${contactWhatsapp}?text=${whatsappText}`;
    whatsappLink.style.display = 'inline-flex';
  } else {
    whatsappLink.href = '#';
    whatsappLink.style.display = 'none';
  }

  reportBox.innerHTML = `
    <div class="report-header">
      <h2>${escapeHtml(report.verdict)}</h2>
      <p><strong>Vehículo:</strong> ${escapeHtml(vehicle.brand)} ${escapeHtml(vehicle.model)} ${escapeHtml(vehicle.year)} · ${escapeHtml(vehicle.mileage)} km</p>
      <p><strong>Modo de análisis:</strong> ${report.mode === 'ai' ? 'IA + reglas preventivas' : 'Reglas preventivas'}</p>
      <p><strong>Almacenamiento de fotos:</strong> ${data.storage === 'cloudinary' ? 'Cloudinary' : 'Temporal, no permanente'}</p>
      <p><strong>Puntaje de riesgo:</strong> ${score}/100</p>
      <div class="score">
        <div class="score-bar" style="width:${Math.min(Math.max(score, 0), 100)}%"></div>
      </div>
      ${report.aiWarning ? `<p><strong>Nota:</strong> ${escapeHtml(report.aiWarning)}</p>` : ''}
    </div>

    <div class="report-grid">
      <div class="report-card alert">
        <h3>Alertas</h3>
        ${list(report.alerts)}
      </div>

      <div class="report-card positive">
        <h3>Señales positivas</h3>
        ${list(report.positives)}
      </div>

      <div class="report-card">
        <h3>Preguntas para el vendedor</h3>
        ${list(report.questions)}
      </div>

      <div class="report-card">
        <h3>Próximos pasos</h3>
        ${list(report.nextSteps)}
      </div>

      ${renderPhotoObservations(report.photoObservations)}
      ${renderUploadedPhotos(data.photos)}

      <div class="report-card">
        <h3>Recomendación profesional</h3>
        <p>${escapeHtml(report.professionalRecommendation)}</p>
      </div>
    </div>

    <div class="disclaimer">
      ${escapeHtml(data.disclaimer)}
    </div>
  `;

  resultSection.classList.remove('hidden');
  resultSection.scrollIntoView({ behavior: 'smooth' });
}

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };

    img.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

async function compressImageFile(file, inputName) {
  if (!file) return null;

  if (!file.type.startsWith('image/')) {
    throw new Error('Solo se permiten imágenes.');
  }

  if (file.size > MAX_ORIGINAL_MB * 1024 * 1024) {
    throw new Error(`La foto original "${file.name}" pesa ${bytesToMb(file.size)} MB. El máximo antes de comprimir es ${MAX_ORIGINAL_MB} MB.`);
  }

  const img = await fileToImage(file);
  const scale = Math.min(1, MAX_WIDTH_OR_HEIGHT / Math.max(img.width, img.height));
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);

  let quality = JPEG_QUALITY;
  let blob = await canvasToBlob(canvas, quality);

  while (blob && blob.size > MAX_COMPRESSED_MB * 1024 * 1024 && quality > 0.45) {
    quality -= 0.08;
    blob = await canvasToBlob(canvas, quality);
  }

  if (!blob) {
    throw new Error('No se pudo comprimir la imagen.');
  }

  const newName = `${inputName || 'foto'}-${Date.now()}.jpg`;
  return new File([blob], newName, {
    type: 'image/jpeg',
    lastModified: Date.now()
  });
}

async function processInputFile(input) {
  const file = input.files?.[0];
  const box = input.closest('.photo-box');
  const status = box?.querySelector('.photo-status');

  compressedFiles.delete(input.name);

  if (!file) {
    if (status) status.textContent = '';
    return;
  }

  try {
    if (status) status.textContent = 'Comprimiendo foto...';
    setCompressionStatus('Comprimiendo imagen en el navegador antes de subirla...', 'info');

    const compressed = await compressImageFile(file, input.name);
    compressedFiles.set(input.name, compressed);

    if (status) {
      status.textContent = `Lista: ${bytesToMb(file.size)} MB → ${bytesToMb(compressed.size)} MB`;
    }

    setCompressionStatus('Fotos listas. Se subirán comprimidas para ahorrar espacio en Cloudinary.', 'success');
  } catch (error) {
    input.value = '';
    compressedFiles.delete(input.name);
    if (status) status.textContent = 'Error: ' + error.message;
    setCompressionStatus(error.message, 'error');
    alert(error.message);
  }
}

document.querySelectorAll('input[type="file"][accept^="image"]').forEach((input) => {
  input.addEventListener('change', () => processInputFile(input));
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  submitBtn.disabled = true;
  submitBtn.textContent = 'Generando informe...';
  setCompressionStatus('Preparando fotos comprimidas y enviando inspección...', 'info');

  try {
    const formData = new FormData(form);

    document.querySelectorAll('input[type="file"][accept^="image"]').forEach((input) => {
      formData.delete(input.name);
      const compressed = compressedFiles.get(input.name);
      if (compressed) {
        formData.append(input.name, compressed, compressed.name);
      }
    });

    const response = await fetch('/api/inspect', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      const missing = data.missingRequiredPhotos?.join(', ');
      throw new Error(data.error + (missing ? `: ${missing}` : ''));
    }

    setCompressionStatus('Informe generado correctamente.', 'success');
    renderReport(data);
  } catch (error) {
    setCompressionStatus(error.message || 'No se pudo generar el informe.', 'error');
    alert(error.message || 'No se pudo generar el informe');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Generar informe';
  }
});
