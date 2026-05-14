'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { Readable } = require('stream');
const { v2: cloudinary } = require('cloudinary');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 3);
const MAX_FILES = Number(process.env.MAX_FILES || 24);
const CLOUDINARY_FOLDER = process.env.CLOUDINARY_FOLDER || 'autoinspector/inspections';
const CONTACT_WHATSAPP = process.env.CONTACT_WHATSAPP || '';
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || '';
const MECHANIC_NAME = process.env.MECHANIC_NAME || 'AutoInspector Mecánico';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
function cleanEnvSecret(value) {
  return String(value || '').trim().replace(/^['\"]|['\"]$/g, '');
}
const OPENAI_API_KEY = cleanEnvSecret(
  process.env.OPENAI_API_KEY ||
  process.env.OPENAI_KEY ||
  process.env.OPENAI_APIKEY ||
  process.env.API_KEY ||
  process.env.OPENAI_SECRET_KEY
);
const OPENAI_KEY_SOURCE = process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY'
  : process.env.OPENAI_KEY ? 'OPENAI_KEY'
    : process.env.OPENAI_APIKEY ? 'OPENAI_APIKEY'
      : process.env.API_KEY ? 'API_KEY'
        : process.env.OPENAI_SECRET_KEY ? 'OPENAI_SECRET_KEY'
          : '';
function maskKey(value) {
  if (!value) return '';
  if (value.length <= 12) return `${value.slice(0, 4)}...`;
  return `${value.slice(0, 7)}...${value.slice(-4)}`;
}

const cloudinaryEnabled = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

const aiEnabled = Boolean(OPENAI_API_KEY);
const aiStatus = aiEnabled
  ? `Clave detectada en ${OPENAI_KEY_SOURCE || 'variable compatible'} (${maskKey(OPENAI_API_KEY)}). La prueba real depende de créditos/billing/modelo.`
  : 'No configurada: agrega OPENAI_API_KEY en Render, sin comillas, y redeploya.';
const openai = aiEnabled ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024,
    files: MAX_FILES
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Solo se permiten imágenes'));
    }
    cb(null, true);
  }
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const REQUIRED_ITEMS = [
  { key: 'oilDipstick', label: 'Varilla de aceite' },
  { key: 'tires', label: 'Neumáticos' },
  { key: 'engineBay', label: 'Motor / vano motor' }
];

const OPTIONAL_ITEMS = [
  { key: 'coolant', label: 'Refrigerante / depósito' },
  { key: 'dashboardMileage', label: 'Tablero / kilometraje' },
  { key: 'bodywork', label: 'Carrocería / pintura' },
  { key: 'interior', label: 'Interior' },
  { key: 'exhaust', label: 'Escape / humo' },
  { key: 'documents', label: 'Documentos / mantenciones' }
];

const ALL_ITEMS = [...REQUIRED_ITEMS, ...OPTIONAL_ITEMS];

function moneyToNumber(value) {
  if (value === undefined || value === null) return 0;
  const cleaned = String(value).replace(/[^0-9.,-]/g, '').replace(/\./g, '').replace(',', '.');
  return Number(cleaned) || 0;
}

function formatClp(value) {
  const number = Number(value || 0);
  if (!number) return 'No informado';
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0
  }).format(number);
}

function analyzePrice(purchasePrice, marketPrice) {
  if (!purchasePrice || !marketPrice) {
    return {
      category: 'Datos insuficientes',
      level: 'unknown',
      differencePercent: null,
      differenceAmount: null,
      summary: 'Para comparar precio de compra versus mercado, ingresa ambos valores.',
      warning: 'Sin precio de mercado no es posible saber si la oferta es una oportunidad real o una señal de riesgo.',
      negotiationAdvice: 'Busca al menos 3 a 5 publicaciones comparables del mismo año, versión, kilometraje y estado antes de decidir.'
    };
  }

  const diffAmount = purchasePrice - marketPrice;
  const diff = (diffAmount / marketPrice) * 100;
  const abs = Math.abs(diff);
  let category;
  let level;
  let summary;
  let warning;
  let negotiationAdvice;

  if (diff <= -25) {
    category = 'Muy por debajo del mercado';
    level = 'critical-low';
    summary = `El precio de compra está aproximadamente ${abs.toFixed(1)}% bajo el valor de mercado (${formatClp(Math.abs(diffAmount))} menos).`;
    warning = 'ALERTA: un precio demasiado bajo puede esconder deuda, prenda, choque fuerte, falla de motor/caja, kilometraje adulterado o urgencia no declarada.';
    negotiationAdvice = 'No pagues reserva alta ni transfieras sin informe legal, revisión con escáner y verificación mecánica presencial.';
  } else if (diff <= -10) {
    category = 'Bajo el promedio de mercado';
    level = 'low';
    summary = `El precio está aproximadamente ${abs.toFixed(1)}% bajo el promedio de mercado (${formatClp(Math.abs(diffAmount))} menos).`;
    warning = 'Puede ser buena oportunidad, pero conviene validar mantenciones, documentación, multas, siniestros y estado real antes de cerrar.';
    negotiationAdvice = 'Usa la diferencia a favor, pero confirma que el descuento tenga una explicación razonable.';
  } else if (diff < 10) {
    category = 'Cercano al precio promedio de mercado';
    level = 'market';
    summary = `El precio está dentro de un rango razonable respecto del mercado, con una diferencia de ${diff.toFixed(1)}% (${diffAmount >= 0 ? formatClp(diffAmount) + ' más' : formatClp(Math.abs(diffAmount)) + ' menos'}).`;
    warning = 'El precio no parece extremo; el estado mecánico, neumáticos, mantenciones y documentación pueden justificar negociar.';
    negotiationAdvice = 'Compara equipamiento, kilometraje y mantenciones para decidir si corresponde pagar el valor pedido.';
  } else if (diff < 25) {
    category = 'Sobre el promedio de mercado';
    level = 'high';
    summary = `El precio está aproximadamente ${diff.toFixed(1)}% sobre el promedio de mercado (${formatClp(diffAmount)} más).`;
    warning = 'Exige respaldo concreto: mantenciones demostrables, neumáticos nuevos, bajo kilometraje real, único dueño, garantía o estado excepcional.';
    negotiationAdvice = 'Negocia usando comparables de mercado y descuenta cualquier reparación pendiente.';
  } else {
    category = 'Muy por encima del mercado';
    level = 'critical-high';
    summary = `El precio está aproximadamente ${diff.toFixed(1)}% sobre el promedio de mercado (${formatClp(diffAmount)} más).`;
    warning = 'ALERTA: el precio solo se justificaría con estado excepcional y documentación impecable. Si no hay respaldo, el riesgo económico es alto.';
    negotiationAdvice = 'Compara más unidades, pide justificación documentada y evita pagar sobreprecio por argumentos no verificables.';
  }

  return {
    category,
    level,
    differencePercent: Number(diff.toFixed(1)),
    differenceAmount: Math.round(diffAmount),
    summary,
    warning,
    negotiationAdvice
  };
}

function mileageRisk(km, year) {
  const currentYear = new Date().getFullYear();
  const age = year ? Math.max(1, currentYear - Number(year)) : null;
  const kmNum = Number(km || 0);

  if (!kmNum || !age) return { label: 'No evaluado', notes: ['Falta año o kilometraje para estimar uso anual.'], score: 8 };

  const kmPerYear = Math.round(kmNum / age);
  const notes = [`Uso estimado: ${kmPerYear.toLocaleString('es-CL')} km/año.`];
  let score = 0;
  let label = 'Uso normal';

  if (kmPerYear > 30000) {
    score = 22;
    label = 'Uso alto';
    notes.push('Kilometraje anual alto: revisar desgaste de suspensión, frenos, embrague/caja, motor y mantenciones.');
  } else if (kmPerYear > 20000) {
    score = 14;
    label = 'Uso sobre promedio';
    notes.push('Uso sobre promedio: pedir historial de mantenciones y revisar consumibles.');
  } else if (kmPerYear < 5000 && age >= 4) {
    score = 10;
    label = 'Uso muy bajo';
    notes.push('Kilometraje muy bajo para la edad: confirmar odómetro, revisiones técnicas e historial.');
  } else {
    score = 5;
    notes.push('Kilometraje anual aparentemente razonable para una primera evaluación.');
  }

  return { label, notes, score, kmPerYear };
}

function buildRuleBasedReport(fields, uploadedPhotos) {
  const year = Number(fields.year || 0);
  const km = Number(fields.mileage || 0);
  const purchasePrice = moneyToNumber(fields.purchasePrice);
  const marketPrice = moneyToNumber(fields.marketPrice);
  const priceAnalysis = analyzePrice(purchasePrice, marketPrice);
  const kmAnalysis = mileageRisk(km, year);
  const concern = String(fields.concern || '').trim();

  const photoCount = uploadedPhotos.length;
  const byItem = uploadedPhotos.reduce((acc, photo) => {
    acc[photo.itemKey] = (acc[photo.itemKey] || 0) + 1;
    return acc;
  }, {});

  let riskScore = 20 + kmAnalysis.score;
  const alerts = [];
  const positives = [];

  for (const item of REQUIRED_ITEMS) {
    if ((byItem[item.key] || 0) < 2) {
      riskScore += 10;
      alerts.push(`Faltan dos fotos completas del ítem obligatorio: ${item.label}.`);
    } else {
      positives.push(`Se recibieron dos fotos para revisar ${item.label}.`);
    }
  }

  if (priceAnalysis.differencePercent !== null) {
    if (priceAnalysis.differencePercent <= -25) {
      riskScore += 18;
      alerts.push(`${priceAnalysis.category}: ${priceAnalysis.warning}`);
    } else if (priceAnalysis.differencePercent <= -10) {
      riskScore += 8;
      positives.push(`${priceAnalysis.category}: puede ser oportunidad si documentos y revisión mecánica respaldan el estado.`);
    } else if (priceAnalysis.differencePercent >= 25) {
      riskScore += 12;
      alerts.push(`${priceAnalysis.category}: ${priceAnalysis.warning}`);
    } else if (priceAnalysis.differencePercent >= 10) {
      riskScore += 5;
      alerts.push(`${priceAnalysis.category}: exige argumentos verificables para pagar más que el promedio.`);
    } else {
      positives.push('Precio cercano al promedio de mercado según los datos ingresados.');
    }
  } else {
    riskScore += 8;
    alerts.push('Faltan datos de precio de compra o precio de mercado para evaluar si la oferta conviene.');
  }

  if (concern.length > 10) {
    riskScore += 8;
    alerts.push(`El comprador declaró una preocupación específica: “${concern}”. Debe investigarse antes de comprar.`);
  }

  if (photoCount >= 10) positives.push('La cantidad de fotos permite un informe preliminar más completo.');
  if (fields.maintenance === 'yes') positives.push('El vendedor declara tener historial de mantenciones.');
  if (fields.maintenance === 'no') {
    riskScore += 14;
    alerts.push('No hay historial de mantenciones declarado.');
  }
  if (fields.warningLights === 'yes') {
    riskScore += 20;
    alerts.push('Se declararon luces de advertencia en tablero. No cerrar compra sin escáner y diagnóstico.');
  }
  if (fields.smoke === 'yes') {
    riskScore += 22;
    alerts.push('Se declaró humo visible. Revisar motor, turbo si aplica, consumo de aceite y sistema de escape.');
  }
  if (fields.coolantLoss === 'yes') {
    riskScore += 22;
    alerts.push('Se declaró pérdida o consumo de refrigerante. Riesgo de fuga, radiador, tapa, termostato o empaquetadura.');
  }

  riskScore = Math.max(0, Math.min(100, Math.round(riskScore)));

  let verdict = 'Riesgo moderado';
  if (riskScore >= 70) verdict = 'Alto riesgo: requiere revisión mecánica antes de comprar';
  else if (riskScore >= 45) verdict = 'Riesgo medio: negociar y revisar presencialmente';
  else verdict = 'Riesgo preliminar bajo, sujeto a revisión presencial';

  const questions = [
    '¿Tiene facturas o registros de mantenciones con kilometraje?',
    '¿Por qué motivo se vende el vehículo?',
    '¿Ha tenido choques, reparaciones estructurales o pintura completa?',
    '¿Tiene multas, prenda, deuda TAG o limitaciones al dominio?',
    '¿Cuándo se cambiaron aceite, filtros, refrigerante, frenos y neumáticos?',
    '¿Permite revisión con escáner y mecánico antes de pagar o transferir?',
    '¿El precio bajo/sobre mercado se justifica con documentos o fallas conocidas?'
  ];

  if (concern) {
    questions.unshift(`Sobre tu sospecha: “${concern}”, pide evidencia concreta y prueba el vehículo en frío y en caliente.`);
  }

  const photoObservations = [];
  for (const item of ALL_ITEMS) {
    const count = byItem[item.key] || 0;
    if (count >= 2) {
      photoObservations.push(`✅ ${item.label}: se recibieron ${count} fotos. Este punto queda documentado para revisión preliminar visual.`);
    } else if (REQUIRED_ITEMS.some((required) => required.key === item.key)) {
      photoObservations.push(`❌ ${item.label}: faltan fotos suficientes para evaluar este punto crítico.`);
    } else if (count === 1) {
      photoObservations.push(`⚠️ ${item.label}: se recibió solo 1 foto; conviene agregar otra toma desde distinto ángulo.`);
    }
  }

  const statusFromRisk = riskScore >= 70 ? 'critical' : riskScore >= 45 ? 'warning' : 'ok';
  const priceStatus = ['critical-low', 'critical-high'].includes(priceAnalysis.level)
    ? 'critical'
    : ['low', 'high', 'unknown'].includes(priceAnalysis.level)
      ? 'warning'
      : 'ok';
  const photosStatus = REQUIRED_ITEMS.every((item) => (byItem[item.key] || 0) >= 2) ? 'ok' : 'critical';
  const concernStatus = concern.length > 10 ? 'warning' : 'ok';

  return {
    mode: aiEnabled ? 'Reglas + IA pendiente' : 'Reglas preventivas sin IA',
    generatedAt: new Date().toISOString(),
    vehicle: {
      brand: fields.brand || '',
      model: fields.model || '',
      year: fields.year || '',
      mileage: fields.mileage || '',
      fuel: fields.fuel || '',
      transmission: fields.transmission || ''
    },
    prices: {
      purchasePrice,
      marketPrice,
      purchasePriceFormatted: formatClp(purchasePrice),
      marketPriceFormatted: formatClp(marketPrice),
      analysis: priceAnalysis
    },
    buyerConcern: concern || 'No informado',
    blockStatuses: {
      global: statusFromRisk,
      price: priceStatus,
      concern: concernStatus,
      alerts: alerts.length ? (riskScore >= 70 ? 'critical' : 'warning') : 'ok',
      positives: positives.length ? 'ok' : 'warning',
      photos: photosStatus,
      questions: 'warning',
      nextSteps: statusFromRisk
    },
    photoObservations,
    riskScore,
    verdict,
    alerts,
    positives,
    mileageAnalysis: kmAnalysis,
    questions,
    nextSteps: [
      'No transferir ni pagar reserva alta solo con este informe preliminar.',
      'Solicitar informe legal, multas, revisión técnica y certificado de anotaciones vigentes.',
      'Hacer prueba de manejo en frío y caliente.',
      'Coordinar revisión presencial con mecánico, idealmente con escáner y elevador.',
      'Usar el análisis de precio para negociar o descartar si el riesgo no compensa.'
    ],
    disclaimer: 'Este informe es una orientación preliminar generada con fotos y datos ingresados por el usuario. No reemplaza una revisión presencial realizada por un mecánico profesional.'
  };
}

function bufferToDataUrl(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

function uploadToCloudinary(file, context) {
  return new Promise((resolve, reject) => {
    if (!cloudinaryEnabled) {
      return resolve(null);
    }

    const publicId = `${context.inspectionId}_${context.itemKey}_${context.slot}_${Date.now()}`;
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: CLOUDINARY_FOLDER,
        public_id: publicId,
        resource_type: 'image',
        overwrite: false,
        transformation: [
          { width: 1600, height: 1600, crop: 'limit' },
          { quality: 'auto:good', fetch_format: 'auto' }
        ],
        context: {
          app: 'AutoInspector',
          item: context.itemLabel,
          slot: String(context.slot)
        }
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    Readable.from(file.buffer).pipe(stream);
  });
}

async function callOpenAiVision(content) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content }],
      temperature: 0.15,
      response_format: { type: 'json_object' },
      max_tokens: 1800
    })
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (_error) {
    throw new Error(`OpenAI respondió con texto no JSON. HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    const message = json?.error?.message || JSON.stringify(json).slice(0, 300);
    throw new Error(`OpenAI HTTP ${response.status}: ${message}`);
  }

  const contentText = json?.choices?.[0]?.message?.content;
  if (!contentText) {
    throw new Error('OpenAI no devolvió contenido analizable.');
  }

  return JSON.parse(contentText);
}

async function tryAiReport(fields, uploadedPhotos, ruleReport) {
  if (!OPENAI_API_KEY) {
    return {
      ...ruleReport,
      mode: 'Reglas preventivas, IA no configurada',
      aiError: 'No hay OPENAI_API_KEY en Render. Agrega la variable y redeploya.'
    };
  }

  if (uploadedPhotos.length === 0) return ruleReport;

  const maxPhotosForAi = uploadedPhotos.slice(0, 12);
  const photosByItem = maxPhotosForAi.reduce((acc, photo) => {
    if (!acc[photo.itemLabel]) acc[photo.itemLabel] = 0;
    acc[photo.itemLabel] += 1;
    return acc;
  }, {});

  const content = [
    {
      type: 'text',
      text: `
Eres un perito asistente de preinspección automotriz para compradores de autos usados en Chile.
Tu tarea principal es ANALIZAR VISUALMENTE las fotos recibidas. No hagas solo un resumen de que las fotos existen.
No reemplazas a un mecánico. Debes ser prudente, profesional y orientado a riesgos.

Devuelve SOLO JSON válido con estas claves exactas:
{
  "verdict": "string",
  "riskScore": number,
  "alerts": ["string"],
  "positives": ["string"],
  "photoObservations": ["string"],
  "priceOpinion": "string",
  "buyerConcernOpinion": "string",
  "questions": ["string"],
  "nextSteps": ["string"],
  "disclaimer": "string"
}

Reglas obligatorias para photoObservations:
- Debe contener al menos una observación por cada ítem fotografiado.
- Cada observación debe empezar con ✅ si visualmente parece correcto, ⚠️ si requiere revisión, o ❌ si parece urgente.
- Menciona lo que se ve o no se puede confirmar: color/estado del aceite, desgaste o profundidad visible de neumáticos, fugas aparentes, suciedad excesiva, óxido, modificaciones, mangueras, depósito, tablero, carrocería, interior, etc.
- Si la foto es borrosa, oscura, mal encuadrada o no permite evaluar, dilo con ⚠️ y pide una nueva toma.
- No inventes fallas que no se ven.

Datos del vehículo:
Marca: ${fields.brand || 'No informado'}
Modelo: ${fields.model || 'No informado'}
Año: ${fields.year || 'No informado'}
Kilometraje: ${fields.mileage || 'No informado'}
Combustible: ${fields.fuel || 'No informado'}
Transmisión: ${fields.transmission || 'No informado'}
Precio de compra: ${formatClp(moneyToNumber(fields.purchasePrice))}
Precio de mercado estimado: ${formatClp(moneyToNumber(fields.marketPrice))}
Análisis precio por reglas: ${ruleReport.prices.analysis.category} - ${ruleReport.prices.analysis.summary} - ${ruleReport.prices.analysis.warning}
Preocupación o sospecha del comprador: ${fields.concern || 'No informado'}
Mantenciones declaradas: ${fields.maintenance || 'No informado'}
Luces tablero: ${fields.warningLights || 'No informado'}
Humo: ${fields.smoke || 'No informado'}
Pérdida refrigerante: ${fields.coolantLoss || 'No informado'}
Fotos recibidas por ítem: ${Object.entries(photosByItem).map(([k, v]) => `${k}: ${v}`).join(', ')}

El priceOpinion debe analizar explícitamente si el precio de compra está muy por debajo, bajo promedio, cercano al promedio, sobre promedio o muy por encima del mercado. Si está muy por debajo o muy por encima, debe indicar alerta clara.
      `.trim()
    }
  ];

  for (const photo of maxPhotosForAi) {
    content.push({ type: 'text', text: `Analiza esta imagen: ${photo.itemLabel}, toma ${photo.slot}` });
    content.push({ type: 'image_url', image_url: { url: photo.dataUrl, detail: 'high' } });
  }

  try {
    const parsed = await callOpenAiVision(content);
    const aiPhotoObservations = Array.isArray(parsed.photoObservations)
      ? parsed.photoObservations.filter(Boolean)
      : [];

    return {
      ...ruleReport,
      mode: 'IA visual + reglas preventivas',
      verdict: parsed.verdict || ruleReport.verdict,
      riskScore: Number(parsed.riskScore ?? ruleReport.riskScore),
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts : ruleReport.alerts,
      positives: Array.isArray(parsed.positives) ? parsed.positives : ruleReport.positives,
      photoObservations: aiPhotoObservations.length ? aiPhotoObservations : [
        '⚠️ La IA respondió, pero no entregó observaciones visuales específicas. Reintenta con fotos más claras y cercanas.'
      ],
      aiPriceOpinion: parsed.priceOpinion || '',
      buyerConcernOpinion: parsed.buyerConcernOpinion || '',
      blockStatuses: ruleReport.blockStatuses,
      questions: Array.isArray(parsed.questions) ? parsed.questions : ruleReport.questions,
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : ruleReport.nextSteps,
      disclaimer: parsed.disclaimer || ruleReport.disclaimer
    };
  } catch (error) {
    console.error('AI report error full:', error);
    return {
      ...ruleReport,
      mode: 'Reglas preventivas, IA no disponible temporalmente',
      photoObservations: [
        '⚠️ La IA visual no pudo ejecutarse. Este bloque muestra solo validación preventiva de fotos recibidas.',
        ...ruleReport.photoObservations
      ],
      aiError: 'No fue posible completar el análisis con IA visual. Revisa /api/health, /api/ai-test, OPENAI_API_KEY, créditos de API y OPENAI_MODEL en Render.',
      aiErrorDetail: error.message
    };
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    name: 'AutoInspector',
    version: '1.5.0-real-vision-debug',
    aiEnabled,
    aiStatus,
    openaiModel: OPENAI_MODEL,
    openaiKeySource: OPENAI_KEY_SOURCE || null,
    openaiKeyPreview: maskKey(OPENAI_API_KEY) || null,
    cloudinaryEnabled,
    maxUploadMb: MAX_UPLOAD_MB,
    maxFiles: MAX_FILES,
    contactConfigured: Boolean(CONTACT_WHATSAPP || CONTACT_EMAIL)
  });
});


app.get('/api/ai-test', async (_req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(400).json({
      ok: false,
      aiEnabled: false,
      error: 'No hay OPENAI_API_KEY configurada en Render.'
    });
  }

  try {
    const parsed = await callOpenAiVision([
      { type: 'text', text: 'Responde SOLO JSON válido: {"ok":true,"message":"IA funcionando"}' }
    ]);
    res.json({
      ok: true,
      aiEnabled: true,
      model: OPENAI_MODEL,
      keySource: OPENAI_KEY_SOURCE || null,
      keyPreview: maskKey(OPENAI_API_KEY),
      response: parsed
    });
  } catch (error) {
    console.error('GET /api/ai-test error:', error);
    res.status(500).json({
      ok: false,
      aiEnabled: true,
      model: OPENAI_MODEL,
      keySource: OPENAI_KEY_SOURCE || null,
      keyPreview: maskKey(OPENAI_API_KEY),
      error: error.message
    });
  }
});

app.get('/api/config', (_req, res) => {
  res.json({
    contactWhatsapp: CONTACT_WHATSAPP,
    contactEmail: CONTACT_EMAIL,
    mechanicName: MECHANIC_NAME,
    requiredItems: REQUIRED_ITEMS,
    optionalItems: OPTIONAL_ITEMS,
    maxUploadMb: MAX_UPLOAD_MB
  });
});

app.post('/api/inspect', upload.any(), async (req, res) => {
  try {
    const fields = req.body || {};
    const files = req.files || [];
    const inspectionId = `insp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const uploadedPhotos = [];
    const itemCounters = new Map();

    for (const file of files) {
      const itemKey = String(file.fieldname || '').replace(/_(photos|\d+)$/, '');
      const item = ALL_ITEMS.find((entry) => entry.key === itemKey);
      if (!item) continue;

      const slot = (itemCounters.get(item.key) || 0) + 1;
      itemCounters.set(item.key, slot);

      const cloudinaryResult = await uploadToCloudinary(file, {
        inspectionId,
        itemKey: item.key,
        itemLabel: item.label,
        slot
      });

      uploadedPhotos.push({
        itemKey: item.key,
        itemLabel: item.label,
        slot,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        cloudinaryUrl: cloudinaryResult?.secure_url || null,
        cloudinaryPublicId: cloudinaryResult?.public_id || null,
        dataUrl: bufferToDataUrl(file)
      });
    }

    const byRequired = REQUIRED_ITEMS.map((item) => ({
      item,
      count: uploadedPhotos.filter((photo) => photo.itemKey === item.key).length
    }));

    const missing = byRequired.filter((entry) => entry.count < 2);
    if (missing.length) {
      return res.status(400).json({
        ok: false,
        error: `Faltan fotos obligatorias. Cada ítem crucial requiere 2 fotos: ${missing.map((m) => m.item.label).join(', ')}.`
      });
    }

    const ruleReport = buildRuleBasedReport(fields, uploadedPhotos);
    const report = await tryAiReport(fields, uploadedPhotos, ruleReport);

    const photosForResponse = uploadedPhotos.map(({ dataUrl, ...photo }) => photo);

    res.json({
      ok: true,
      inspectionId,
      report,
      photos: photosForResponse,
      contact: {
        whatsapp: CONTACT_WHATSAPP,
        email: CONTACT_EMAIL,
        mechanicName: MECHANIC_NAME
      }
    });
  } catch (error) {
    console.error('POST /api/inspect error:', error);
    const message = error.message || 'Error generando inspección';
    res.status(500).json({ ok: false, error: message });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`AutoInspector running on port ${PORT}`);
  console.log(`AI enabled: ${aiEnabled}`);
  console.log(`AI status: ${aiStatus}`);
  console.log(`Cloudinary enabled: ${cloudinaryEnabled}`);
});
