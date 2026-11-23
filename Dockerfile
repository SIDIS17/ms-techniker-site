# Site + API MS Techniker — aucune dépendance npm
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 DB_PATH=/data/mstechniker.db SITE_ROOT=/app
WORKDIR /app
COPY index.html README.md ./
COPY img ./img
COPY backend ./backend
COPY api ./api
COPY admin ./admin
RUN rm -rf backend/test backend/data && mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/sante || exit 1
CMD ["node", "--no-warnings", "backend/server.js"]
