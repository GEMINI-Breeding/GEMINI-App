# Docker Runtime Configuration Flow

This document explains how environment variables are handled in the Docker container and how the React app accesses runtime configuration.

## Process Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Docker Container Starts                                      │
│    docker-compose up                                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│ 2. docker-entrypoint.sh Executes                                │
│    /docker-entrypoint.sh runs automatically                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│ 3. Read Environment Variables                                   │
│    - From mounted .env file: ./gemini-app/.env                  │
│    - From docker-compose environment: section                   │
│    Example: REACT_APP_FLASK_PORT=5000                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│ 4. Generate build/config.js (For Browser)                       │
│    generate-runtime-config.sh creates:                          │
│    window.RUNTIME_CONFIG = {                                    │
│        FLASK_PORT: '5000',                                      │
│        TILE_SERVER_PORT: '8091'                                 │
│    }                                                            │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│ 5. Serve React App                                              │
│    serve -s build -l 3000                                       │
│    Static files served on configured port                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│ 6. Browser Loads index.html                                     │
│    User accesses http://localhost:3000                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│ 7. Load config.js in Browser                                    │
│    <script src="/config.js"></script>                           │
│    Sets window.RUNTIME_CONFIG                                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│ 8. React App Uses Runtime Config                                │
│    const port = window.RUNTIME_CONFIG.FLASK_PORT                │
│    API calls use dynamic port configuration                     │
└─────────────────────────────────────────────────────────────────┘
```

## Why This Approach?

### Problem
- React apps are **static JavaScript bundles** after build
- `process.env.REACT_APP_*` values are **hardcoded** during `npm run build`
- Browsers **cannot read .env files** directly
- Changing ports requires rebuilding the entire app

### Solution
- Generate `config.js` at **runtime** (when container starts)
- Browser loads `config.js` as a separate JavaScript file
- React app reads from `window.RUNTIME_CONFIG` (runtime values)
- **No rebuild needed** - just restart the container

## File Purposes

| File | Used By | Purpose |
|------|---------|---------|
| `.env` (mounted) | Node.js processes (server-side) | Server-side configuration |
| `config.js` (generated) | Browser (client-side) | Client-side runtime configuration |

### Why Both Are Needed

- **`.env` file mounting**: For server-side code (Flask, npm scripts)
  - ✅ `serve` command reads port
  - ✅ `run_flask_server.sh` reads configuration
  
- **`config.js` generation**: For browser-side code (React app)
  - ✅ Browser can load JavaScript files
  - ✅ `window.RUNTIME_CONFIG` accessible at runtime
  - ✅ No rebuild needed to change configuration

## Configuration Priority

```
Docker Container Environment
       │
       ├─→ Server-side processes use .env
       │   └─→ Flask server, npm scripts
       │
       └─→ Entrypoint generates config.js
           └─→ Browser loads config.js
               └─→ React app uses window.RUNTIME_CONFIG
```

## Changing Configuration

### Without Rebuild (Recommended)
```bash
# 1. Edit .env file
nano gemini-app/.env

# 2. Restart container
docker-compose restart

# The entrypoint regenerates config.js with new values
```

### With Rebuild (Full)
```bash
# 1. Edit .env file
nano gemini-app/.env

# 2. Rebuild and restart
docker-compose down
docker-compose up --build
```

## Summary

**Build once, configure anywhere** - The React app is built once, but configuration can be changed at runtime by regenerating `config.js` when the container starts.