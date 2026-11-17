# Telegram account gateway (CONCEPT.md §8.2). One container per account, see deploy/docker-compose.yml.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STATE_DIR=/state

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.txt
COPY stream_gateway ./stream_gateway

ENTRYPOINT ["python", "-m", "stream_gateway"]
