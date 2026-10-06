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
* `PqrsdRepository.reserve(year, n)` reserva rangos del contador con escrituras serializadas; el contador nunca debe quedar por detrás de los radicados en disco.
* `STAFF_API_KEY` es obligatoria con `NODE_ENV=production` (`main.ts` se niega a arrancar sin ella) y protege **también las lecturas** de `/staff/*`.

## 4. Cómo ejecutar y probar
```bash
npm install
npm test                     # 51 pruebas del dominio (tsx --test)
npm run typecheck
npm run test:http            # Nest real + supertest + socket.io-client contra una IA falsa (NUNCA EJECUTADO, ver abajo)
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

**Escrito pero NO ejecutado** (en el sandbox no se podía instalar NestJS: npm bloqueado):
* `src/app*.ts`, `src/core.module.ts`, `src/main.ts`, `src/http/*`, `src/modules/*` (controladores, guardas, gateway), `test/http/app.e2e.test.ts`, `Dockerfile`, `docker-compose.yml`, CI,
  `scripts/import-github-issues.mjs`. Se comprobaron los tipos propios con `tsc` contra declaraciones simuladas de Nest.
→ **Primera tarea al retomar:** `npm install && npm run typecheck && npm test && npm run test:http && npm run build` y arreglar lo que falle. Puntos de riesgo conocidos:
  `ThrottlerGuard` global + gateway; `@WebSocketServer()` devuelve un `Namespace` (no `Server`) en un gateway con namespace; `app.set('trust proxy', …)`;
  Swagger sin metadatos de decoradores bajo `tsx` (por eso `swagger:false` en e2e).

**No hecho:**
* **PostgreSQL**: implementar `PqrsdRepository` (reserve/insert/insertMany/update/get/findByRadicado/all/removeWhere) con una secuencia por año y búsqueda indexada; `all()` carga todo en memoria hoy.
* Autenticación por usuario y roles (jefe de dependencia, ciudadano con cuenta); hoy hay una clave compartida.
* Notificaciones por correo/SMS al ciudadano (hay `citizen.email` pero nada lo usa).
* Asignación a un funcionario concreto, traslado por competencia, prórroga del término (Art. 14 parágrafo), recordatorios antes de vencer.
* Auditoría inmutable, adjuntos, multi-entidad, paginación por cursor, métricas Prometheus, Redis para socket.io y límites de tasa con varias réplicas.
* Validar con el área jurídica de la entidad la tabla de plazos (`deadlines.ts`), sobre todo denuncias.

## 6. Checklist para llegar al 100 % (en orden)
1. Ejecutar y arreglar la capa Nest (`test:http`, `build`, `docker build`).
2. Integración real con `pqrsd-router-ai` (levantar ambos con `docker compose`, radicar, corregir, `POST /staff/ai/retrain`).
3. Integración con `pqrsd-router-frontend` (CORS, `X-Staff-Key`, socket con `auth.staffKey`).
4. PostgreSQL + migraciones; mover `FileBlobStore` a desarrollo.
5. Usuarios y roles; notificaciones; asignación a funcionarios; prórrogas.
6. Medir con PQRSD reales etiquetadas (`aiAgreementRate` es el termómetro), ajustar `AUTO_ASSIGN_MIN_CONFIDENCE` solo después de medir.
7. Observabilidad, backups, despliegue.
