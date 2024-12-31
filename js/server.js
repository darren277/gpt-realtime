// server.js
require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const { spawn } = require('child_process');
const { WebSocket } = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const { session, handleModelConnection, handleFrontendConnection, isOpen, jsonSend } = require('./sessionManager');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SESSION_ENDPOINT = "https://api.openai.com/v1/realtime/sessions";

let CLIENT_SECRET = null;
let SESSION_ID = null;

const app = express();

// Create an HTTP server that wraps the existing Express app
const server = http.createServer(app);

// Create a WebSocket server attached to the HTTP server
const wss = new WebSocket.Server({ server });

// Array to store connected WebSocket clients
const clients = [];

app.use(express.json());

// Set up multer for handling multipart/form-data (audio uploads)
const upload = multer({ storage: multer.memoryStorage() });

app.post('/init_session', async (req, res) => {
  console.log("Session initializing...");

  const payload = {
    "model": "gpt-4o-realtime-preview-2024-12-17",
    "modalities": ["text", "audio"],
    "instructions": "You are a helpful assistant.",
    "input_audio_format": "pcm16",
    "output_audio_format": "pcm16",
    "input_audio_transcription": { "model": "whisper-1" }
  };

  const apiRes = await fetch(SESSION_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!apiRes.ok) {
    const text = await apiRes.text();
    return res.status(apiRes.status).send(`Failed to create session: ${text}`);
  }

  const data = await apiRes.json();
  SESSION_ID = data.id;
  CLIENT_SECRET = data.client_secret?.value;

  if (!CLIENT_SECRET) {
    return res.status(500).send("No client secret returned.");
  }

  return res.json({ session_id: SESSION_ID, client_secret: CLIENT_SECRET });
});

app.get('/start', (req, res) => {
  try {
    handleModelConnection();
    res.send("WebSocket connection started!");
  } catch (err) {
    console.error(err.message);
    res.status(500).send(err.message);
  }
});

wss.on('connection', (ws) => {
  console.log('WebSocket client connected.');
  clients.push(ws);

  handleFrontendConnection(ws);

  ws.on('close', () => {
    const index = clients.indexOf(ws);
    if (index !== -1) clients.splice(index, 1);
    console.log('WebSocket client disconnected.');
  });

  ws.on('message', (rawMsg) => {
    try {
      const msg = JSON.parse(rawMsg);
      if (msg.type === 'input_audio_buffer.append' && msg.audio) {
        // Forward audio input to GPT
        const event = {
          type: 'input_audio_buffer.append',
          audio: msg.audio, // base64 PCM16
        };
        session.modelConn.send(JSON.stringify(event));
      }
    } catch (err) {
      console.error('Error processing client message:', err);
    }
  });
});

app.post('/send', async (req, res) => {
  const message = req.body.message || '';
  if (!message) {
    return res.status(400).send("No message provided.");
  }

  const event = {
    "type": "response.create",
    "response": {
      "modalities": ["text", "audio"],
      "instructions": message
    }
  };

  if (!session.modelConn || session.modelConn.readyState !== WebSocket.OPEN) {
    return res.status(503).send("WebSocket not connected.");
  }

  session.modelConn.send(JSON.stringify(event));
  return res.send("Message sent!");
});

app.post('/truncate_audio', async (req, res) => {
  const truncateEvent = req.body;
  if (!truncateEvent || truncateEvent.type !== 'conversation.item.truncate') {
    return res.status(400).send("Invalid event type.");
  }

  if (!session.modelConn || session.modelConn.readyState !== WebSocket.OPEN) {
    return res.status(503).send("WebSocket not connected.");
  }

  session.modelConn.send(JSON.stringify(truncateEvent));
  return res.send("Truncation event sent!");
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 5658;
server.listen(PORT, () => {
  console.log(`Node server listening on port ${PORT}`);
});
