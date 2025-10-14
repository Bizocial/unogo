# Deploy (pnpm + Vercel)

- **Generar lockfile local**
  - `corepack enable && corepack prepare pnpm@9.12.0 --activate`
  - `pnpm install`
  - Confirma que existe `pnpm-lock.yaml` en la raíz.

- **Vercel (monorepo en raíz)**
  - Archivo `vercel.json` en la raíz:
    - installCommand: `corepack enable && corepack prepare pnpm@9.12.0 --activate && pnpm install --frozen-lockfile`
    - buildCommand: `pnpm vercel-build`
    - ignoreCommand: `git diff --quiet HEAD^ HEAD .`
  - Root Directory: repo raíz (no `apps/web-gateway/`).
  - Build Command: dejar que tome `vercel.json`.

- **Alternativa**: Root Directory = `apps/web-gateway/`
  - Build Command por defecto (`next build`).
  - No necesitas `vercel.json`, pero perderás control del install.

- **Requerido para Next + workspaces**
  - `apps/web-gateway/next.config.ts` → `transpilePackages` con `@unogo/*` usados.
  - `apps/web-gateway/package.json` → declara deps `workspace:*` que importa (topics/shared/events/...).

- **Tailwind v4**
  - `apps/web-gateway/postcss.config.mjs`:
    ```js
    export default { plugins: { '@tailwindcss/postcss': {} } };
    ```
  - `app/globals.css` debe tener `@import "tailwindcss";`.

- **Comandos locales**
  - `pnpm --filter @unogo/web-gateway build`
  - `pnpm vercel-build` (desde raíz, usa filter)

- **Variables de entorno**
  - `REDIS_URL`, `OPENAI_API_KEY`, `WHATSAPP_PHONE_ID`, `META_APP_SECRET`, `LOG_LEVEL`.
  - `EMBED_MODEL`, `TOPIC_*`, y opcionales `STRICT_REPLY_WINDOW_MS`, `ACK_WHEN_LATENCY_MS`.
