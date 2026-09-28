# One image, several entrypoints: the monolith and each microservice run the same code
# with a different command (see docker-compose.yml).
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY shared shared
COPY services services
COPY api api
COPY simulator simulator
COPY frontend frontend
RUN useradd --create-home app && mkdir -p logs && chown -R app:app /app/logs
USER app
EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
