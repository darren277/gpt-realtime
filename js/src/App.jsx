import React, { useState, useRef, useEffect } from 'react';

function App() {
  const [sessionInitialized, setSessionInitialized] = useState(false);
  const [wsStarted, setWsStarted] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);

  // Initialize session
  const initSession = async () => {
    const res = await fetch('/init_session', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      console.log('Session initialized:', data);
      setSessionInitialized(true);
    } else {
      console.error('Failed to initialize session');
    }
  };

  // Start WebSocket Connection
  const startWebSocket = async () => {
    const res = await fetch('/start', { method: 'GET' });
    if (res.ok) {
      const text = await res.text();
      console.log('WebSocket started:', text);
      setWsStarted(true);
    } else {
      console.error('Failed to start WebSocket');
    }
  };

  // Set up MediaRecorder once
  useEffect(() => {
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        setMediaRecorder(recorder);
      } catch (err) {
        console.error('Failed to get user media:', err);
      }
    })();
  }, []);

  const handleRecordStart = () => {
    if (mediaRecorder && mediaRecorder.state === 'inactive') {
      mediaRecorder.start();
      setIsRecording(true);
    }
  };

  const handleRecordStop = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  function initializeSessionAndStart() {
    // Step 1: Initialize the session
    fetch('http://127.0.0.1:5660/init_session', {
      method: 'POST',
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to initialize session.');
        }
        return response.json();
      })
      .then((data) => {
        console.log('Session initialized:', data);
        // Step 2: Start the WebSocket connection
        return fetch('http://127.0.0.1:5660/start');
      })
      .then(() => {
        console.log('WebSocket connection started.');
      })
      .catch((err) => {
        console.error(err);
      });
  }

  // Handle data from MediaRecorder
  useEffect(() => {
    if (!mediaRecorder) return;

    let recordedChunks = [];

    const onDataAvailable = e => {
      if (e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    const onStop = async () => {
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      recordedChunks = [];
      
      // Send this blob to the server
      const formData = new FormData();
      formData.append('audio', blob);

      const res = await fetch('/conversation_item_create', {
        method: 'POST',
        body: formData
      });
      
      if (res.ok) {
        const data = await res.json();
        console.log('conversation.item.create response:', data);

        // Now request assistant response
        const resp = await fetch('/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: "Please respond to the user's audio." })
        });

        const respText = await resp.text();
        console.log('response.create triggered:', respText);
      } else {
        console.error('Failed to create conversation item');
      }
    };

    mediaRecorder.addEventListener('dataavailable', onDataAvailable);
    mediaRecorder.addEventListener('stop', onStop);

    return () => {
      mediaRecorder.removeEventListener('dataavailable', onDataAvailable);
      mediaRecorder.removeEventListener('stop', onStop);
    };
  }, [mediaRecorder]);

  const handleInterrupt = async () => {
    // Suppose we know how far the user has listened:
    // For simplicity, just send a truncate event with an arbitrary time.
    const playedMs = 1500;
    const truncateEvent = {
      event_id: crypto.randomUUID(),
      type: "conversation.item.truncate",
      item_id: "msg_002",
      content_index: 0,
      audio_end_ms: playedMs
    };

    const res = await fetch('/truncate_audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(truncateEvent)
    });
    if (!res.ok) {
      console.error('Error truncating:', await res.text());
    } else {
      console.log('Truncation successful');
    }
  };

  return (
    <div>
      <h1>GPT Real-Time Audio Demo with Microphone (React)</h1>
      <div>
        <button onClick={
          () => {
            initializeSessionAndStart();
            setSessionInitialized(true);
            setWsStarted(true);
          }
        } disabled={sessionInitialized}>Initialize Session and Start WebSocket</button>
      </div>

      <div style={{ marginTop: '20px' }}>
        <button
          onMouseDown={handleRecordStart}
          onMouseUp={handleRecordStop}
          disabled={!wsStarted}
          style={{ backgroundColor: isRecording ? '#d9534f' : '#ccc', color: '#fff' }}
        >
          {isRecording ? 'Release to Send' : 'Hold to Speak'}
        </button>
        <button onClick={handleInterrupt} disabled={!wsStarted}>Interrupt</button>
      </div>
    </div>
  );
}

export default App;
