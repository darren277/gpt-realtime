import React, { useState, useRef, useEffect } from 'react';

function App() {
  const [sessionInitialized, setSessionInitialized] = useState(false);
  const [wsStarted, setWsStarted] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [listening, setListening] = useState(false);
  const mediaRecorderRef = useRef(null);
  const [mediaRecorder, setMediaRecorder] = useState(null);

  const [audioChunks, setAudioChunks] = useState([]);
  const audioContextRef = React.useRef(null);

  const wsRef = useRef(null);

  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
  }, []);

  useEffect(() => {
    const ws = new WebSocket('ws://127.0.0.1:5660');
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connection established.");
    };
    
    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
    
    ws.onclose = () => {
      console.log("WebSocket connection closed.");
    };

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      console.log("Received event:", JSON.stringify(data, null, 2));

      if (data.type === "audio_delta") {
        console.log("Received audio delta:", data.delta.length, "bytes");
        await playAudioDelta(data.delta);
      }
      //handleRealtimeEvent(data);
    };

    return () => ws.close();
  }, []);

  const playAudioDelta = async (base64Audio) => {
    console.log("!!!!!!!!!!!!!!!!!!!!!!!!! Playing audio delta:", base64Audio.length, "bytes", typeof base64Audio);
    try {
      const audioContext = audioContextRef.current;
      const audioBuffer = Uint8Array.from(atob(base64Audio), (c) => c.charCodeAt(0));

      const decodedData = await audioContext.decodeAudioData(audioBuffer.buffer);
      const source = audioContext.createBufferSource();
      source.buffer = decodedData;
      source.connect(audioContext.destination);
      source.start();

      setAudioChunks((chunks) => [...chunks, audioBuffer]);
    } catch (err) {
      console.error("Error decoding audio:", err);
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

   // Toggles the microphone on/off
   const toggleListening = async () => {
    if (!listening) {
      // Turn on listening
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
            const reader = new FileReader();
            reader.onload = () => {
              // Convert the raw audio file into base64
              const base64Data = btoa(new Uint8Array(reader.result).reduce((data, byte) => data + String.fromCharCode(byte), ''));
              // Send to the server -> the server relays to GPT via input_audio_buffer.append
              const msg = {
                type: 'input_audio_buffer.append', 
                audio: base64Data 
              };
              wsRef.current.send(JSON.stringify(msg));
            };
            reader.readAsArrayBuffer(e.data);
          }
        };

        // NOTE TO SELF!
        // You can increase the chunk duration (e.g., call mediaRecorder.start(500) instead of mediaRecorder.start(250)).
        //mediaRecorder.start(250);
        mediaRecorder.start(1000);
        // Collect data every 250ms; you can adjust chunk duration as needed

        mediaRecorderRef.current = mediaRecorder;
        setListening(true);
      } catch (err) {
        console.error('Error accessing microphone:', err);
      }
    } else {
      // Turn off listening
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
      setListening(false);
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
        {/* <button
          onMouseDown={handleRecordStart}
          onMouseUp={handleRecordStop}
          disabled={!wsStarted}
          style={{ backgroundColor: isRecording ? '#d9534f' : '#ccc', color: '#fff' }}
        >
          {isRecording ? 'Release to Send' : 'Hold to Speak'}
        </button>
        <button onClick={handleInterrupt} disabled={!wsStarted}>Interrupt</button> */}
        <button onClick={toggleListening}>
          {listening ? 'Stop Listening' : 'Start Listening'}
        </button>
      </div>
    </div>
  );
}

export default App;
