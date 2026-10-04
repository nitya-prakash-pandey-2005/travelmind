# syntax=docker/dockerfile:1
# TravelMind API image: gunicorn + uvicorn workers. Also runs migrations (alembic) and the arq
# worker with a different command (see deploy/docker-compose.yml).

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0
WORKDIR /app
# Dependencies first, so code changes don't reinstall them.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable

# Same Python base as the uv image, without uv itself.
FROM python:3.12-slim-bookworm AS runtime
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
RUN groupadd --gid 10001 travelmind \
    && useradd --uid 10001 --gid travelmind --no-create-home --home-dir /app --shell /usr/sbin/nologin travelmind
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY alembic.ini gunicorn.conf.py ./
COPY migrations ./migrations
USER travelmind
EXPOSE 8000
CMD ["gunicorn", "travelmind.main:create_app()", "-k", "uvicorn_worker.UvicornWorker", "-c", "gunicorn.conf.py"]
