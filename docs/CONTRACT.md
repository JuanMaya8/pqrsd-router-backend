# Contrato entre los 3 repositorios de pqrsd-router

> Este archivo es **idéntico en los tres repos** (`pqrsd-router-frontend`, `pqrsd-router-backend`,
> `pqrsd-router-ai`). Si cambias algo aquí, cámbialo en los tres.
> Código, identificadores y nombres de campo: inglés. Mensajes para el usuario: español.

## 1. Mapa del sistema

```
┌─────────────────────────────┐  REST /api/v1 + socket.io   ┌──────────────────────────┐   REST /v1    ┌───────────────────────┐
│ pqrsd-router-frontend       │ ──────────────────────────► │ pqrsd-router-backend     │ ────────────► │ pqrsd-router-ai       │
│ Next.js 14 · :3000          │ ◄────────────────────────── │ NestJS · :3001           │ ◄──────────── │ FastAPI · :8000       │
│ SSG · CSR · SSR · ISR       │                             │ dominio legal + SLA      │               │ TF-IDF+LogReg + reglas │
└─────────────────────────────┘                             │ radicado · flujo · stats │               │ entidades (NER reglas) │
                                                            └──────────────────────────┘               └───────────────────────┘
```

* El ciudadano escribe texto libre. **Al radicar**, el backend pide a la IA tipo, dependencia competente, urgencia y
  entidades; calcula el **plazo legal en días hábiles colombianos** y el semáforo (SLA); genera el radicado.
* La IA es **opcional en tiempo de ejecución**: si cae, el backend usa un clasificador de palabras clave de respaldo
  (`classification.source = "fallback"`, siempre `needsReview = true`, dependencia = Atención al Ciudadano).
* Las correcciones de los funcionarios viajan a la IA como **retroalimentación** (`POST /v1/feedback`) y sirven para reentrenar.
* La vista pública **no contiene datos personales**; los datos del ciudadano solo se ven con la clave de funcionario.

Puertos por defecto: frontend `3000`, backend `3001`, ai `8000`.

## 2. Vocabulario compartido (ids)

| Cabeza        | Ids |
|---------------|-----|
| `type`        | `peticion`, `queja`, `reclamo`, `sugerencia`, `denuncia` |
| `urgency`     | `critical` (Crítica), `high` (Alta), `medium` (Media), `low` (Baja) |
| `subtype` (solo si `type = peticion`) | `general`, `information`, `consultation` |
| `dependency`  | configurable (`GET /v1/taxonomy`). Por defecto: `atencion_ciudadano` (respaldo), `salud`, `movilidad`, `hacienda`, `infraestructura`, `educacion`, `ambiente`, `planeacion`, `servicios_publicos`, `seguridad`, `control_interno`, `desarrollo_social` |
| `status`      | `pending_review` → `assigned` → `answered` → `closed` |
| `slaStatus`   | `on_time`, `at_risk` (≤ 3 días hábiles o ≤ 20 % del plazo), `overdue`, `done` (ya respondida) |
| entidad `type`| `date`, `amount`, `place`, `address`, `procedure`, `person`, `document_id`, `phone`, `email`, `radicado`, `plate` |

## 3. Servicio IA (`pqrsd-router-ai`) — `http://localhost:8000`

Cabecera opcional `X-API-Key` (si el servicio define `AI_API_KEY`; `/health` nunca la pide).
Errores: `{ "code": "...", "message": "<español>" }`; validación de forma → 422 estándar de FastAPI.

| Método | Ruta                    | Descripción |
|--------|-------------------------|-------------|
| GET    | `/health`               | `{status:"ok", version, model_version, ready}` |
| POST   | `/v1/classify`          | Clasifica un texto → `Classification` |
| POST   | `/v1/classify/batch`    | Hasta 200 textos → `{results:[{id, classification}], total, needs_review, latency_ms}` |
| POST   | `/v1/entities`          | Solo entidades + `redacted_text` |
| GET    | `/v1/taxonomy`          | Tipos, urgencias, subtipos y dependencias (con palabras clave) |
| POST   | `/v1/feedback`          | Corrección humana (201). Al menos una etiqueta. 422 `UNKNOWN_DEPENDENCY` / `EMPTY_FEEDBACK` |
| GET    | `/v1/feedback/stats`    | `{total, by_head, since_last_training}` |
| GET    | `/v1/model`             | Versión, métricas de validación, nº de ejemplos sintéticos vs. reales |
| POST   | `/v1/retrain`           | Reentrena con sintético + retroalimentación (409 si ya hay uno en curso) |

**ClassifyRequest**
```json
{ "text": "Hace tres semanas no llega el agua a mi barrio…", "reference_date": "2025-06-10", "top_k": 3, "redact": false }
```
`text` ≤ 20 000 caracteres. `reference_date` resuelve fechas relativas («ayer», «hace 3 días»).

**Classification**
```json
{
  "type":       { "id": "reclamo", "label": "Reclamo", "confidence": 0.71, "alternatives": [{"id":"peticion","label":"Petición","confidence":0.2}], "reasons": ["…"] },
  "dependency": { "id": "servicios_publicos", "label": "Servicios Públicos Domiciliarios", "confidence": 0.83, "alternatives": [], "routed_to_fallback": false, "reasons": ["…"] },
  "urgency":    { "id": "high", "label": "Alta", "confidence": 0.6, "priority_score": 72.4, "alternatives": [], "reasons": ["…"] },
  "subtype":    null,
  "entities":   [{ "type": "date", "label": "Fecha", "text": "ayer", "start": 10, "end": 14, "value": "2025-06-09", "pii": false, "approx": true }],
  "needs_review": false, "review_reasons": [],
  "redacted_text": null, "word_count": 31, "model_version": "hybrid-1760000000", "latency_ms": 12.4
}
```
* `priority_score` 0–100: esperanza de la urgencia con piso por nivel (crítica ≥ 85, alta ≥ 62, media ≥ 30). Úsese para ordenar la bandeja.
* `routed_to_fallback = true`: la confianza en la dependencia fue < 0.30; `dependency.id` es `atencion_ciudadano`
  y la probable real viene en `reasons`/`alternatives`.
* `needs_review`: el funcionario debe confirmar (baja confianza, texto muy corto, dos dependencias casi empatadas, urgencia escalada por señal de riesgo vital).
* `pii = true` en entidades de persona, documento, teléfono, correo y dirección.

**FeedbackRequest** `{ "text", "type?", "dependency?", "urgency?", "subtype?", "source_id?" }`.

## 4. Backend (`pqrsd-router-backend`) — `http://localhost:3001/api/v1`

Errores: `{ "statusCode": 400, "code": "VALIDATION_ERROR", "message": "<español>", "details"?: string[] }`.
Códigos: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `NOT_FOUND` 404, `INVALID_TRANSITION` 409, `AI_UNAVAILABLE` 503 (solo en `/staff/ai/*`),
`TOO_MANY_REQUESTS` 429, `PAYLOAD_TOO_LARGE` 413.
Funcionarios: cabecera `X-Staff-Key` (variable `STAFF_API_KEY`). Si la variable está vacía, el backend arranca en modo abierto solo con `NODE_ENV != production`.

### 4.1 Ciudadano (sin autenticación; con límite de peticiones)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/pqrsd/preview` | `{text}` → `PreviewResult` sin guardar nada (vista previa mientras escribe) |
| POST | `/pqrsd` | Radica. Cuerpo abajo → `Receipt` (201) |
| GET  | `/public/tracking/{radicado}?code=XXXXXX` | Estado público (404 si el código no coincide: no revela si el radicado existe) |
| GET  | `/public/transparency` | Agregados sin datos personales |
| GET  | `/meta/taxonomy` | Taxonomía para mostrar nombres y descripciones |
| GET  | `/health` | `{status, version, ai:{available, modelVersion}, store}` |

**PreviewResult** `{ classification:{ source:"ai"|"fallback", type:{id,label,confidence,reasons}, dependency:{id,name,confidence,reasons}, urgency:{id,label,confidence,reasons}, subtype:{id,label}|null, needsReview, entities:[{type,label,text,value}] /* solo no personales */ }, deadline:{ legalDays, dueDate, basis } }`

**CreatePqrsd**
```json
{ "text": "…(10–10 000 caracteres)", "channel": "web",
  "citizen": { "name": "Ana Pérez", "email": "ana@correo.co", "phone": "3001234567", "documentId": "52123456" },
  "anonymous": false, "consent": true }
```
`consent` debe ser `true` (tratamiento de datos, Ley 1581/2012). `anonymous = true` ignora `citizen` y la entidad no podrá responder por correo.
`channel`: `web | email | phone | in_person | social` (default `web`).

**Receipt** `{ "radicado": "PQRSD-2025-000123", "trackingCode": "K7M2QX", "receivedAt": "ISO", "type": {"id","label"}, "dependency": {"id","name"}, "dueDate": "YYYY-MM-DD", "legalDays": 15, "message": "<español>" }`

**Tracking (público)**: `{ radicado, status, statusLabel, type, dependency, urgency, receivedAt, dueDate, slaStatus, businessDaysLeft, timeline:[{at,event,label}], response: {text, answeredAt} | null }`. Nunca incluye texto original, ciudadano ni entidades.

**Transparency**: `{ generatedAt, includesDemo, totals:{received, answered, open, overdue}, onTimeRate, avgBusinessDaysToAnswer, byType:[{id,label,count}], byDependency:[{id,name,count,openCount,overdueCount}], weekly:[{weekStart,received,answered}], deadlines:[{type,subtype?,legalDays,basis}] }`.

### 4.2 Funcionario (`X-Staff-Key`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/staff/pqrsd` | Bandeja. Filtros: `status`, `type`, `dependency`, `urgency`, `sla`, `needsReview=true`, `q` (texto), `isDemo`; `sort=priority:desc` (default: `priorityScore` + 20 si está vencida + 8 si está en riesgo; las respondidas y cerradas van siempre al final) \| `dueDate:asc` \| `receivedAt:desc`; `limit` ≤ 200 (default 50), `offset` → `{items: PqrsdSummary[], total}` |
| GET  | `/staff/pqrsd/{id}` | `PqrsdDetail` (incluye texto, ciudadano, entidades, justificaciones de la IA y línea de tiempo) |
| POST | `/staff/pqrsd/{id}/confirm` | Acepta la clasificación de la IA → `assigned` (opcional `{note}`) |
| POST | `/staff/pqrsd/{id}/reclassify` | `{type?, subtype?, dependency?, urgency?, note?}` corrige y pasa a `assigned`; si cambia algo, envía retroalimentación a la IA y recalcula plazo |
| POST | `/staff/pqrsd/{id}/answer` | `{response: string(10–5000)}` → `answered` |
| POST | `/staff/pqrsd/{id}/close` | → `closed` (solo desde `answered`) |
| GET  | `/staff/stats` | KPIs de la bandeja (abajo) |
| GET  | `/staff/export.csv` | Exporta con los mismos filtros |
| POST | `/staff/import` | `{items:[{text, receivedAt?}], isDemo?}` ≤ 5 000 → `{imported, needsReview, durationMs}` (pruebas de volumen) |
| POST | `/staff/demo/seed` | `{count?: 1–500}` crea casos de demostración (`isDemo = true`) |
| DELETE | `/staff/demo` | Borra solo los `isDemo` |
| GET  | `/staff/ai/status` | Estado de la IA y de la retroalimentación |
| POST | `/staff/ai/retrain` | Reentrena la IA (proxy a `/v1/retrain`) → `AiStatus` |

**AiStatus** `{ available, modelVersion|null, model?:{syntheticSamples, feedbackSamples, trainedAt, note}, feedback?:{total, sinceLastTraining} }`.
**Límites**: `POST /pqrsd` y `POST /pqrsd/preview` admiten `PUBLIC_WRITE_LIMIT` (20) solicitudes por minuto por IP → 429 `TOO_MANY_REQUESTS`.

**Transiciones válidas**: `pending_review → assigned | answered`, `assigned → answered`, `answered → closed`.
`closed` es final. Cualquier otra → 409 `INVALID_TRANSITION`.

**PqrsdSummary**
```json
{ "id": "uuid", "radicado": "PQRSD-2025-000123", "receivedAt": "ISO", "excerpt": "primeros 160 caracteres",
  "status": "pending_review", "type": {"id","label"}, "dependency": {"id","name"}, "urgency": {"id","label"},
  "priorityScore": 72.4, "needsReview": true, "dueDate": "YYYY-MM-DD", "businessDaysLeft": 9, "slaStatus": "on_time",
  "source": "ai", "isDemo": false }
```
`type/dependency/urgency` son los **efectivos** (los corregidos por el funcionario si existen).
**PqrsdDetail** = `PqrsdSummary` + `text`, `channel`, `citizen|null`, `classification` (lo que dijo la IA: `type`, `dependency`, `urgency`, `subtype`, `entities`, `reviewReasons`, `modelVersion`, `source`), `effective` (`type`, `subtype`, `dependency`, `urgency`), `deadline` (`legalDays`, `basis`, `verify`, `dueDate`), `timeline:[{at,event,by,detail?}]`, `response|null`.

**Stats**: `{ totals:{all, open, pending_review, overdue, atRisk, needsReview}, byType, byDependency, byUrgency, avgPriority, avgBusinessDaysToAnswer, onTimeRate, aiAgreementRate, aiAvailable }`.
`aiAgreementRate` = proporción de casos revisados donde el funcionario **no** cambió tipo, dependencia ni urgencia (indicador de calidad real de la IA).

### 4.3 Plazos legales (Ley 1755 de 2015 y Ley 1437 de 2011)

| Caso | Días hábiles | Base |
|------|-------------|------|
| Petición general (`peticion/general`) | 15 | Art. 14 Ley 1437 (sustituido por Ley 1755/2015) |
| Información o documentos (`peticion/information`) | 10 | Art. 14 |
| Consulta (`peticion/consultation`) | 30 | Art. 14 |
| Queja, reclamo, sugerencia | 15 | Art. 14 (régimen general de peticiones) |
| Denuncia | 15 (configurable `DENUNCIA_DAYS`) y `verify = true` | Depende del procedimiento aplicable; verificar con el área jurídica |

El conteo empieza el **día hábil siguiente** a la radicación. Una radicación en sábado, domingo o festivo cuenta como recibida
el siguiente día hábil. Festivos de Colombia (Ley 51 de 1983): fijos, trasladados al lunes y los dependientes de la Semana Santa.
`slaStatus`: `overdue` si hoy > `dueDate`; `at_risk` si faltan ≤ 3 días hábiles; `done` si ya hay respuesta.
**Estos plazos son una configuración técnica de referencia, no asesoría jurídica**: la entidad debe validarlos.

### 4.4 Tiempo real (socket.io)

Namespace `/realtime`. Conexión de funcionario: `auth: { staffKey }` → entra a la sala `staff`. Sin clave → sala `public`.
Eventos servidor→cliente (sin datos personales):

| Evento | Sala | Payload |
|--------|------|---------|
| `pqrsd.created` | staff | `{id, radicado, type, dependency, urgency, priorityScore, needsReview}` |
| `pqrsd.updated` | staff | `{id, radicado, status, slaStatus}` |
| `stats.changed` | staff, public | `{at}` (señal para volver a pedir estadísticas) |

## 5. Frontend (`pqrsd-router-frontend`) — patrones de renderizado

| Ruta | Patrón | Por qué |
|------|--------|---------|
| `/` | **SSG** | Información estática (derechos, plazos, cómo radicar); carga instantánea y cacheable en CDN |
| `/radicar` | **CSR** | Formulario interactivo con vista previa de clasificación en vivo (debounce) |
| `/consulta` y `/consulta/[radicado]?code=` | **SSR** (`force-dynamic`) | Estado siempre fresco; el código de seguimiento nunca se cachea |
| `/transparencia` | **ISR** (`revalidate = 60`) | Datos públicos agregados que cambian poco; sirve desde caché y se regenera cada minuto |
| `/funcionario` | **CSR** + socket.io | Bandeja en vivo con filtros, semáforo SLA y panel de métricas |

Variables: `NEXT_PUBLIC_API_URL` (navegador), `API_URL_INTERNAL` (servidor Next → backend en Docker), `NEXT_PUBLIC_SOCKET_URL`.
La clave de funcionario se guarda solo en `sessionStorage` del navegador y se envía en `X-Staff-Key`.
