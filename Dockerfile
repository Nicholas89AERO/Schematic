FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2-dev libpango1.0-dev libgdk-pixbuf2.0-dev \
    libcairo2 libpango-1.0-0 libgdk-pixbuf2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY schematic-ai/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY schematic-ai/backend/ .

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
