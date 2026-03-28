# Stage 1: Build
FROM node:22-slim AS builder

WORKDIR /app

# Install Python for agent
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/*

# Create Python virtual environment and install dependencies
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Node.js dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY . .

# Build the server
RUN npm run server:build

# Stage 2: Production
FROM node:22-slim

WORKDIR /app

# Install Python runtime for agent
RUN apt-get update && apt-get install -y python3 python3-venv && rm -rf /var/lib/apt/lists/*

# Copy Python virtual environment from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy built server
COPY --from=builder /app/server_dist ./server_dist

# Copy necessary runtime files
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server/g4f_chat.py ./server/g4f_chat.py
COPY --from=builder /app/server/agent ./server/agent
COPY --from=builder /app/server/templates ./server/templates
COPY --from=builder /app/app.json ./app.json
COPY --from=builder /app/assets ./assets

# Copy static build if it exists (for production with pre-built Expo assets)
COPY --from=builder /app/static-build ./static-build

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

CMD ["node", "server_dist/index.js"]
