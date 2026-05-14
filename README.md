# AutoInspector

Sitio web para generar una preinspección de un vehículo usado antes de comprarlo. Permite cargar fotos desde cámara o galería, comprimirlas en el navegador, subirlas a Cloudinary y generar un informe preliminar con IA.

> Este informe no reemplaza una revisión presencial de un mecánico profesional.

## Funciones principales

- Formulario con datos del vehículo.
- Comparación entre precio de compra y precio de mercado.
- Campo de preocupación o sospecha del comprador.
- Dos fotos mínimas por ítem obligatorio.
- Fotos desde cámara, galería o combinación de ambas.
- Compresión de imágenes en el navegador.
- Almacenamiento opcional en Cloudinary.
- Análisis visual con Gemini Vision usando `GEMINI_API_KEY`.
- OpenAI queda como respaldo opcional si configuras `OPENAI_API_KEY`.
- Botón para contactar mecánico por WhatsApp o correo.
- Informe con estados visuales: ✅ correcto, ⚠️ revisar, ❌ urgente.

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

## Variables de entorno recomendadas en Render

```txt
GEMINI_API_KEY=tu_clave_gemini
GEMINI_MODEL=gemini-2.5-flash

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

OpenAI opcional como respaldo pagado:

```txt
OPENAI_API_KEY=sk-proj-tu_clave_openai
OPENAI_MODEL=gpt-4o-mini
```

El servidor prioriza Gemini:

```txt
1. Si existe GEMINI_API_KEY → usa Gemini Vision
2. Si no existe Gemini pero existe OPENAI_API_KEY → usa OpenAI Vision
3. Si no hay IA o falla → usa reglas preventivas
```

## Render

Configura el servicio como **Web Service**, no como Static Site.

```txt
Build Command: npm install
Start Command: npm start
```

Si subiste el proyecto dentro de una carpeta llamada `autoinspector`, configura en Render:

```txt
Root Directory: autoinspector
```

Si `server.js` y `package.json` están en la raíz del repositorio, deja Root Directory vacío.

## Pruebas

Ver estado general:

```txt
https://TU-WEB.onrender.com/api/health
```

Probar Gemini/OpenAI sin fotos:

```txt
https://TU-WEB.onrender.com/api/ai-test
```

Respuesta esperada con Gemini:

```json
{
  "ok": true,
  "aiEnabled": true,
  "aiProvider": "gemini"
}
```

## Nota sobre Gemini gratis

Gemini API puede tener límites de uso gratuito según país, cuenta y modelo. Para pruebas iniciales conviene usar `gemini-2.5-flash`. Si Gemini devuelve error de cuota o límite, el sitio seguirá funcionando con reglas preventivas.
