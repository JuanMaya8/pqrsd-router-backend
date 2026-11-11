# Despliegue: Render (backend + IA), Neon (PostgreSQL) y Vercel (frontend)

```
Vercel (Next.js)  ──HTTPS / WebSocket──▶  Render: pqrsd-router-backend  ──HTTPS + X-API-Key──▶  Render: pqrsd-router-ai
                                                   │                                                   │
                                                   └────────────────▶  Neon (PostgreSQL)  ◀────────────┘
                                                                  casos: pq_cases, pq_counters · correcciones: ai_feedback
```

Orden: **1. Neon → 2. Render (IA y backend) → 3. Vercel → 4. volver a Render a poner el dominio de Vercel.**
El frontend tiene su propia guía: `pqrsd-router-frontend/docs/DEPLOY.md`.

## 1. Neon (base de datos)
1. Neon → **New Project** (nombre p. ej. `pqrsd`, región `AWS US East` para estar cerca de Render Oregon/Ohio). Postgres 16 o 17 sirven.
2. **Connect** → copia la *connection string*. Se ve así:
   `postgresql://neondb_owner:XXXX@ep-algo-123456.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
   Sirve la directa o la *pooled* (`-pooler` en el host); recomendada: la **directa** (desactiva *Connection pooling* al copiarla).
3. No crees tablas: el backend aplica sus migraciones al arrancar y la IA crea `ai_feedback` sola. Las dos piezas usan **la misma** URL.

El backend activa TLS solo cuando la URL trae `sslmode=require` o el host es `*.neon.tech` (no hace falta `DATABASE_SSL`).
Neon suspende la base tras ~5 min sin uso; la primera consulta después tarda ~1 s más. El pool del backend descarta las conexiones
cortadas y la IA abre una conexión por operación, así que ninguna de las dos se queda con una conexión muerta.

## 2. Render (IA y backend)

### Opción A: Blueprint (crea los dos servicios de una vez)
1. **New → Blueprint** → repo `pqrsd-router-backend` → Render lee [`render.yaml`](../render.yaml).
2. Llena lo que pide (`sync: false`):

   | Variable | Servicio | Valor |
   |----------|----------|-------|
   | `DATABASE_URL` | IA **y** backend | La URL de Neon del paso 1 (la misma en los dos) |
   | `AI_URL` | backend | `https://pqrsd-router-ai.onrender.com` (la URL que Render le da a la IA; si el nombre está ocupado, cambia) |
   | `CORS_ORIGINS` | backend | `https://<tu-proyecto>.vercel.app` (provisional si aún no la tienes; varias separadas por coma) |
   | `PUBLIC_APP_URL` | backend | `https://<tu-proyecto>.vercel.app` (enlace de seguimiento en los correos) |
   | `SMTP_URL`, `MAIL_FROM` | backend | Opcionales (correos al ciudadano). Vacíos = no se envían |

3. **Apply**. `STAFF_API_KEY` y `AI_API_KEY` se generan solas (la IA y el backend comparten la misma `AI_API_KEY`).

### Opción B: a mano (como en otros proyectos)
Crea primero la IA, luego el backend.

**IA**: New → **Web Service** → repo `pqrsd-router-ai`
* Runtime **Python 3** · Build `pip install -r requirements.txt` · Start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
* Health check path `/health` · Plan Free
* Environment: `PYTHON_VERSION=3.12.7`, `DATABASE_URL=<URL de Neon>`, `AI_API_KEY=<inventa una clave larga>`, `BOOTSTRAP_SAMPLES=6000`

**Backend**: New → **Web Service** → repo `pqrsd-router-backend`
* Runtime **Node** · Build `npm ci --include=dev && npm run build` · Start `node dist/main.js`
* Health check path `/api/v1/health` · Plan Free
* Environment:

  | Variable | Valor |
  |----------|-------|
  | `NODE_VERSION` | `20.18.1` |
  | `NODE_ENV` | `production` |
  | `DATABASE_URL` | La URL de Neon (la misma de la IA) |
  | `AI_URL` | `https://pqrsd-router-ai.onrender.com` (URL de tu servicio de IA) |
  | `AI_API_KEY` | La misma clave que pusiste en la IA |
  | `AI_TIMEOUT_MS` | `10000` |
  | `STAFF_API_KEY` | Una clave larga para entrar a `/funcionario` |
  | `STAFF_USERS` | Opcional: `Ana Pérez:clave-de-ana,Luis Ruiz:clave-de-luis` (claves de 8+ caracteres; el nombre queda en el historial) |
  | `CORS_ORIGINS` | `https://<tu-proyecto>.vercel.app` |
  | `PUBLIC_APP_URL` | `https://<tu-proyecto>.vercel.app` |
  | `TRUST_PROXY` | `1` |

`--include=dev` es necesario: el CLI de Nest y TypeScript son devDependencies y con `NODE_ENV=production` npm no los instalaría.

### Comprobar
`https://pqrsd-router-backend.onrender.com/api/v1/health` → `"store":"postgres"` y `"ai":{"available":true,…}`.
Si dice `"available":false`, revisa `AI_URL` y que `AI_API_KEY` sea idéntica en los dos servicios (o espera: la IA tarda ~1 min en despertar).

## 3. Vercel
Sigue `pqrsd-router-frontend/docs/DEPLOY.md` (`NEXT_PUBLIC_API_URL=https://pqrsd-router-backend.onrender.com/api/v1`).

## 4. De vuelta en Render
1. Pon el dominio real de Vercel en `CORS_ORIGINS` y `PUBLIC_APP_URL` del backend (Environment → Save → se redepliega solo).
   Sin esto el navegador bloquea las llamadas (CORS) y el tiempo real no conecta.
2. Entra a `https://<tu-proyecto>.vercel.app/funcionario` con `STAFF_API_KEY` (o una clave de `STAFF_USERS`) → debe decir «En vivo».
   Para la presentación: «IA y datos de demostración» → **Crear 60 casos de demostración** (se borran con «Borrar demostración»).

## Qué esperar de los planes gratuitos
* **Render duerme los servicios** tras ~15 min sin tráfico; la primera petición tarda ~1 min. Mientras la IA despierta, el backend clasifica
  con el respaldo por palabras clave (marcado «Sin IA», *por confirmar*): **la radicación nunca se bloquea**. Antes de presentar, abre
  `/api/v1/health` del backend y `/health` de la IA un par de minutos antes para despertarlos.
* **El disco de Render se borra en cada despliegue**: por eso casos y correcciones viven en Neon; la IA reentrena al arrancar con el corpus
  sintético + las correcciones guardadas.
* **Neon gratis no vence** (a diferencia de la base gratuita de Render, que se borra a los 30 días). Límite: 0,5 GB, de sobra para el proyecto.
* Una sola instancia: el límite de tasa y socket.io son en memoria. Para varias réplicas hace falta Redis (ver AI_CONTEXT.md).

## Probar el despliegue
```bash
B=https://pqrsd-router-backend.onrender.com/api/v1
curl -s $B/health
curl -s -X POST $B/pqrsd/preview -H 'Content-Type: application/json' -d '{"text":"No llega el agua a mi barrio hace tres semanas."}'
curl -s $B/staff/me -H "X-Staff-Key: $STAFF_API_KEY"
```
