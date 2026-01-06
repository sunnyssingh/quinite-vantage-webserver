# Vantage WebSocket Server

Standalone WebSocket server for bridging Plivo telephony to OpenAI Realtime API.

## Deploy to Render

### 1. Create New Web Service

- Go to [Render Dashboard](https://dashboard.render.com/)
- Click "New +" → "Web Service"
- Connect your GitHub repository
- Set **Root Directory**: `websocket-server`

### 2. Configure Service

- **Name**: `vantage-websocket`
- **Environment**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Instance Type**: `Free` (or `Starter` for better performance)

### 3. Environment Variables

Add these in Render dashboard:

```
OPENAI_API_KEY=your_openai_api_key
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_service_role_key
PORT=10000
```

### 4. Update Your Main App

After deployment, Render will give you a URL like:
`https://vantage-websocket.onrender.com`

Update your main app's `.env`:

```env
WS_URL=wss://vantage-websocket.onrender.com
ENABLE_REALTIME_AI=true
```

### 5. Test

Make a call from your campaign. Check Render logs for:

```
[callSid] Plivo WebSocket connected
[callSid] OpenAI Realtime API connected
[callSid] User: Hello?
[callSid] AI: Hello! This is...
```

## Local Testing

```bash
cd websocket-server
npm install
OPENAI_API_KEY=xxx SUPABASE_URL=xxx SUPABASE_SERVICE_KEY=xxx npm start
```

Server runs on `ws://localhost:3001/voice/stream`
