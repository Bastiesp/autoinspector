const form = document.getElementById('inspectionForm');
const submitBtn = document.getElementById('submitBtn');
const resultSection = document.getElementById('resultSection');
const resultContent = document.getElementById('resultContent');
const printBtn = document.getElementById('printBtn');

let appConfig = { contactWhatsapp: '', contactEmail: '', aiEnabled: false };

init();

async function init() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    if (data.ok) appConfig = data;
  } catch (err) {
    console.warn('No se pudo cargar configuración:', err.message);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  resultSection.classList.add('hidden');
  resultContent.innerHTML = '';

  const formData = new FormData(form);
  submitBtn.disabled = true;
  submitBtn.textContent = 'Analizando vehículo...';

  try {
    const response = await fetch('/api/inspect', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo generar el informe.');

    renderReport(data);
    resultSection.classList.remove('hidden');
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    resultContent.innerHTML = `<div class="report-card"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
    resultSection.classList.remove('hidden');
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Generar informe AutoInspector';
  }
});

printBtn.addEventListener('click', () => window.print());

function renderReport(data) {
  const { vehicle, analysis, source, disclaimer } = data;
  const aiLabel = source === 'ia' ? 'Análisis con IA visual' : 'Análisis básico por reglas';
  const whatsapp = appConfig.contactWhatsapp ? `https://wa.me/${appConfig.contactWhatsapp}?text=${encodeURIComponent('Hola, quiero agendar una inspección presencial de un vehículo usado.')}` : '';
  const email = appConfig.contactEmail ? `mailto:${appConfig.contactEmail}?subject=${encodeURIComponent('Inspección presencial vehículo usado')}` : '';

  resultContent.innerHTML = `
    <article class="report-card">
      <div class="report-top">
        <div>
          <span class="badge">${escapeHtml(aiLabel)}</span>
          <h3 style="margin-top:14px;">${escapeHtml(vehicle.brand)} ${escapeHtml(vehicle.model)} ${vehicle.year}</h3>
          <p><strong>Kilometraje:</strong> ${formatNumber(vehicle.km)} km ${vehicle.price ? ` · <strong>Precio:</strong> $${formatNumber(vehicle.price)}` : ''}</p>
          <p><strong>Veredicto:</strong> ${escapeHtml(analysis.verdict || 'Sin veredicto disponible.')}</p>
        </div>
        <div class="score">${Number(analysis.riskScore || 0)}/100</div>
      </div>
    </article>

    ${card('Rango de kilometraje esperado', `<p>${escapeHtml(analysis.estimatedKmRange || 'No calculado.')}</p>`)}
    ${card('Hallazgos visuales', list(analysis.visualFindings))}
    ${card('Alertas importantes', list(analysis.redFlags))}
    ${card('Señales positivas', list(analysis.positiveSignals))}
    ${card('Preguntas recomendadas para el vendedor', list(analysis.questionsForSeller))}
    ${card('Próximos pasos recomendados', list(analysis.recommendedNextSteps))}

    <section class="cta-box">
      <h3>Revisión profesional recomendada</h3>
      <p>${escapeHtml(analysis.professionalCallToAction || 'Agenda una revisión presencial antes de comprar.')}</p>
      <p><strong>Advertencia:</strong> ${escapeHtml(disclaimer)}</p>
      <div class="cta-actions">
        ${whatsapp ? `<a class="primary-btn" href="${whatsapp}" target="_blank" rel="noopener">Agendar por WhatsApp</a>` : ''}
        ${email ? `<a class="secondary-btn" href="${email}">Enviar correo</a>` : ''}
      </div>
    </section>
  `;
}

function card(title, body) {
  return `<section class="report-card"><h3>${escapeHtml(title)}</h3>${body}</section>`;
}

function list(items) {
  if (!Array.isArray(items) || items.length === 0) return '<p>No se detectaron elementos suficientes.</p>';
  return `<ul>${items.map(item => `<li>${escapeHtml(String(item))}</li>`).join('')}</ul>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('es-CL');
}
