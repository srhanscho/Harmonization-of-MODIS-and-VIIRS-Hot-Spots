# Web app

Next.js (App Router) + TypeScript + Tailwind + shadcn/ui, MapLibre GL (globe), ECharts.
Reads the static data contract from `public/data/` (written by the pipeline, see `../docs/PROJECT_SPEC.md` §5).

```bash
npm install
npm run dev                                 # real data from public/data/
NEXT_PUBLIC_USE_FIXTURE=1 npm run dev       # dev-only synthetic fixture (red "SIMULATED DATA" banner)
npm run build && npm run lint
```

- Missing data files show an explicit "Data not generated yet — run the pipeline" state.
- The fixture (`fixtures/synthetic.ts`) is excluded from production builds.
- `predev`/`prebuild` copy the MapLibre v6 worker to `public/vendor/` (gitignored).
- AI assistant: `src/app/api/assistant/route.ts`. Set `ANTHROPIC_API_KEY` (server-side only) and optionally `ANTHROPIC_MODEL` (see `.env.example`). Without a key the UI shows the assistant as unavailable.
- Expected data files: `regions.json`, `meta.json`, `validation.json`, `monthly/{id}.json`, `climatology/{id}.json`, `cells/{id}/{year}.json`.
