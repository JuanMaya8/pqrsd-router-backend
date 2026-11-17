# PQRSD Inteligente · Backend

API del proyecto *Clasificador y Enrutador Inteligente de PQRSD para Entidades Públicas*. Es el centro del sistema: **radica** cada
solicitud, la **clasifica al recibirla** (con el servicio de IA), calcula el **plazo legal en días hábiles colombianos**, controla el
**semáforo de vencimiento**, gobierna el **flujo de estados**, publica **indicadores** y avisa en **tiempo real** a la bandeja de funcionarios.

| Repositorio | Rol |
|---|---|
| [`pqrsd-router-frontend`](https://github.com/JuanMaya8/pqrsd-router-frontend) | Portal ciudadano y bandeja de funcionarios (Next.js) |
| **`pqrsd-router-backend`** (este) | Radicación, plazos legales, flujo y tiempo real (NestJS) |
| [`pqrsd-router-ai`](https://github.com/JuanMaya8/pqrsd-router-ai) | Clasificación híbrida, entidades y aprendizaje continuo (FastAPI + scikit-learn) |

> Guía de demostración (levantar todo con una orden, claves de prueba y recorrido de 10 minutos):
> [`pqrsd-router-frontend/docs/GUIA_DEMO.md`](https://github.com/JuanMaya8/pqrsd-router-frontend/blob/main/docs/GUIA_DEMO.md)

---

## Funcionalidades

**Para el ciudadano**
* **Radicación** con número único (`PQRSD-2026-000123`) y **código de seguimiento**; también anónima.
* **Vista previa** de la clasificación mientras escribe.
* **Consulta del estado** con radicado + código, sin datos personales.
* **Transparencia**: indicadores públicos agregados.
* **Correos** de radicación, ampliación y respuesta (si hay SMTP configurado).

**Para el funcionario** (rutas `/staff/*`, protegidas con clave)
* Bandeja con filtros, búsqueda, orden por prioridad y paginación.
* Confirmar o **corregir la clasificación** de la IA (la corrección se envía anonimizada para que aprenda).
* **Asignar responsable**, **ampliar el plazo** (una vez, Art. 14 parágrafo), **trasladar por competencia** (Art. 21), responder y cerrar.
* Cuentas con nombre: cada acción queda en el historial con su autor.
* Indicadores, exportación CSV sin datos personales, reentrenamiento de la IA y datos de demostración.
* Eventos en vivo por **Socket.IO** cuando entra o cambia una solicitud.

## Reglas de negocio clave

* **Plazos legales como código** (Ley 1755 de 2015):

  | Tipo | Plazo |
  |---|---|
  | Petición general, queja, reclamo, sugerencia | 15 días hábiles |
  | Solicitud de información o documentos | 10 días hábiles |
  | Consulta | 30 días hábiles |
  | Denuncia | Configurable (validar con el área jurídica) |

  El término cuenta desde el **día hábil siguiente** a la radicación, con el **calendario de festivos de Colombia** (fijos, trasladados al
  lunes y Semana Santa), en hora de Bogotá. Reclasificar no reinicia el plazo.
* **Semáforo**: *en términos* → *en riesgo* (queda el 20 % del plazo, mínimo 3 días) → *vencida*; *respondida* al cerrar.
* **Flujo de estados**: `por revisar → asignada → respondida → cerrada`; las transiciones inválidas responden 409.
* **Prioridad de la bandeja**: puntaje de la IA + 20 si está vencida + 8 si está en riesgo; lo ya respondido va al final.
* **La IA nunca bloquea al ciudadano**: si no responde, se usa un clasificador de respaldo por palabras clave, la solicitud queda marcada
  para revisión y la IA se omite 20 s para no acumular esperas.
* **Privacidad**: la consulta pública devuelve el mismo error si el radicado no existe o el código es incorrecto; transparencia, CSV y
  eventos en vivo no llevan texto ni datos personales; el responsable y el motivo de una ampliación nunca salen en vistas públicas.

## Arquitectura

```
src/
├── domain/        Todo el negocio, sin dependencia de NestJS
│   ├── calendar.ts · deadlines.ts       Festivos, días hábiles, plazos legales y semáforo
│   ├── workflow.ts                      Flujo de estados
│   ├── pqrsd-service.ts                 Casos de uso (radicar, consultar, corregir, asignar, ampliar, trasladar, responder…)
│   ├── classification-service.ts        IA con respaldo automático
│   ├── repository.ts · pg-repository.ts Persistencia (archivos en desarrollo, PostgreSQL en producción)
│   └── stats.ts · summary.ts · csv.ts · validation.ts · staff-users.ts …
├── infra/         Correo SMTP y cliente PostgreSQL
├── http/          Guarda de funcionarios, límites de tasa, errores, DTOs de Swagger
└── modules/       Controladores REST y gateway Socket.IO
test/              Pruebas del dominio y pruebas HTTP/WebSocket
```

**Capas:** controladores → `PqrsdService` → repositorio / IA / eventos. El dominio no importa NestJS, así que se prueba sin levantar servidor.

## API principal (`/api/v1`)

| Método | Ruta | Acceso |
|---|---|---|
| `POST` | `/pqrsd/preview` · `/pqrsd` | Público: vista previa y radicación |
| `GET` | `/public/tracking/:radicado?code=` · `/public/transparency` | Público: consulta y transparencia |
| `GET` | `/staff/pqrsd` · `/staff/pqrsd/:id` · `/staff/stats` · `/staff/export.csv` | Funcionario |
| `POST` | `/staff/pqrsd/:id/{confirm, reclassify, assign, extend, transfer, answer, close}` | Funcionario |
| `GET`/`POST` | `/staff/ai/status` · `/staff/ai/retrain` · `/staff/demo/seed` | Funcionario |

Documentación interactiva (Swagger) en `/docs`. Contrato completo entre los 3 repositorios: [`docs/CONTRACT.md`](docs/CONTRACT.md).

## Ejecutar en local

Requisitos: **Node 18.18+**. Para clasificar con IA, `pqrsd-router-ai` en `:8000` (sin ella funciona con el respaldo).

```bash
npm install
cp .env.example .env
npm run start:dev          # http://localhost:3001/api/v1 · Swagger: http://localhost:3001/docs
```

Pruebas:

```bash
npm run typecheck
npm test                   # dominio: calendario, plazos, flujo, servicio, repositorio, contrato con la IA
npm run test:http          # NestJS real + HTTP + Socket.IO
```

Todo el sistema (frontend + backend + IA + PostgreSQL) con Docker, desde el repo del frontend: `docker compose up --build`.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `STAFF_USERS` / `STAFF_API_KEY` | Cuentas de funcionarios (`Nombre:clave,…`) o una clave compartida. Obligatorio en producción |
| `AI_URL`, `AI_API_KEY`, `AI_TIMEOUT_MS` | Conexión con el servicio de IA |
| `DATABASE_URL`, `DATABASE_SSL` | PostgreSQL (migraciones automáticas al arrancar) |
| `CORS_ORIGINS` | Dominio(s) del frontend |
| `SMTP_URL`, `MAIL_FROM`, `PUBLIC_APP_URL` | Correos al ciudadano y enlace de seguimiento |
| `DENUNCIA_DAYS` | Plazo de las denuncias en días hábiles |
| `PUBLIC_WRITE_LIMIT`, `THROTTLE_LIMIT`, `TRUST_PROXY` | Límites por IP y proxy |

## Despliegue

Desplegado en **Render** (backend + IA, blueprint [`render.yaml`](render.yaml)) con **Neon** como PostgreSQL y el frontend en **Vercel**.
Paso a paso en [`docs/DEPLOY.md`](docs/DEPLOY.md). El `Dockerfile` sirve para cualquier otro proveedor.

## Datos de prueba de volumen

`scripts/import-github-issues.mjs` importa issues públicos de GitHub como casos de demostración para medir rendimiento con miles de
registros (son de prueba de volumen, no de precisión).

## Limitaciones y trabajo futuro

* Roles y permisos por dependencia (hoy todas las cuentas tienen los mismos permisos).
* Llevar filtros y paginación a SQL para bandejas muy grandes.
* Adjuntos, SMS y recordatorios automáticos antes del vencimiento.
* Redis para escalar Socket.IO y los límites de tasa a varias réplicas.
* Validar la tabla de plazos con el área jurídica de la entidad.
