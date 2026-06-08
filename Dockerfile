# Node 24 = current LTS line ("Krypton", Active LTS since Oct 2025) and the
# package.json floor (engines: node >=24); pin the deploy runtime to the latest LTS.
FROM node:24-slim
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# The GLiNER ONNX weights must be present at build time (see README).
# They are copied in via `COPY . .` from the local model/ directory.

EXPOSE 8788
ENV PORT=8788
CMD ["node", "src/server.js"]
