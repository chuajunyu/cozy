FROM node:22-bookworm-slim AS frontend-deps
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

FROM python:3.11-slim-bookworm AS python-deps
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000
WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Download and validate the recorded model assets before building the frontend.
# Keep curl and asset preparation tooling out of the final image.
FROM python-deps AS assets
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY backend/ ./backend/
COPY scripts/ ./scripts/
COPY data/ ./data/
COPY --from=frontend-deps /build/frontend/node_modules/three/examples/jsm/libs/draco/gltf ./frontend/node_modules/three/examples/jsm/libs/draco/gltf
RUN python -m scripts.prepare_assets

FROM frontend-deps AS frontend
COPY frontend/ ./
COPY data/bulb-profiles.json /build/data/bulb-profiles.json
COPY --from=assets /app/frontend/public ./public
RUN npm run build

# One service runs FastAPI and serves React, GLBs and Draco on the same origin.
FROM python-deps AS runtime
COPY backend/ ./backend/
COPY data/ ./data/
COPY --from=frontend /build/frontend/dist ./frontend/dist
RUN ln -s dist ./frontend/public \
    && useradd --create-home --uid 10001 cozy
USER cozy
EXPOSE 10000
CMD ["sh", "-c", "exec python -m uvicorn backend.main:app --host 0.0.0.0 --port \"${PORT:-10000}\" --workers 1"]
