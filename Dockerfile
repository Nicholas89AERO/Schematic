# Stage 1: build React app
FROM node:20-slim AS frontend
WORKDIR /app
COPY schematic-ai/frontend/package.json schematic-ai/frontend/package-lock.json ./
RUN npm ci
COPY schematic-ai/frontend/ .
RUN npm run build

# Stage 2: Python backend + static assets
FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2-dev libpango1.0-dev libgdk-pixbuf-2.0-dev \
    && rm -rf /var/lib/apt/lists/*

COPY schematic-ai/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY schematic-ai/backend/ .
COPY --from=frontend /app/dist ./static

CMD ["sh", "-c", "uvicorn main:app --host :: --port ${PORT:-8080}"]
