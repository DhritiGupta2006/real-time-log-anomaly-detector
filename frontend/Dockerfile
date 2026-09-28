# API gateway + static dashboard (microservices mode). Build context = repo root.
FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend /usr/share/nginx/html
