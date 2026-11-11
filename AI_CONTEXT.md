# AI_CONTEXT.md — contexto para la IA generadora de código

> Léeme completo antes de tocar nada. Este repo es **2 de 3** del proyecto *pqrsd-router* (Clasificador y Enrutador
> Inteligente de PQRSD para Entidades Públicas). Idioma: **código, nombres de archivo, commits y pruebas en inglés;
> textos para el usuario (mensajes de error, etiquetas) en español**.

## 1. Objetivo del proyecto (caso de estudio original)
Hoy los funcionarios leen cada PQRSD una por una para decidir a qué dependencia pertenece y qué tan urgente es: hay cuellos
de botella y respuestas tardías, con incumplimiento de plazos legales. Propuesta: el ciudadano escribe en texto libre y el
sistema **clasifica al recibirla** por tipo (petición/queja/reclamo/sugerencia/denuncia), **dependencia competente** y **nivel de
urgencia**; para pruebas de volumen puede usarse un dataset público real (p. ej. issues de GitHub vía API, adaptado). IA: clasificación
de texto + extracción de entidades (fechas, lugares, nombres de trámites). Diferencial: resuelve un cuello de botella burocrático medible
y no necesita datos inventados.

## 2. Los 3 repos y el rol de ESTE repo
| Repo | Stack | Rol |
|------|-------|-----|
| `pqrsd-router-frontend` | Next.js 14 + TS | Portal ciudadano (SSG/CSR/SSR/ISR) y bandeja del funcionario en vivo |
| **`pqrsd-router-backend`** (este) | NestJS + TS | Radicación, plazos legales en días hábiles, SLA, flujo, estadísticas, tiempo real, proxy a la IA |
| `pqrsd-router-ai` | FastAPI + scikit-learn | Clasificación híbrida (modelo + reglas), entidades, retroalimentación y reentrenamiento |

Contrato exacto: `docs/CONTRACT.md` (idéntico en los 3 repos). **No lo rompas sin cambiarlo en los otros dos.**

## 3. Arquitectura de este repo
`src/domain/**` (sin Nest, sin decoradores) contiene todo el negocio; `src/modules` + `src/http` son cableado. Los objetos del dominio se
crean en `core.module.ts` y se inyectan por token (`TOKENS`). La validación es manual (`validation.ts`) y devuelve mensajes en español.

Invariantes que NO se deben romper:
* El dominio **no importa** `@nestjs/*` (se prueba con `tsx --test`, sin servidor).
* **Fechas de negocio = fechas civiles de America/Bogota** (`bogotaDate`). Nunca uses `toISOString().slice(0,10)` de un instante para decidir el día de radicación.
* Los plazos cuentan desde el **día hábil siguiente** a `receivedAt` y **siempre desde la fecha original** (reclasificar no la mueve). El «día 1» no es el día de radicación.
* **La IA nunca bloquea la radicación**: `ClassificationService` captura `AiUnavailableError` y usa `fallbackClassify` (siempre `needsReview`, dependencia = Atención al Ciudadano).
  Tras un fallo se omite la IA 20 s (cortacircuito) para no multiplicar timeouts.
* **Privacidad**: lo público (`tracking`, `transparency`, CSV, eventos socket) no lleva texto ni datos personales; `tracking` responde el **mismo 404** si el radicado no existe
  o el código es incorrecto. El feedback a la IA pasa por `redactPii` + `scrubCitizen`. No añadas campos a esas vistas sin revisar esto.
* Los casos `isDemo` **nunca** se envían a la IA como feedback.
* `PqrsdRepository.reserve(year, n)` reserva rangos del contador (archivos: escrituras serializadas; PostgreSQL: un UPSERT atómico); el contador nunca debe quedar por detrás de los radicados guardados.
* El dominio tampoco importa `pg` ni `nodemailer`: depende de `SqlClient` y `Notifier`; las implementaciones viven en `src/infra/` y se eligen en `app.factory.ts`.
* Migraciones: se **añaden** al final de `MIGRATIONS` (`pg-repository.ts`); nunca edites una ya aplicada. `migrate()` necesita **una** conexión (no el pool).
* **Ampliación del plazo** (Art. 14 parágrafo): una sola vez, antes del vencimiento, `days ≤ legalDays`; reclasificar la conserva acotada al nuevo término.
  El tracking público muestra que se amplió, **nunca** el motivo ni el responsable. Los correos nunca salen para casos `isDemo` y un fallo de SMTP no rompe la petición.
* `STAFF_API_KEY` es obligatoria con `NODE_ENV=production` (`main.ts` se niega a arrancar sin ella) y protege **también las lecturas** de `/staff/*`.

## 4. Cómo ejecutar y probar
```bash
npm install
npm test                     # 61 pruebas del dominio (tsx --test; 3 necesitan TEST_DATABASE_URL)
npm run typecheck
npm run test:http            # Nest real + supertest + socket.io-client contra una IA falsa (10 pruebas; 1 con PostgreSQL)
npm run start:dev            # :3001, Swagger en /docs
```
Los tests usan `FakeAi` (`test/helpers.ts`) y `FakeClock` (T0 = miércoles 2025-03-05 10:00 Bogotá). `test/contract.test.ts` usa
`test/fixtures/ai-responses.json`, generado ejecutando el servicio Python real: **regenerarlo si cambia la respuesta de la IA**.

## 5. Estado exacto (hasta dónde llegué)
**Hecho y VERIFICADO** (sandbox: Node 22, `tsx --test test/*.test.ts` → 51 tests OK; `tsc --noEmit` limpio salvo por módulos Nest no instalables):
* Calendario colombiano (festivos 2025/2026 contrastados), días hábiles, plazos por tipo/subtipo, SLA en riesgo/vencido/hecho.
* Radicación, tracking público, flujo de estados (409 en transiciones inválidas), reclasificación con feedback anonimizado, estadísticas (`aiAgreementRate`, on-time, promedio de días),
  transparencia sin datos personales, CSV con guarda de inyección de fórmulas, importación por lotes de 200 con degradación a mitad, demostración determinista, límite de tasa.
* Persistencia en disco, recuperación tras reinicio, contador resistente a archivos corruptos.
* Contrato con la IA verificado con salida **real** de `pqrsd-router-ai`.
* Contrato con el frontend: las respuestas del servicio (`preview`, `create`, `tracking`, `transparency`, `taxonomy`, `list`, `get`, `stats`, `aiStatus`, `seedDemo`) son asignables a los tipos de `pqrsd-router-frontend` (comprobación estática),
  y el frontend recorrió todo el flujo contra este dominio servido por un adaptador HTTP temporal (no incluido). Eso destapó que las solicitudes ya respondidas/cerradas quedaban arriba de la bandeja: ahora `rankScore` las manda al final (prueba incluida).

**Verificado al retomar (2026-11-11, Windows, Node 22, NestJS 10 real):**
* `npm run typecheck` limpio, `npm test` 51/51, `npm run test:http` 8/8, `npm run build` OK.
* Corregido: `OnModuleDestroy` venía de `@nestjs/websockets` (no existe ahí) → `@nestjs/common`.
* Corregido: JSON mal formado devolvía `HTTP_400`; Nest (`RoutesResolver.mapExternalException`) convierte el `SyntaxError` de body-parser en `BadRequestException`
  antes de llegar al filtro, así que `exceptions.filter.ts` lo reconoce por el mensaje.
* Los riesgos señalados (`ThrottlerGuard` global + gateway, `Namespace` en `@WebSocketServer()`, `trust proxy`) funcionaron sin cambios.
* Integración real: backend compilado + `pqrsd-router-ai` (uvicorn) + frontend `next start`: CORS con `X-Staff-Key`, socket con `auth.staffKey` («En vivo»), evento `pqrsd.created`
  que actualiza la bandeja, feedback que llega a la IA y `POST /staff/ai/retrain`. `docker compose up --build` con los 3 repos.
* `package-lock.json` versionado (la CI usa `npm ci`).
* Sin ejecutar: `scripts/import-github-issues.mjs` contra GitHub.

**No hecho:**
**Añadido y verificado (2026-11-11):**
* `PgPqrsdRepository` + migraciones (`DATABASE_URL`, `DATABASE_SSL`); pruebas contra PostgreSQL 16 real (`TEST_DATABASE_URL`), incluida la concurrencia de `reserve` y el arranque de Nest dos veces sobre la misma base.
* `assign` (responsable, texto libre) y `extend` (ampliación del plazo); `Notifier` + `SmtpNotifier` (`SMTP_URL`, `MAIL_FROM`, `PUBLIC_APP_URL`).
* `render.yaml` + `docs/DEPLOY.md`. Se simuló el build de Render (`npm ci --include=dev && npm run build`) y se probó la pila en Docker con PostgreSQL (`e2e:fullstack` 12/12).
* Sin probar: el envío real por un servidor SMTP (las pruebas usan `MemoryNotifier`) y el despliegue real en Render.

**No hecho:**
* Filtros y paginación en SQL: `all()` sigue cargando todos los casos (también en PostgreSQL).
* Autenticación por usuario y roles (jefe de dependencia, ciudadano con cuenta); hoy hay una clave compartida y el responsable es texto libre.
* SMS; traslado por competencia (Art. 21); recordatorios automáticos antes de vencer.
* Auditoría inmutable, adjuntos, multi-entidad, paginación por cursor, métricas Prometheus, Redis para socket.io y límites de tasa con varias réplicas.
* Validar con el área jurídica de la entidad la tabla de plazos (`deadlines.ts`), sobre todo denuncias.

## 6. Checklist para llegar al 100 % (en orden)
1. ~~Ejecutar y arreglar la capa Nest (`test:http`, `build`, `docker build`).~~ ✅
2. ~~Integración real con `pqrsd-router-ai` (levantar ambos con `docker compose`, radicar, corregir, `POST /staff/ai/retrain`).~~ ✅
3. ~~Integración con `pqrsd-router-frontend` (CORS, `X-Staff-Key`, socket con `auth.staffKey`).~~ ✅
4. PostgreSQL + migraciones; mover `FileBlobStore` a desarrollo.
5. Usuarios y roles; notificaciones; asignación a funcionarios; prórrogas.
6. Medir con PQRSD reales etiquetadas (`aiAgreementRate` es el termómetro), ajustar `AUTO_ASSIGN_MIN_CONFIDENCE` solo después de medir.
7. Observabilidad, backups, despliegue.
