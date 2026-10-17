# Cloudflare Containers run linux/amd64 images:
#   docker build --platform linux/amd64 -t spotter-backend .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DJANGO_SETTINGS_MODULE=config.settings \
    PORT=8080

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
RUN useradd --create-home --uid 10001 app && chown -R app:app /app
USER app

EXPOSE 8080
# One worker on purpose: LocMemCache is per-process, so a single process shares one cache.
CMD ["sh", "-c", "exec uvicorn config.asgi:application --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers --forwarded-allow-ips='*' --no-access-log"]
