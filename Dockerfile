FROM node:24-bookworm-slim
WORKDIR /app
ENV PORT=3000 STORE=sqlite SQLITE_PATH=/data/tracks.db

# Runtime deps (pg for STORE=postgres; the default sqlite path is
# zero-dependency via node:sqlite and never imports it).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.html style.css serve.js server.js ./
COPY lib/ lib/
COPY src/ src/
COPY assets/ assets/
COPY tools/gen-manifest.js tools/gen-manifest.js

# Bake the content-hash manifest (drives the client asset cache).
RUN node tools/gen-manifest.js

RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
