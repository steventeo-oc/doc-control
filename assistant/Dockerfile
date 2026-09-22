# Document-control assistant ("Ask"). Started only by the compose profile `assistant`; see docker-compose.yml.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
# The stand-in model servers for machines without a GPU (compose profile `mock-models`, smoke section 16).
COPY tools ./tools

# The SQLite file (index, query log, sync history) lives in /data: mount a named volume there.
RUN useradd --system --uid 10001 assistant && mkdir /data && chown assistant /data
USER assistant
VOLUME /data
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/assistant/health', timeout=3)"

CMD ["uvicorn", "app.main:create", "--factory", "--host", "0.0.0.0", "--port", "8000"]
