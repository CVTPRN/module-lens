FROM python:3.12-slim
WORKDIR /app
COPY app.py ./
COPY web ./web
RUN useradd --uid 10001 --create-home modulelens
USER 10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/registry/health',timeout=4)"
CMD ["python", "app.py", "--host", "0.0.0.0", "--port", "8080"]
