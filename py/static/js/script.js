import WebSocketClient from './ws-client.js';
import handleEvent from './event-handler.js';

var ws_address = document.getElementsByName('ws_address')[0].content;

const recordButton = document.getElementById('record-button');
const interruptButton = document.getElementById('interrupt-button');
const audioElement = document.getElementById('assistant-audio');

const initSessionButton = document.getElementById('init-session-button');
const startWsButton = document.getElementById('start-ws-button');
const controlsDiv = document.getElementById('controls');

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

// Back-end endpoints
const INIT_SESSION_URL = '/init_session';
const START_WS_URL = '/start';
const CREATE_ITEM_URL = '/conversation_item_create';
const CREATE_RESPONSE_URL = '/send';
const TRUNCATE_URL = '/truncate_audio';


const audioManager = new AudioManager({
  initialMute: false,
  enabled: true,
});

// Initialize everything (like useEffect)
audioManager.init();


// Step 1: Initialize Session
initSessionButton.addEventListener('click', () => {
    fetch(INIT_SESSION_URL, {method: 'POST'})
        .then(res => res.json())
        .then(data => {
            console.log('Session initialized:', data);
            // Now that the session is created, enable the "Start WebSocket" button
            startWsButton.disabled = false;
        })
        .catch(err => console.error('Failed to initialize session:', err));
});

// Step 2: Start WebSocket Connection
startWsButton.addEventListener('click', () => {
    fetch(START_WS_URL, { method: 'GET' })
        .then(res => res.text())
        .then(text => {
            console.log('Backend (Realtime API) WebSocket started:', text);

            const wsClient = new WebSocketClient(ws_address);

            // make wsClient available everywhere
            window.wsClient = wsClient;

            window.wsClient.onOpen = (event) => {
                console.log('WebSocket connection established from front end to back end.');
                // WebSocket is now connected, we can enable recording and other controls
                startWsButton.disabled = true;
                setupAudioRecording();
                controlsDiv.style.display = 'block';
                recordButton.disabled = false;
                interruptButton.disabled = false;
            };

            window.wsClient.onMessage = (event) => {
                console.log('Custom onMessage logic:', event.data);
                // Handle incoming events/messages from the server here
                handleEvent(event);
            };

            window.wsClient.onError = (error) => {
                console.error('Custom onError logic:', error);
            };

            window.wsClient.onClose = (event) => {
                console.log('Custom onClose logic:', event);
            };

            window.wsClient.connect();
        })
        .catch(err => console.error('Failed to start WebSocket:', err));
});

function setupAudioRecording() {
  audioManager
    .connectAudio()
    .then(() => {
      console.log('Audio streaming to the server started...');
    })
    .catch(err => {
      console.error('Failed to start audio:', err);
    });
}

function stopAudioRecording() {
  audioManager
    .disconnect()
    .then(() => {
      console.log('Audio recording stopped.');
      // If you want to do something after stopping (such as telling the server to finalize a response, or fetching a final transcript), do it here.
    })
    .catch(err => {
      console.error('Failed to stop audio:', err);
    });
}

// Record button handlers
recordButton.addEventListener('mousedown', () => {
    if (mediaRecorder && mediaRecorder.state === 'inactive') {
        mediaRecorder.start();
        isRecording = true;
        recordButton.textContent = 'Release to Send';
    }
});

recordButton.addEventListener('mouseup', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        isRecording = false;
        recordButton.textContent = 'Hold to Speak';
    }
});

// Touch events for mobile
recordButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (mediaRecorder && mediaRecorder.state === 'inactive') {
        mediaRecorder.start();
        isRecording = true;
        recordButton.textContent = 'Release to Send';
    }
});

recordButton.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        isRecording = false;
        recordButton.textContent = 'Hold to Speak';
    }
});

// Interrupt button triggers truncate
interruptButton.addEventListener('click', () => {
    const playedMs = Math.floor(audioElement.currentTime * 1000);

    const truncateEvent = {
        event_id: crypto.randomUUID(),
        type: "conversation.item.truncate",
        item_id: "msg_002", // The ID of the assistant message currently playing, adjust accordingly
        content_index: 0,
        audio_end_ms: playedMs
    };

    fetch(TRUNCATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(truncateEvent)
    })
    .then(res => {
        if (!res.ok) {
            console.error('Error truncating:', res.statusText);
        } else {
            console.log('Truncation successful');
        }
    })
    .catch(console.error);
});