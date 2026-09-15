FROM node:24-bookworm-slim
WORKDIR /app
ENV PORT=3000

# The editor is a zero-dependency static app — no npm install required.
COPY package.json ./
COPY index.html serve.js ./
COPY src/ src/
COPY assets/ assets/
COPY tools/gen-manifest.js tools/gen-manifest.js

# Bake the content-hash manifest (drives the client asset cache).
RUN node tools/gen-manifest.js

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "serve.js"]
