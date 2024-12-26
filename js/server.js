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

const { encodeWAV } = require('./utils');
const { session, handleModelConnection, isOpen, jsonSend } = require('./sessionManager');

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

  ws.on('close', () => {
    const index = clients.indexOf(ws);
    if (index !== -1) clients.splice(index, 1);
    console.log('WebSocket client disconnected.');
  });

  // Optionally, handle messages from frontend clients if needed
  ws.on('message', (message) => {
    const msg = JSON.parse(message);
    if (msg.type === 'input_audio_buffer.append') {
      console.log("Audio chunk received, size (base64):", msg.audio?.length || 0);

      if (msg.audio) {
        // 1) forward it to GPT
        const rawAudio = Buffer.from(msg.audio, 'base64');
        console.log("Raw audio buffer size:", rawAudio.length);

        convert_audio_and_send(rawAudio, 'input_audio_buffer.append');

        // 2) optionally echo the audio to other clients
        const wavData = encodeWAV(new Uint8Array(Buffer.from(msg.audio, 'base64')));
        const wavBase64 = Buffer.from(wavData).toString('base64');
        broadcastAudioDelta(wavBase64);
      } else {
        console.warn("No audio field in message!");
      }
    }
  });

  // Example: Test broadcasting a message to all connected clients
  setInterval(() => {
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'test', message: 'Test message from server' }));
      }
    });
  }, 5000); // Send a test message every 5 seconds
});

// Example: Broadcast audio_delta messages to all connected clients
function broadcastAudioDelta(delta) {
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: 'audio_delta',
          delta: delta, // base64 audio data
        })
      );
    }
  });
}

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

const convert_audio_and_send = (audioData, event_type, res) => {
  // Convert audio (webm/opus) to PCM16 mono 24kHz via ffmpeg
  const ffmpeg = spawn('ffmpeg', [
    '-f', 'webm',
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
    console.error('ffmpeg stderr:', chunk.toString());
  });

  ffmpeg.on('close', (code) => {
    if (code !== 0) {
      console.error("FFmpeg error, code:", code);
      if (res !== undefined) {
        return res.status(500).send("Error processing audio");
      }
    }

    console.log("PCM audio size:", pcmData.length);

    // Base64 encode PCM data
    const audioB64 = pcmData.toString('base64');

    const eventId = cryptoRandomId(16); // a function to generate short ids
    const itemId = cryptoRandomId(16); // must be <=32 chars

    const event = {
      "event_id": eventId,
      "type": event_type,
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
    
    console.log("Event sent to GPT:", JSON.stringify(event, null, 2));
    session.modelConn.send(JSON.stringify(event));
    if (res !== undefined) {
      return res.json({ status: "ok", event_id: eventId, item_id: itemId });
    }
  });

  ffmpeg.stdin.write(audioData);
  ffmpeg.stdin.end();
};

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
server.listen(PORT, () => {
  console.log(`Node server listening on port ${PORT}`);
});
