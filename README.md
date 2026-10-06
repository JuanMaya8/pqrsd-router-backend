# pqrsd-router-backend

Backend (**NestJS 10**) del proyecto *Clasificador y Enrutador Inteligente de PQRSD para Entidades Públicas*.
Es el segundo repositorio del sistema (junto a `pqrsd-router-frontend` y `pqrsd-router-ai`).

Hace lo que no puede hacer ni la IA ni la pantalla: **radica** la solicitud (número de radicado + código de seguimiento),
**clasifica al recibirla** (llamando a la IA), calcula el **plazo legal en días hábiles colombianos** (festivos, Ley Emiliani, Semana Santa),
mantiene el **semáforo de vencimiento (SLA)**, gobierna el **flujo de estados**, calcula **indicadores**, transmite **eventos en tiempo real**
y devuelve a la IA las **correcciones de los funcionarios** (sin datos personales) para que aprenda.

> **Estado: avance funcional (v0.1.0)**, no el proyecto terminado. Lee *Qué está hecho y qué no*.

## Cómo ejecutarlo

Requisitos: **Node 18.18+** (probado con Node 22 en el sandbox) y, para clasificar de verdad, `pqrsd-router-ai` corriendo en `:8000`
(si no está, el backend **sigue funcionando** con un clasificador de respaldo por palabras clave).

```bash
npm install
cp .env.example .env              # opcional; ver la tabla de variables
npm run start:dev                 # http://localhost:3001/api/v1   ·   Swagger: http://localhost:3001/docs

npm run typecheck && npm test     # 51 pruebas del dominio (no necesitan Nest ni red)
npm run test:http                 # pruebas HTTP/WebSocket con Nest real y una IA falsa (ver «Qué está hecho»)
npm run build && npm start        # producción (NODE_ENV=production exige STAFF_API_KEY)
```

Prueba rápida:
```bash
curl -s localhost:3001/api/v1/pqrsd -H 'content-type: application/json' -d '{
  "text":"Hace tres semanas no llega el agua a mi barrio Santa Lucía y tengo un bebé.",
  "citizen":{"name":"Ana Pérez","email":"ana@correo.co"}, "consent":true }'
# → { radicado:"PQRSD-2025-000001", trackingCode:"K7M2QX", dueDate:"…", legalDays:15, message:"…" }

curl -s -XPOST localhost:3001/api/v1/staff/demo/seed -H 'content-type: application/json' -d '{"count":80}'   # datos de demostración
curl -s "localhost:3001/api/v1/staff/pqrsd?sort=priority:desc&limit=5"                                       # bandeja ordenada
```
Con las dos piezas juntas: `STAFF_API_KEY=cambia-esto docker compose up --build` (espera `../pqrsd-router-ai`).

### Variables de entorno (`.env.example`)
| Variable | Por defecto | Para qué |
|----------|-------------|----------|
| `STAFF_API_KEY` | — | Clave `X-Staff-Key` de los funcionarios (rutas `/staff/*` y sala de socket). **Obligatoria en producción** |
| `AI_URL`, `AI_API_KEY`, `AI_TIMEOUT_MS` | `http://localhost:8000`, —, `8000` | Servicio de IA. Pasado el timeout se usa el respaldo y se omite la IA 20 s |
| `DATA_DIR` | `./data` | Un archivo JSON por caso (montar volumen en producción) |
| `CORS_ORIGINS` | `http://localhost:3000` | Orígenes del frontend |
| `PUBLIC_WRITE_LIMIT`, `THROTTLE_LIMIT`, `TRUST_PROXY` | `20`, `300`, `0` | Límites por IP por minuto (escrituras anónimas / todo). `TRUST_PROXY=1` detrás de un proxy |
| `DENUNCIA_DAYS` | `15` | Plazo en días hábiles para denuncias (**validar con el área jurídica**) |
| `AUTO_ASSIGN_MIN_CONFIDENCE` | `0` (apagado) | Con `0.85`, los casos que la IA clasifica con confianza y sin alertas saltan la revisión humana |
| `FEEDBACK_ON_CONFIRM` | `false` | Enviar también las confirmaciones a la IA (por defecto no, para no reforzar sus propios errores) |

## Arquitectura

```
src/
├── domain/                      ← TODO el negocio, sin Nest (se prueba con tsx --test, sin servidor)
│   ├── calendar.ts              festivos de Colombia, día hábil, sumar/restar días hábiles, zona horaria America/Bogota
│   ├── deadlines.ts             plazos legales por tipo/subtipo (Ley 1755/2015), fecha de vencimiento, semáforo SLA
│   ├── workflow.ts              pending_review → assigned → answered → closed (transiciones válidas)
│   ├── pqrsd-service.ts         casos de uso: preview, create, tracking, confirm, reclassify, answer, close, stats, import, demo
│   ├── classification-service.ts  IA con degradación: si cae, clasificador de respaldo y «cortacircuito» de 20 s
│   ├── fallback-classifier.ts   palabras clave conservadoras; siempre «requiere revisión»; dependencia = Atención al Ciudadano
│   ├── ai-client.ts             cliente HTTP de pqrsd-router-ai (errores de red/5xx → AI_UNAVAILABLE)
│   ├── repository.ts            PqrsdRepository + BlobPqrsdRepository (JSON por caso, contador atómico, índice en memoria)
│   ├── summary.ts / stats.ts    vistas (resumen/detalle), filtros y orden, anonimización, indicadores públicos y de funcionario
│   ├── validation.ts            validación a mano con mensajes en español (sin class-validator)
│   ├── rate-limiter.ts · ids.ts · csv.ts · events.ts · labels.ts · demo-data.ts · config.ts · clock.ts · errors.ts
├── http/                        guarda de funcionario, límite de escrituras públicas, filtro de excepciones, DTOs de Swagger
├── modules/                     controladores (público, funcionario) y gateway socket.io
└── app.module.ts · core.module.ts · app.factory.ts · main.ts
test/                            calendar · service · repository · validation · contract (con salida REAL de la IA) · http/ (e2e)
docs/CONTRACT.md                 contrato compartido por los 3 repos
```

Capas: **HTTP (controladores) → `PqrsdService` → repositorio / IA / eventos**. Los controladores no tienen lógica; el dominio no importa Nest.

### Decisiones de diseño
* **Plazos legales como código, no como texto**: `calendar.ts` genera los festivos de cualquier año (fijos, trasladados al lunes y de Semana Santa) y
  se contrastó con el calendario oficial de 2025 y 2026. El término cuenta desde el **día hábil siguiente** a la radicación y siempre desde la fecha original
  aunque el funcionario reclasifique. **Es una configuración técnica de referencia, no asesoría jurídica** (la tabla está en `deadlines.ts` y en `/public/transparency`).
* **La IA nunca bloquea al ciudadano**: si no responde, se radica igual con el clasificador de respaldo y queda marcada para revisión.
* **Privacidad**: la vista pública de seguimiento exige el código y no revela si un radicado existe (mismo 404); la transparencia solo agrega cifras; el CSV y los
  eventos de socket no llevan texto ni datos personales; la retroalimentación a la IA se envía **anonimizada** (entidades personales detectadas por la IA + lo que el
  ciudadano declaró en el formulario). Los datos del ciudadano solo se ven con la clave de funcionario.
* **Prioridad que ve el funcionario** (`priority:desc`): `priorityScore` de la IA + 20 si ya venció + 8 si está en riesgo, así un caso de urgencia alta ya vencido (72 + 20 = 92)
  pasa por delante de uno crítico recién llegado (90), pero uno de urgencia media vencido (62) no. Las solicitudes ya respondidas o cerradas van siempre al final (no requieren acción, por urgentes que hayan sido).
* **Radicados sin colisiones**: el contador se reserva por rangos con escrituras serializadas y se reconstruye desde los archivos si el contador quedó atrás.
* **Persistencia**: archivos JSON detrás de la interfaz `PqrsdRepository`. Para producción real, implementar esa interfaz sobre PostgreSQL (ver `AI_CONTEXT.md`).

### Patrón de renderizado
No aplica a este repo (API JSON + WebSocket). El patrón por ruta (SSG / CSR / SSR / ISR) está justificado en el README de `pqrsd-router-frontend`.

## Qué está hecho y qué no

| Estado | Elemento |
|--------|----------|
| ✅ Verificado (51 pruebas ejecutadas con `tsx --test`, Node 22; `tsc` limpio) | Calendario de festivos y días hábiles, plazos legales y SLA, flujo de estados, radicación con contador concurrente, persistencia y recuperación tras reinicio, respaldo cuando la IA cae (y recuperación), retroalimentación anonimizada, filtros/orden/CSV, estadísticas, transparencia pública sin datos personales, demostración, importación por lotes con IA que muere a mitad, validación, límite de tasa, **contrato contra salida real de la IA** |
| ⚠️ Escrito pero **no ejecutado** (no se pudo instalar NestJS: registro npm bloqueado) | Capa Nest: controladores, guardas, gateway socket.io, Swagger, `main.ts`; `test/http/app.e2e.test.ts`; `Dockerfile`, `docker-compose.yml`, CI; `scripts/import-github-issues.mjs` (sin internet). La capa Nest se comprobó con `tsc` contra tipos simulados de Nest, así que los **tipos propios** son coherentes, pero el cableado de decoradores no se ha ejecutado |
| ❌ No hecho | PostgreSQL, autenticación por usuario/roles (hoy una clave compartida), notificación por correo/SMS al ciudadano, adjuntos, asignación a un funcionario concreto, prórrogas y traslados por competencia (Art. 14 par. y Art. 21), recordatorios de vencimiento, auditoría inmutable, paginación por cursor |

Tras `npm install`, **lo primero** es `npm run test:http` y `npm run build`: si algo falla ahí es la capa Nest nunca ejecutada.

## Prueba de volumen con datos públicos reales
`node scripts/import-github-issues.mjs --repo=owner/name --max=1000 --key=$STAFF_API_KEY` descarga issues reales de GitHub y los importa como casos de demostración
(`isDemo`, borrables con `DELETE /staff/demo`). Sirve para medir rendimiento con miles de casos. **Los issues suelen estar en inglés y la IA es para español**:
casi todos caerán en «requiere revisión», así que úsalo como prueba de **volumen**, no de precisión (o usa un repo en español).

## Limitaciones conocidas
* Los archivos JSON y el índice en memoria alcanzan para decenas de miles de casos en una instancia; más allá, usa una base de datos.
* El límite de tasa es por instancia (en memoria).
* Los datos de demostración y el corpus de la IA son sintéticos.
* El texto del ciudadano puede incluir datos personales que la IA no reconozca: el texto completo se guarda y solo lo ve el funcionario.

## Despliegue (más adelante)
Imagen Docker lista. Montar un volumen en `/data`, definir `STAFF_API_KEY`, `AI_URL`, `CORS_ORIGINS` y `TRUST_PROXY=1` detrás de un proxy. Opciones simples: Render, Railway,
Fly.io o Cloud Run con volumen. Para varias réplicas hace falta base de datos compartida (contador, casos) y un adaptador de socket.io (Redis).

## Nombre de repositorio sugerido
`pqrsd-router-backend`
