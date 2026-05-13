'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.' }
});

app.use('/api/', limiter);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 7 * 1024 * 1024,
    files: 8
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Solo se permiten imágenes.'));
    }
    cb(null, true);
  }
});

const REQUIRED_ITEMS = [
  { field: 'oilDipstick', label: 'Varilla de aceite' },
  { field: 'tires', label: 'Neumáticos' },
  { field: 'engineBay', label: 'Motor / vano motor' }
];

const OPTIONAL_ITEMS = [
  { field: 'coolant', label: 'Refrigerante / depósito' },
  { field: 'dashboard', label: 'Tablero / kilometraje' },
  { field: 'bodywork', label: 'Carrocería / pintura' },
  { field: 'interior', label: 'Interior' },
  { field: 'exhaust', label: 'Escape / humo visible' }
];

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'AutoInspector',
    version: '1.0.0',
    aiEnabled: Boolean(OPENAI_API_KEY),
    requiredPhotos: REQUIRED_ITEMS.map(x => x.label)
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    ok: true,
    aiEnabled: Boolean(OPENAI_API_KEY),
    contactWhatsapp: process.env.CONTACT_WHATSAPP || '',
    contactEmail: process.env.CONTACT_EMAIL || ''
  });
});

app.post('/api/inspect', upload.fields([...REQUIRED_ITEMS, ...OPTIONAL_ITEMS].map(item => ({ name: item.field, maxCount: 1 }))), async (req, res) => {
  try {
    const files = req.files || {};
    const missing = REQUIRED_ITEMS.filter(item => !files[item.field]?.[0]).map(item => item.label);

    if (missing.length) {
      return res.status(400).json({
        ok: false,
        error: `Faltan fotos obligatorias: ${missing.join(', ')}.`
      });
    }

    const vehicle = normalizeVehicle(req.body || {});
    if (!vehicle.brand || !vehicle.model || !vehicle.year || !vehicle.km) {
      return res.status(400).json({
        ok: false,
        error: 'Completa marca, modelo, año y kilometraje.'
      });
    }

    const photos = buildPhotoPayload(files);
    const baseAnalysis = ruleBasedAnalysis(vehicle, photos);

    let analysis = baseAnalysis;
    let source = 'reglas';

    if (OPENAI_API_KEY) {
      try {
        analysis = await analyzeWithOpenAI(vehicle, photos, baseAnalysis);
        source = 'ia';
      } catch (aiError) {
        console.error('IA no disponible, usando análisis por reglas:', aiError.message);
        analysis = {
          ...baseAnalysis,
          warning: 'La IA no respondió correctamente. Se entregó un análisis preventivo basado en reglas.'
        };
      }
    }

    res.json({
      ok: true,
      source,
      vehicle,
      analysis,
      disclaimer: 'Este informe es una orientación inicial y no reemplaza una inspección presencial de un mecánico profesional.'
    });
  } catch (err) {
    console.error('POST /api/inspect error:', err);
    const message = err.message || 'Error del servidor.';
    res.status(500).json({ ok: false, error: message });
  }
});

function normalizeVehicle(body) {
  const year = Number(body.year || 0);
  const km = Number(String(body.km || '').replace(/[^0-9]/g, ''));
  const price = Number(String(body.price || '').replace(/[^0-9]/g, '')) || null;

  return {
    brand: clean(body.brand),
    model: clean(body.model),
    year,
    km,
    price,
    fuel: clean(body.fuel),
    transmission: clean(body.transmission),
    sellerNotes: clean(body.sellerNotes),
    buyerQuestions: clean(body.buyerQuestions)
  };
}

function clean(value) {
  return String(value || '').trim().slice(0, 1200);
}

function buildPhotoPayload(files) {
  const allItems = [...REQUIRED_ITEMS, ...OPTIONAL_ITEMS];
  return allItems
    .filter(item => files[item.field]?.[0])
    .map(item => {
      const file = files[item.field][0];
      return {
        field: item.field,
        label: item.label,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        dataUrl: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
      };
    });
}

function ruleBasedAnalysis(vehicle, photos) {
  const age = Math.max(0, new Date().getFullYear() - vehicle.year);
  const expectedKmLow = age * 10000;
  const expectedKmHigh = age * 22000;
  let riskScore = 35;
  const redFlags = [];
  const positiveSignals = [];
  const questions = [];
  const nextSteps = [];

  if (vehicle.km > expectedKmHigh + 30000) {
    riskScore += 22;
    redFlags.push('Kilometraje alto para el año declarado. Conviene revisar historial de mantenciones y desgaste general.');
  } else if (vehicle.km < Math.max(15000, expectedKmLow - 25000) && age > 4) {
    riskScore += 14;
    redFlags.push('Kilometraje llamativamente bajo para la antigüedad. Verificar historial, revisiones técnicas y posible manipulación de odómetro.');
  } else {
    riskScore -= 7;
    positiveSignals.push('Kilometraje relativamente coherente con el año, sujeto a validación documental.');
  }

  if (age >= 10) {
    riskScore += 12;
    redFlags.push('Vehículo con más de 10 años: revisar fugas, suspensión, refrigeración, frenos y corrosión.');
  }

  if (vehicle.price) {
    positiveSignals.push('El precio fue informado, por lo que se puede comparar luego contra mercado y estado real.');
  }

  const labels = photos.map(p => p.label).join(', ');
  positiveSignals.push(`Fotos recibidas para revisión inicial: ${labels}.`);

  questions.push('¿Tiene historial de mantenciones con fechas, kilometraje y taller?');
  questions.push('¿Cuándo fue el último cambio de aceite y qué viscosidad se usó?');
  questions.push('¿Ha tenido choques, reparaciones de pintura o siniestros declarados?');
  questions.push('¿Hay consumo de aceite, pérdida de refrigerante o aumento de temperatura?');
  questions.push('¿La transferencia puede hacerse de inmediato y sin prendas, multas o limitaciones?');
  questions.push('¿Permite escanear el vehículo y revisarlo con mecánico antes de comprar?');

  nextSteps.push('Solicitar padrón, revisión técnica, certificado de multas, certificado de anotaciones vigentes y mantenciones.');
  nextSteps.push('Hacer prueba en frío: partida, ralentí, humo, ruidos, temperatura y funcionamiento de electroventilador.');
  nextSteps.push('Escanear con OBD2 antes de pagar o reservar.');
  nextSteps.push('Agendar revisión presencial profesional antes de tomar la decisión final.');

  riskScore = Math.max(0, Math.min(100, riskScore));

  return {
    verdict: riskScore >= 70 ? 'Riesgo alto: no comprar sin revisión mecánica completa.' : riskScore >= 45 ? 'Riesgo medio: avanzar solo con más antecedentes y revisión presencial.' : 'Riesgo moderado/bajo: puede seguir evaluándose, pero requiere revisión profesional.',
    riskScore,
    estimatedKmRange: `${expectedKmLow.toLocaleString('es-CL')} - ${expectedKmHigh.toLocaleString('es-CL')} km esperados aprox. según antigüedad`,
    redFlags,
    positiveSignals,
    questionsForSeller: questions,
    recommendedNextSteps: nextSteps,
    visualFindings: [
      'Sin IA configurada, las fotos quedan registradas como evidencia para la pauta, pero no se interpretan visualmente en profundidad.',
      'Para análisis visual real agrega OPENAI_API_KEY en Render.'
    ],
    professionalCallToAction: 'Para reducir el riesgo real de compra, agenda una inspección presencial con mecánico: escáner, prueba de ruta, revisión de fugas, tren delantero, frenos, refrigeración y documentación.'
  };
}

async function analyzeWithOpenAI(vehicle, photos, baseAnalysis) {
  const content = [
    {
      type: 'input_text',
      text: `Eres un asesor automotriz chileno. Analiza una posible compra de vehículo usado con fotos y datos. No inventes certezas: si una foto no permite concluir algo, dilo. Entrega SOLO JSON válido con estas claves: verdict, riskScore, estimatedKmRange, visualFindings, redFlags, positiveSignals, questionsForSeller, recommendedNextSteps, professionalCallToAction. El informe NO reemplaza inspección presencial. Datos: ${JSON.stringify(vehicle)}. Análisis base: ${JSON.stringify(baseAnalysis)}`
    },
    ...photos.flatMap(photo => ([
      { type: 'input_text', text: `Foto: ${photo.label}` },
      { type: 'input_image', image_url: photo.dataUrl }
    ]))
  ];

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [{ role: 'user', content }],
      max_output_tokens: 1700
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${text.slice(0, 400)}`);
  }

  const data = await response.json();
  const outputText = extractOutputText(data);
  const parsed = parseJsonLoose(outputText);

  return {
    ...baseAnalysis,
    ...parsed,
    riskScore: clampNumber(parsed.riskScore ?? baseAnalysis.riskScore, 0, 100)
  };
}

function extractOutputText(data) {
  if (typeof data.output_text === 'string') return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    for (const part of item.content || []) {
      if (part.type === 'output_text' && part.text) chunks.push(part.text);
      if (part.type === 'text' && part.text) chunks.push(part.text);
    }
  }
  return chunks.join('\n').trim();
}

function parseJsonLoose(text) {
  if (!text) throw new Error('Respuesta de IA vacía.');
  const cleaned = text.replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (_err) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('La IA no devolvió JSON válido.');
  }
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ AutoInspector activo en puerto ${PORT}`);
  console.log(`🤖 IA visual: ${OPENAI_API_KEY ? 'activada' : 'desactivada / modo reglas'}`);
});
