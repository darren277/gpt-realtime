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

  // Step 1: Initialize Session
  initSessionButton.addEventListener('click', () => {
    fetch(INIT_SESSION_URL, {
      method: 'POST'
    })
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
      console.log('WebSocket started:', text);
      // WebSocket is now connected, we can enable recording and other controls
      startWsButton.disabled = true;
      setupAudioRecording();
      controlsDiv.style.display = 'block';
      recordButton.disabled = false;
      interruptButton.disabled = false;
    })
    .catch(err => console.error('Failed to start WebSocket:', err));
  });

  function setupAudioRecording() {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = e => {
          if (e.data.size > 0) {
            recordedChunks.push(e.data);
          }
        };

        mediaRecorder.onstop = () => {
          // Once stopped, we have the full recorded audio
          const blob = new Blob(recordedChunks, { type: 'audio/webm' });
          recordedChunks = [];

          const formData = new FormData();
          formData.append('audio', blob);

          fetch(CREATE_ITEM_URL, {
            method: 'POST',
            body: formData
          })
          .then(res => res.json())
          .then(data => {
            console.log('conversation.item.create response:', data);
            // After sending user audio as conversation item, request assistant response:
            return fetch(CREATE_RESPONSE_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: "Please respond to the user's audio." })
            });
          })
          .then(res => res.text())
          .then(responseText => {
            console.log('response.create triggered:', responseText);
            // The assistant should now respond via the WS connection.
          })
          .catch(console.error);
        };
      })
      .catch(err => console.error('Failed to get user media:', err));
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