# LLM Salon Frontend

Static web UI for LLM Salon.

## Run locally

From this directory:

```bash
python -m http.server 8000
```

Then open `http://127.0.0.1:8000/ui/`.

## API

The UI expects backend API routes under `/api/...`. If you host the frontend separately,
add a reverse proxy or update the fetch URLs in `ui/index.html`.

