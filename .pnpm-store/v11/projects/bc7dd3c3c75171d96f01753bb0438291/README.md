# SCP frontend

React and TypeScript frontend for production planning, worker station execution, quality
control, and reporting.

Use npm for this directory; `package-lock.json` is the canonical frontend lockfile.

```bash
npm ci
npm run dev
npm run lint
npm run build
```

During development, Vite proxies `/api` and `/media_gallery` to
`http://localhost:2340`. Set `VITE_API_BASE_URL` only when the API is hosted elsewhere.

The production build is written to `ui/dist` and served by the FastAPI backend.
