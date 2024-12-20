// server.js
require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const { spawn } = require('child_process');
const { WebSocket } = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SESSION_ENDPOINT = "https://api.openai.com/v1/realtime/sessions";

let CLIENT_SECRET = null;
let SESSION_ID = null;
let wsApp = null; // Reference to the WebSocket connection

const app = express();
app.use(express.json());

// Set up multer for handling multipart/form-data (audio uploads)
const upload = multer({ storage: multer.memoryStorage() });

app.post('/init_session', async (req, res) => {
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
  if (!CLIENT_SECRET) {
    return res.status(400).send("Session not initialized yet.");
  }

  const realtimeUrl = `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17`;
  wsApp = new WebSocket(realtimeUrl, {
    headers: {
      'Authorization': `Bearer ${CLIENT_SECRET}`,
      'OpenAI-Beta': 'realtime=v1'
    }
  });

  wsApp.on('open', () => {
    console.log('Connected to server.');
  });

  wsApp.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log("Received event:", JSON.stringify(data, null, 2));
    } catch (err) {
      console.error("Failed to parse message:", message, err);
    }
  });

  wsApp.on('error', (err) => {
    console.error('WebSocket error:', err);
  });

  return res.send("WebSocket connection started!");
});

app.post('/send', async (req, res) => {
  if (!wsApp || wsApp.readyState !== WebSocket.OPEN) {
    return res.status(503).send("WebSocket not connected.");
  }

  const message = req.body.message || '';
  if (!message) {
    return res.status(400).send("No message provided.");
  }

  const event = {
    "type": "response.create",
    "response": {
      "modalities": ["text"],
      "instructions": message
    }
  };

  wsApp.send(JSON.stringify(event));
  return res.send("Message sent!");
});

app.post('/truncate_audio', async (req, res) => {
  if (!wsApp || wsApp.readyState !== WebSocket.OPEN) {
    return res.status(503).send("WebSocket not connected.");
  }

  const truncateEvent = req.body;
  if (!truncateEvent || truncateEvent.type !== 'conversation.item.truncate') {
    return res.status(400).send("Invalid event type.");
  }

  wsApp.send(JSON.stringify(truncateEvent));
  return res.send("Truncation event sent!");
});

app.post('/conversation_item_create', upload.single('audio'), async (req, res) => {
  if (!wsApp || wsApp.readyState !== WebSocket.OPEN) {
    return res.status(503).send("WebSocket not connected.");
  }

  if (!req.file) {
    return res.status(400).send("No audio file provided.");
  }

  const audioData = req.file.buffer;

  // Convert audio (webm/opus) to PCM16 mono 24kHz via ffmpeg
  const ffmpeg = spawn('ffmpeg', [
    '-i', 'pipe:0',    // read from stdin
    '-ar', '24000',    // 24kHz
    '-ac', '1',        // mono
    '-f', 's16le',     // raw PCM16
    'pipe:1'           // output to stdout
  ]);

  let pcmData = Buffer.alloc(0);
  ffmpeg.stdout.on('data', (chunk) => {
    pcmData = Buffer.concat([pcmData, chunk]);
  });

  ffmpeg.stderr.on('data', (chunk) => {
    // ffmpeg logs to stderr, you can optionally log it
    // console.error('ffmpeg stderr:', chunk.toString());
  });

  ffmpeg.on('close', (code) => {
    if (code !== 0) {
      return res.status(500).send("Error processing audio");
    }

    // Base64 encode PCM data
    const audioB64 = pcmData.toString('base64');

    const eventId = cryptoRandomId(16); // a function to generate short ids
    const itemId = cryptoRandomId(16); // must be <=32 chars

    const event = {
      "event_id": eventId,
      "type": "conversation.item.create",
      "previous_item_id": null,
      "item": {
        "id": itemId,
        "type": "message",
        "role": "user",
        "content": [
          {
            "type": "input_audio",
            "audio": audioB64
          }
        ]
      }
    };

    wsApp.send(JSON.stringify(event));
    return res.json({ status: "ok", event_id: eventId, item_id: itemId });
  });

  ffmpeg.stdin.write(audioData);
  ffmpeg.stdin.end();
});

const crypto = require('crypto');
function cryptoRandomId(length) {
  // Generate a random hex string for ID, truncate to desired length.
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 5658;
app.listen(PORT, () => {
  console.log(`Node server listening on port ${PORT}`);
});
