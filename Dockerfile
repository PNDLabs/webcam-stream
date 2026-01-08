FROM node:20-slim

# Install FFmpeg and timezone data
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg tzdata && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY src/ ./src/
COPY public/ ./public/
COPY config.json ./

# Create recordings directory
RUN mkdir -p /app/recordings

# Expose port
EXPOSE 8081

# Start the application
CMD ["node", "src/index.js"]
