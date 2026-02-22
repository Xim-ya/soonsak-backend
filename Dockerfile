FROM node:22-slim

# Install yt-dlp, ffmpeg, and Deno (JavaScript runtime for yt-dlp)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    unzip \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set Deno in PATH
ENV PATH="/usr/local/bin:${PATH}"

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build
RUN npm run build

# Start
CMD ["npm", "run", "start:prod"]
