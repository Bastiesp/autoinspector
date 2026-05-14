# AutoInspector

AutoInspector es una web app para generar un informe preliminar de compra de vehículos usados usando datos del comprador, fotos y análisis con IA opcional.

## Funciones de esta versión

- Sitio responsive tipo app premium.
- Subida de fotos desde cámara o galería del celular, con mínimo 2 fotos por ítem obligatorio y libertad de usar ambas desde galería o ambas desde cámara.
- Dos fotos por cada ítem de inspección.
- Compresión de imágenes en el navegador antes de subirlas.
- Cloudinary para guardar fotos comprimidas.
- Análisis de precio de compra versus precio promedio de mercado.
- Campo de preocupación o sospecha del comprador.
- Informe con veredicto, riesgo, alertas, preguntas para el vendedor y próximos pasos.
- Botón de contacto a mecánico por WhatsApp y correo.
- OpenAI opcional. Si no hay API key, genera informe por reglas preventivas.

## Estructura

```txt
autoinspector/
├─ public/
│  ├─ index.html
│  ├─ styles.css
│  └─ app.js
├─ server.js
├─ package.json
├─ render.yaml
├─ .node-version
├─ .env.example
├─ .gitignore
└─ README.md
```

## Variables de entorno en Render

Obligatorias solo si quieres IA y almacenamiento permanente:

```txt
OPENAI_API_KEY=tu_clave_openai
OPENAI_MODEL=gpt-4o-mini

CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret
CLOUDINARY_FOLDER=autoinspector/inspections

CONTACT_WHATSAPP=56912345678
CONTACT_EMAIL=contacto@autoinspector.cl
MECHANIC_NAME=AutoInspector Mecánico

MAX_UPLOAD_MB=3
MAX_FILES=24
```

## Deploy en Render

```txt
Build Command: npm install
Start Command: npm start
```

## Endpoints

```txt
GET /api/health
GET /api/config
POST /api/inspect
```

## Importante

El informe es una orientación preliminar. No reemplaza la revisión presencial de un mecánico profesional.


## Cambios versión gris + contacto
- Fondo general cambiado a escala de grises profesional, manteniendo botones e iconos verdes.
- Botones de contacto ahora abren WhatsApp si existe `CONTACT_WHATSAPP`; si no, abren correo con `CONTACT_EMAIL`.
- Si no configuras ninguna variable de contacto, el botón muestra un aviso en pantalla en vez de quedar sin acción.

Ejemplo de WhatsApp para Chile:

```env
CONTACT_WHATSAPP=56912345678
```

No uses `+`, espacios ni guiones en el número.

## Corrección importante: fotos flexibles y estado de IA

Desde esta versión, cada ítem obligatorio acepta mínimo 2 fotos desde cualquier combinación:

- 2 fotos desde galería.
- 2 fotos tomadas con cámara.
- 1 foto de cámara + 1 foto de galería.

El frontend ya no obliga a llenar “foto 1 cámara / foto 2 galería”. Cada ítem acumula fotos y valida que tenga al menos 2 antes de generar el informe.

Si `/api/health` muestra `aiEnabled: false`, revisa en Render que exista exactamente esta variable:

```txt
OPENAI_API_KEY=sk-proj_tu_clave
```

Luego guarda los cambios y ejecuta **Manual Deploy → Deploy latest commit**. El endpoint `/api/health` ahora también devuelve `aiStatus` para explicar por qué la IA aparece desactivada.


## Diagnóstico IA

Si el informe muestra “Reglas preventivas, IA no disponible temporalmente”, abre `/api/health` en tu sitio de Render y revisa:

- `aiEnabled` debe estar en `true`.
- `OPENAI_API_KEY` debe existir en Render y empezar con `sk-` o `sk-proj-`.
- La cuenta API debe tener créditos/facturación disponible.
- `OPENAI_MODEL` puede quedar como `gpt-4o-mini`.

Aunque la IA falle, AutoInspector mostrará observaciones preventivas por reglas y símbolos visuales por bloque: ✅ correcto, ⚠️ revisar y ❌ urgente.
