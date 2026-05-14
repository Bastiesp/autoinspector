require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 3);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static('public'));

const cloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 12
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Solo se permiten imágenes'));
    }
    cb(null, true);
  }
});

const requiredPhotoFields = ['oilDipstick', 'tires', 'engine'];

const photoLabels = {
  oilDipstick: 'Varilla de aceite',
  tires: 'Neumáticos',
  engine: 'Motor',
  coolant: 'Refrigerante',
  dashboard: 'Tablero / kilometraje',
  bodywork: 'Carrocería',
  interior: 'Interior',
  exhaust: 'Escape / humo'
};

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseBoolean(value) {
  return value === 'true' || value === true || value === 'on';
}

function sanitizeFolderPart(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'vehiculo';
}

function normalizeVehicle(body) {
  return {
    brand: String(body.brand || '').trim(),
    model: String(body.model || '').trim(),
    year: String(body.year || '').trim(),
    mileage: String(body.mileage || '').trim(),
    fuel: String(body.fuel || '').trim(),
    transmission: String(body.transmission || '').trim(),
    price: String(body.price || '').trim(),
    sellerNotes: String(body.sellerNotes || '').trim(),
    warningLights: body.warningLights,
    oilLeaks: body.oilLeaks,
    overheating: body.overheating,
    accidentHistory: body.accidentHistory
  };
}

function buildRuleBasedReport(vehicle, photosSummary = []) {
  const alerts = [];
  const positives = [];
  const questions = [];
  const nextSteps = [];

  const year = safeNumber(vehicle.year);
  const mileage = safeNumber(vehicle.mileage);
  const currentYear = new Date().getFullYear();
  const age = year ? Math.max(currentYear - year, 0) : null;
  const kmPerYear = age && age > 0 ? Math.round(mileage / age) : null;

  let riskScore = 35;

  if (!vehicle.brand || !vehicle.model || !vehicle.year || !vehicle.mileage) {
    alerts.push('Faltan datos básicos del vehículo. El informe queda incompleto.');
    riskScore += 10;
  }

  if (mileage > 180000) {
    alerts.push('Kilometraje alto. Se recomienda revisar mantenimiento mayor, consumo de aceite, caja, suspensión y fugas.');
    riskScore += 18;
  } else if (mileage > 100000) {
    alerts.push('Kilometraje medio/alto. Conviene pedir historial de mantenciones y revisar desgaste general.');
    riskScore += 9;
  } else if (mileage > 0) {
    positives.push('Kilometraje dentro de un rango más favorable, siempre que sea coherente con el año y el desgaste visible.');
    riskScore -= 4;
  }

  if (kmPerYear && kmPerYear > 25000) {
    alerts.push(`Uso anual alto aproximado: ${kmPerYear.toLocaleString('es-CL')} km/año.`);
    riskScore += 10;
  }

  if (parseBoolean(vehicle.warningLights)) {
    alerts.push('El vendedor indica luces de advertencia encendidas. Esto requiere escáner antes de comprar.');
    riskScore += 18;
  }

  if (parseBoolean(vehicle.oilLeaks)) {
    alerts.push('Se reportan o sospechan fugas de aceite. Revisar motor por abajo y alrededor de tapa de válvulas, cárter y retenes.');
    riskScore += 14;
  }

  if (parseBoolean(vehicle.overheating)) {
    alerts.push('Hay antecedente o sospecha de temperatura alta. Revisar sistema de refrigeración, tapa, termostato, electroventilador y posible presión excesiva.');
    riskScore += 20;
  }

  if (parseBoolean(vehicle.accidentHistory)) {
    alerts.push('Existe antecedente o sospecha de choque. Revisar estructura, descuadres, soldaduras, pintura y airbags.');
    riskScore += 15;
  }

  const hasAllRequired = requiredPhotoFields.every((field) =>
    photosSummary.some((photo) => photo.fieldname === field)
  );

  if (hasAllRequired) {
    positives.push('Se adjuntaron las fotos mínimas obligatorias para una revisión preliminar.');
    riskScore -= 5;
  } else {
    alerts.push('No se adjuntaron todas las fotos mínimas: varilla de aceite, neumáticos y motor.');
    riskScore += 15;
  }

  if (photosSummary.some((p) => p.fieldname === 'dashboard')) {
    positives.push('Se adjuntó foto del tablero/kilometraje, útil para revisar testigos y coherencia del kilometraje.');
  }

  if (photosSummary.some((p) => p.fieldname === 'coolant')) {
    positives.push('Se adjuntó foto del refrigerante, útil para detectar señales de óxido, mezcla de fluidos o nivel bajo.');
  }

  if (vehicle.transmission === 'automatic') {
    questions.push('¿La caja automática realiza los cambios suaves en frío y en caliente?');
    questions.push('¿Cuándo fue el último cambio de aceite de caja y con qué especificación?');
  }

  questions.push('¿Tiene historial de mantenciones con fechas y kilometrajes?');
  questions.push('¿El kilometraje se puede respaldar con revisiones técnicas, boletas o historial de taller?');
  questions.push('¿Ha tenido choques, reparaciones estructurales o activación de airbags?');
  questions.push('¿Consume aceite entre mantenciones?');
  questions.push('¿Ha tenido problemas de temperatura o pérdida de refrigerante?');
  questions.push('¿Está al día en documentación, multas, permiso de circulación y revisión técnica?');
  questions.push('¿Acepta revisión con escáner y revisión presencial antes de concretar la compra?');

  nextSteps.push('Solicitar video del arranque en frío.');
  nextSteps.push('Pedir foto del tablero con motor encendido para ver testigos.');
  nextSteps.push('Comparar desgaste de volante, pedales, asiento y neumáticos con el kilometraje declarado.');
  nextSteps.push('Hacer prueba de manejo y verificar frenado, dirección, suspensión, caja y temperatura.');
  nextSteps.push('Antes de pagar o reservar, realizar revisión presencial con mecánico y escáner.');

  riskScore = Math.min(Math.max(riskScore, 0), 100);

  let verdict = 'Riesgo medio: continuar solo con más antecedentes y revisión presencial.';
  if (riskScore < 30) verdict = 'Riesgo bajo preliminar: se ve favorable, pero debe confirmarse presencialmente.';
  if (riskScore >= 65) verdict = 'Riesgo alto: no se recomienda comprar sin revisión mecánica completa.';

  return {
    mode: 'rules',
    verdict,
    riskScore,
    alerts,
    positives,
    questions,
    nextSteps,
    professionalRecommendation:
      'Este informe no reemplaza una revisión mecánica. La recomendación final es coordinar una inspección presencial profesional antes de comprar.',
    contact: {
      whatsapp: process.env.CONTACT_WHATSAPP || '',
      email: process.env.CONTACT_EMAIL || ''
    }
  };
}

function photoToBase64DataUrl(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

function uploadBufferToCloudinary(file, vehicle) {
  if (!cloudinaryConfigured) return Promise.resolve(null);

  const baseFolder = process.env.CLOUDINARY_FOLDER || 'autoinspector/inspections';
  const vehicleFolder = `${sanitizeFolderPart(vehicle.brand)}-${sanitizeFolderPart(vehicle.model)}-${sanitizeFolderPart(vehicle.year)}`;
  const dateFolder = new Date().toISOString().slice(0, 10);
  const folder = `${baseFolder}/${dateFolder}/${vehicleFolder}`;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        public_id: `${file.fieldname}-${Date.now()}`,
        overwrite: false,
        tags: ['autoinspector', 'inspection', file.fieldname],
        context: {
          item: photoLabels[file.fieldname] || file.fieldname,
          brand: vehicle.brand || '',
          model: vehicle.model || '',
          year: vehicle.year || '',
          mileage: vehicle.mileage || ''
        }
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({
          fieldname: file.fieldname,
          label: photoLabels[file.fieldname] || file.fieldname,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          secure_url: result.secure_url,
          public_id: result.public_id,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
          format: result.format
        });
      }
    );

    stream.end(file.buffer);
  });
}

async function uploadPhotos(files, vehicle) {
  const uploaded = [];

  for (const file of files) {
    const cloudinaryPhoto = await uploadBufferToCloudinary(file, vehicle);
    if (cloudinaryPhoto) {
      uploaded.push(cloudinaryPhoto);
    } else {
      uploaded.push({
        fieldname: file.fieldname,
        label: photoLabels[file.fieldname] || file.fieldname,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      });
    }
  }

  return uploaded;
}

async function analyzeWithOpenAI(vehicle, files, uploadedPhotos, baseReport) {
  if (!process.env.OPENAI_API_KEY) return null;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  const photosForPrompt = uploadedPhotos.map((photo) => ({
    item: photo.label || photo.fieldname,
    url: photo.secure_url || null,
    size: photo.size || photo.bytes || null
  }));

  const imageContent = uploadedPhotos
    .filter((photo) => photo.secure_url)
    .slice(0, 8)
    .map((photo) => ({
      type: 'image_url',
      image_url: { url: photo.secure_url }
    }));

  if (imageContent.length === 0) {
    imageContent.push(
      ...files.slice(0, 8).map((file) => ({
        type: 'image_url',
        image_url: { url: photoToBase64DataUrl(file) }
      }))
    );
  }

  const prompt = `
Eres un asistente experto en inspección preliminar de autos usados en Chile.
Analiza los datos y fotos entregadas. No inventes datos que no se ven.
Tu objetivo es orientar al comprador, detectar riesgos y sugerir preguntas.
Nunca digas que esto reemplaza a un mecánico.

Datos del vehículo:
${JSON.stringify(vehicle, null, 2)}

Fotos recibidas:
${JSON.stringify(photosForPrompt, null, 2)}

Informe base por reglas:
${JSON.stringify(baseReport, null, 2)}

Devuelve SOLO JSON válido con esta estructura:
{
  "mode": "ai",
  "verdict": "texto breve",
  "riskScore": numero_0_a_100,
  "alerts": ["..."],
  "positives": ["..."],
  "questions": ["..."],
  "nextSteps": ["..."],
  "photoObservations": [
    {
      "item": "varilla/neumaticos/motor/etc",
      "observation": "observación prudente basada en imagen",
      "risk": "bajo/medio/alto/no concluyente"
    }
  ],
  "professionalRecommendation": "texto"
}
`;

  const response = await client.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          ...imageContent
        ]
      }
    ],
    temperature: 0.2
  });

  const raw = response.choices?.[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw);

  return {
    ...parsed,
    contact: {
      whatsapp: process.env.CONTACT_WHATSAPP || '',
      email: process.env.CONTACT_EMAIL || ''
    }
  };
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    name: 'AutoInspector',
    aiEnabled: Boolean(process.env.OPENAI_API_KEY),
    cloudinaryEnabled: cloudinaryConfigured,
    maxUploadMb: MAX_UPLOAD_MB,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/inspect', upload.any(), async (req, res) => {
  try {
    const vehicle = normalizeVehicle(req.body);
    const files = req.files || [];

    const receivedPhotos = files.map((file) => ({
      fieldname: file.fieldname,
      label: photoLabels[file.fieldname] || file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    }));

    const missingRequiredPhotos = requiredPhotoFields.filter(
      (field) => !receivedPhotos.some((photo) => photo.fieldname === field)
    );

    if (missingRequiredPhotos.length > 0) {
      return res.status(400).json({
        error: 'Faltan fotos obligatorias',
        missingRequiredPhotos: missingRequiredPhotos.map((field) => photoLabels[field] || field)
      });
    }

    const uploadedPhotos = await uploadPhotos(files, vehicle);
    const baseReport = buildRuleBasedReport(vehicle, uploadedPhotos);

    let finalReport = baseReport;

    try {
      const aiReport = await analyzeWithOpenAI(vehicle, files, uploadedPhotos, baseReport);
      if (aiReport) finalReport = aiReport;
    } catch (aiError) {
      console.error('Error IA, usando reglas:', aiError.message);
      finalReport = {
        ...baseReport,
        aiWarning:
          'No se pudo completar el análisis con IA. Se generó un informe preliminar por reglas.'
      };
    }

    res.json({
      ok: true,
      vehicle,
      photos: uploadedPhotos,
      storage: cloudinaryConfigured ? 'cloudinary' : 'temporary-memory',
      report: finalReport,
      disclaimer:
        'AutoInspector entrega una orientación preliminar y no reemplaza la revisión de un mecánico profesional.'
    });
  } catch (error) {
    console.error('POST /api/inspect error:', error);
    res.status(500).json({
      error: 'Error generando informe',
      details: error.message
    });
  }
});

app.use((err, req, res, next) => {
  console.error('Middleware error:', err);

  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: `Una foto supera el máximo permitido por el servidor (${MAX_UPLOAD_MB} MB). Comprímela o sube una imagen más liviana.`
    });
  }

  if (err && err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ error: 'Se superó el máximo de fotos permitido.' });
  }

  res.status(400).json({
    error: err.message || 'Error procesando la solicitud'
  });
});

app.listen(PORT, () => {
  console.log(`AutoInspector corriendo en puerto ${PORT}`);
  console.log(`Cloudinary: ${cloudinaryConfigured ? 'configurado' : 'no configurado'}`);
  console.log(`Máximo por foto: ${MAX_UPLOAD_MB} MB`);
});
