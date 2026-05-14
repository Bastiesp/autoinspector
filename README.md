# AutoInspector

Sitio web para generar una inspección preliminar de un vehículo usado antes de comprarlo.

La aplicación permite:

- Ingresar datos básicos del vehículo.
- Subir fotos clave tomadas desde el celular.
- Comprimir las fotos en el navegador antes de enviarlas.
- Guardar fotos en Cloudinary, si las variables están configuradas.
- Analizar el caso con reglas preventivas.
- Usar OpenAI para análisis con visión, si configuras `OPENAI_API_KEY`.
- Generar un informe con alertas, preguntas al vendedor y próximos pasos.

> Importante: el informe no reemplaza la revisión presencial de un mecánico profesional.

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

## Instalación local

```bash
npm install
npm start
```

Luego abre:

```txt
http://localhost:3000
```

## Variables de entorno

Copia `.env.example` como `.env` si trabajas localmente.

```env
PORT=3000
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_FOLDER=autoinspector/inspections
MAX_UPLOAD_MB=3

CONTACT_WHATSAPP=56912345678
CONTACT_EMAIL=contacto@autoinspector.cl
```

## Cloudinary

Si no configuras Cloudinary, las fotos se usan solo durante la solicitud y no quedan guardadas permanentemente.

Para guardar las fotos debes agregar estas variables en Render:

```env
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret
CLOUDINARY_FOLDER=autoinspector/inspections
```

Las fotos quedan ordenadas por fecha y vehículo dentro de Cloudinary.

## Compresión de fotos

El frontend comprime cada imagen antes de subirla:

- Máximo original permitido: 12 MB.
- Tamaño máximo visual: 1400 px por lado.
- Calidad JPEG aproximada: 72%.
- Objetivo aproximado: 1.5 MB por foto.

El servidor además aplica un límite final con `MAX_UPLOAD_MB`, por defecto 3 MB por imagen.

## Deploy en Render

Usa el repositorio `autoinspector` en GitHub.

Configuración en Render:

```txt
Build Command: npm install
Start Command: npm start
```

También se incluye `render.yaml`.

## Endpoints útiles

```txt
GET /api/health
POST /api/inspect
```

`/api/health` muestra si OpenAI y Cloudinary están configurados.
