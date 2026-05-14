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
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

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

const aiEnabled = Boolean(process.env.OPENAI_API_KEY);
const openai = aiEnabled ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

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
      differencePercent: null,
      summary: 'Para comparar precio de compra versus mercado, ingresa ambos valores.',
      warning: 'Cuando no hay precio de mercado, no se puede saber si una oferta baja es oportunidad o señal de riesgo.'
    };
  }

  const diff = ((purchasePrice - marketPrice) / marketPrice) * 100;
  const abs = Math.abs(diff);
  let category;
  let summary;
  let warning;

  if (diff <= -25) {
    category = 'Muy por debajo del mercado';
    summary = `El precio está aproximadamente ${abs.toFixed(1)}% bajo el valor de mercado.`;
    warning = 'Puede ser una oportunidad, pero también una señal de alerta: revisar deuda, choques, motor, caja, kilometraje real y motivo de venta.';
  } else if (diff <= -10) {
    category = 'Bajo el promedio de mercado';
    summary = `El precio está aproximadamente ${abs.toFixed(1)}% bajo el valor de mercado.`;
    warning = 'Conviene validar mantenciones, documentación, multas, historial de siniestros y revisión mecánica antes de cerrar.';
  } else if (diff < 10) {
    category = 'Dentro del rango de mercado';
    summary = `El precio está cerca del promedio de mercado, con una diferencia de ${diff.toFixed(1)}%.`;
    warning = 'El precio no parece extremo; aun así, el estado real puede justificar subir o bajar la oferta.';
  } else if (diff < 25) {
    category = 'Sobre el promedio de mercado';
    summary = `El precio está aproximadamente ${diff.toFixed(1)}% sobre el valor de mercado.`;
    warning = 'Exige respaldo: mantenciones, neumáticos nuevos, único dueño, kilometraje bajo, accesorios o garantía.';
  } else {
    category = 'Muy por encima del mercado';
    summary = `El precio está aproximadamente ${diff.toFixed(1)}% sobre el valor de mercado.`;
    warning = 'Solo tendría sentido si el vehículo está excepcionalmente bien mantenido y documentado. Negocia o compara más unidades.';
  }

  return {
    category,
    differencePercent: Number(diff.toFixed(1)),
    summary,
    warning
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
    if (priceAnalysis.differencePercent <= -25) riskScore += 18;
    else if (priceAnalysis.differencePercent <= -10) riskScore += 8;
    else if (priceAnalysis.differencePercent >= 25) riskScore += 10;
    else if (priceAnalysis.differencePercent >= 10) riskScore += 5;
  } else {
    riskScore += 8;
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

  return {
    mode: aiEnabled ? 'Reglas + IA no disponible en este momento' : 'Reglas preventivas sin IA',
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

async function tryAiReport(fields, uploadedPhotos, ruleReport) {
  if (!openai || uploadedPhotos.length === 0) return ruleReport;

  const maxPhotosForAi = uploadedPhotos.slice(0, 12);
  const content = [
    {
      type: 'text',
      text: `
Eres un asistente de preinspección automotriz para compradores de autos usados en Chile.
No reemplazas a un mecánico. Debes ser prudente, claro y orientado a riesgos.
Devuelve SOLO JSON válido con estas claves:
verdict, riskScore, alerts, positives, photoObservations, priceOpinion, buyerConcernOpinion, questions, nextSteps, disclaimer.

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

Considera que hay dos fotos por item cuando existan. Si una foto no permite evaluar, dilo.
No inventes fallas que no se ven. Usa lenguaje profesional, breve y útil.
      `.trim()
    }
  ];

  for (const photo of maxPhotosForAi) {
    content.push({ type: 'text', text: `Foto: ${photo.itemLabel}, toma ${photo.slot}` });
    content.push({ type: 'image_url', image_url: { url: photo.dataUrl, detail: 'low' } });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [{ role: 'user', content }],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(completion.choices[0].message.content);
    return {
      ...ruleReport,
      mode: 'IA + reglas preventivas',
      verdict: parsed.verdict || ruleReport.verdict,
      riskScore: Number(parsed.riskScore ?? ruleReport.riskScore),
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts : ruleReport.alerts,
      positives: Array.isArray(parsed.positives) ? parsed.positives : ruleReport.positives,
      photoObservations: Array.isArray(parsed.photoObservations) ? parsed.photoObservations : [],
      aiPriceOpinion: parsed.priceOpinion || '',
      buyerConcernOpinion: parsed.buyerConcernOpinion || '',
      questions: Array.isArray(parsed.questions) ? parsed.questions : ruleReport.questions,
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : ruleReport.nextSteps,
      disclaimer: parsed.disclaimer || ruleReport.disclaimer
    };
  } catch (error) {
    console.error('AI report error:', error.message);
    return {
      ...ruleReport,
      mode: 'Reglas preventivas, IA no disponible temporalmente',
      aiError: 'No fue posible completar el análisis con IA. Se entregó informe preventivo por reglas.'
    };
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    name: 'AutoInspector',
    version: '1.2.0-premium-cloudinary',
    aiEnabled,
    cloudinaryEnabled,
    maxUploadMb: MAX_UPLOAD_MB,
    maxFiles: MAX_FILES,
    contactConfigured: Boolean(CONTACT_WHATSAPP || CONTACT_EMAIL)
  });
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
    const fileMap = new Map();
    for (const file of files) {
      if (!fileMap.has(file.fieldname)) fileMap.set(file.fieldname, []);
      fileMap.get(file.fieldname).push(file);
    }

    for (const item of ALL_ITEMS) {
      for (let slot = 1; slot <= 2; slot++) {
        const fieldName = `${item.key}_${slot}`;
        const file = (fileMap.get(fieldName) || [])[0];
        if (!file) continue;

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
  console.log(`Cloudinary enabled: ${cloudinaryEnabled}`);
});
