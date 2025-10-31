# BBY Promise & Capacity Orchestrator (MLP)

A lightweight single-page demo built with **Vite + React + Tailwind**. Fully synthetic data; no backends.
Includes agentic story mode, orchestrator controls, and an executive daily brief.

## Local dev
```bash
npm i
npm run dev
```

## Build
```bash
npm run build
# output: dist/
```

## Deploy to Cloudflare Pages (Free Tier)
1. Push this repo to GitHub.
2. In Cloudflare → Pages → **Create a project** → **Connect to Git**.
3. Select this repo.
4. Framework preset: **Vite** (or **None** and set the fields below).
5. Build command: **npm run build**
6. Build output directory: **dist**
7. (Optional) Environment variable: `NODE_VERSION=18`

That’s it. Every push to `main` will auto‑deploy a preview; `main` becomes production when you set it as such.

## Notes
- Tailwind is already configured (`tailwind.config.cjs`, `postcss.config.cjs`, `src/index.css`).
- The app lives in `src/App.tsx`. You can change synthetic nodes, carriers, or KPI math there.
- Icons: lucide-react. Charts: recharts. Animations: framer-motion.
