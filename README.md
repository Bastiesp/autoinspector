# AutoInspector

Sitio web para generar una inspección preliminar asistida por IA del estado de un vehículo usado antes de comprarlo.

## Qué hace

- Solicita datos básicos del vehículo: marca, modelo, año, kilometraje, precio, combustible y transmisión.
- Pide al menos 3 fotos obligatorias:
  - Varilla de aceite
  - Neumáticos
  - Motor / vano motor
- Permite fotos opcionales:
  - Refrigerante / depósito
  - Tablero / kilometraje
  - Carrocería / pintura
  - Interior
  - Escape / humo visible
- Genera un informe con:
  - Veredicto inicial
  - Puntaje de riesgo
  - Alertas importantes
  - Señales positivas
  - Preguntas para hacer al vendedor
  - Próximos pasos recomendados
  - Llamado a agendar revisión presencial profesional

## Importante

AutoInspector no reemplaza una inspección presencial de un mecánico. El objetivo comercial del sitio es orientar al comprador y llevarlo a solicitar una revisión profesional.

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
└─ README.md
```

## Ejecutar localmente

```bash
npm install
cp .env.example .env
npm run dev
```

Luego abre:

```txt
http://localhost:3000
```

## Desplegar en Render

1. Crea un repositorio en GitHub llamado `autoinspector`.
2. Sube todos estos archivos a la raíz del repositorio.
3. En Render, crea un nuevo **Web Service** conectado a ese repositorio.
4. Usa:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Agrega variables de entorno si quieres IA real:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL`, por ejemplo `gpt-4.1-mini`
   - `CONTACT_WHATSAPP`, por ejemplo `56912345678`
   - `CONTACT_EMAIL`, por ejemplo `contacto@autoinspector.cl`

## Modo con IA y modo sin IA

- Sin `OPENAI_API_KEY`: el sistema funciona con análisis básico por reglas.
- Con `OPENAI_API_KEY`: el backend envía los datos y fotos a la API de OpenAI para análisis visual y textual.

## Endpoints

### `GET /api/health`

Verifica si el servidor está activo.

### `GET /api/config`

Entrega configuración pública del sitio.

### `POST /api/inspect`

Recibe formulario `multipart/form-data` con datos del vehículo y fotos.
