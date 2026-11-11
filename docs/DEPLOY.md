# Despliegue: Render (backend + IA + PostgreSQL) y Vercel (frontend)

```
Vercel (Next.js)  ──HTTPS / WebSocket──▶  Render: pqrsd-router-backend  ──HTTPS + X-API-Key──▶  Render: pqrsd-router-ai
                                                   │                                                   │
                                                   └──────────────▶  Render PostgreSQL  ◀──────────────┘
                                                                     (casos: pq_cases · correcciones: ai_feedback)
```

El blueprint [`render.yaml`](../render.yaml) crea los tres recursos de Render. El frontend va a Vercel
(ver `pqrsd-router-frontend/docs/DEPLOY.md`).

## 1. Requisitos
* Los tres repos en GitHub (`pqrsd-router-ai`, `pqrsd-router-backend`, `pqrsd-router-frontend`) y cuentas en Render y Vercel.
* Si tus repos no están en `github.com/JuanMaya8/...`, cambia los campos `repo:` de `render.yaml`.

## 2. Render (en este orden)
1. **New → Blueprint** → elige el repo `pqrsd-router-backend` → Render lee `render.yaml`.
2. Llena las variables que pide (`sync: false`). Si aún no tienes la URL de Vercel, pon un valor provisional y cámbialo en el paso 4:

   | Variable | Valor |
   |----------|-------|
   | `AI_URL` | `https://pqrsd-router-ai.onrender.com` (la URL pública que Render le asigna a la IA) |
   | `CORS_ORIGINS` | `https://<tu-proyecto>.vercel.app` (varias separadas por coma) |
   | `PUBLIC_APP_URL` | `https://<tu-proyecto>.vercel.app` (enlace de seguimiento en los correos) |
   | `SMTP_URL` | opcional, p. ej. `smtps://usuario:clave-de-aplicacion@smtp.gmail.com:465`; vacío = no se envían correos |
   | `MAIL_FROM` | opcional, p. ej. `PQRSD Alcaldía <pqrsd@tu-dominio.gov.co>` |

3. **Apply**. Render crea la base de datos, la IA (entrena el modelo al arrancar, ~15 s) y el backend (aplica las migraciones de PostgreSQL al arrancar).
   Comprueba: `https://pqrsd-router-backend.onrender.com/api/v1/health` → `"store":"postgres"` y `"ai":{"available":true,…}`.
4. Cuando tengas el dominio de Vercel, actualiza `CORS_ORIGINS` y `PUBLIC_APP_URL` del backend (Environment → Save → se redepliega solo).
5. La clave de funcionario es `STAFF_API_KEY` del backend (Render la genera): cópiala de *Environment* y escríbela en `/funcionario`.

Generadas automáticamente: `STAFF_API_KEY`, `AI_API_KEY` (la misma en la IA y en el backend), `DATABASE_URL` (URL interna de Render, sin TLS).

## 3. Qué esperar del plan gratuito
* **Los servicios se duermen** tras ~15 min sin tráfico; la primera petición tarda ~1 min. Mientras la IA despierta, el backend clasifica con el
  respaldo por palabras clave (`source: "fallback"`, siempre marcado *por confirmar*): **la radicación nunca se bloquea**.
* **El disco se borra en cada despliegue**: por eso los casos y las correcciones viven en PostgreSQL; la IA vuelve a entrenar al arrancar
  con el corpus sintético + las correcciones guardadas.
* **La base gratuita de Render vence a los 30 días**: pasa a un plan pago o usa otra base (Neon, Supabase) cambiando `DATABASE_URL`
  en los dos servicios y `DATABASE_SSL=true` en el backend si la conexión es externa.
* Una sola instancia: el límite de tasa y socket.io son en memoria. Para varias réplicas hace falta Redis (ver AI_CONTEXT.md).

## 4. Sin blueprint (manual)
* **PostgreSQL**: New → PostgreSQL. Copia la *Internal Database URL*.
* **IA**: New → Web Service → repo `pqrsd-router-ai` · Runtime Python · Build `pip install -r requirements.txt` ·
  Start `uvicorn app.main:app --host 0.0.0.0 --port $PORT` · Health check `/health` · Env: `PYTHON_VERSION=3.12.7`, `AI_API_KEY`, `DATABASE_URL`.
* **Backend**: New → Web Service → repo `pqrsd-router-backend` · Runtime Node · Build `npm ci --include=dev && npm run build` ·
  Start `node dist/main.js` · Health check `/api/v1/health` · Env: las de `render.yaml`.
* También puedes usar los `Dockerfile` de cada repo (Runtime Docker); Render inyecta `PORT`.

## 5. Probar el despliegue
```bash
B=https://pqrsd-router-backend.onrender.com/api/v1
curl -s $B/health
curl -s -X POST $B/pqrsd/preview -H 'Content-Type: application/json' -d '{"text":"No llega el agua a mi barrio hace tres semanas."}'
curl -s $B/staff/stats -H "X-Staff-Key: $STAFF_API_KEY"
# desde pqrsd-router-frontend, contra el sitio publicado:
E2E_BASE_URL=https://<tu-proyecto>.vercel.app E2E_STAFF_KEY=$STAFF_API_KEY npm run e2e:fullstack   # crea casos reales: bórralos o usa una base de prueba
```
