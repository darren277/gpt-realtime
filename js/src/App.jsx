import React, { useRef, useState, useEffect } from 'react';

function App() {
  const [sessionInitialized, setSessionInitialized] = useState(false);
  const [wsStarted, setWsStarted] = useState(false);
  const [listening, setListening] = useState(false);
  const audioContextRef = useRef(null);
  const recorderNodeRef = useRef(null);
  const wsRef = useRef(null);

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

  useEffect(() => {
    // Create WebSocket
    const ws = new WebSocket('ws://127.0.0.1:5660');
    wsRef.current = ws;

    ws.onopen = () => console.log('WS open');
    ws.onmessage = async (e) => {
      console.log('WS message:', e);
      
      // e.g. handle GPT audio deltas
      const data = JSON.parse(e.data);
      if (data.type === "audio_delta") {
        console.log("Received audio delta:", data.delta.length, "bytes");
        await playAudioDelta(data.delta);
      }
    };
    ws.onclose = () => console.log('WS closed');
    return () => ws.close();
  }, []);

  async function startListening() {
    if (listening) return;
    setListening(true);

    // 1) AudioContext
    audioContextRef.current = new AudioContext();

    // 2) Add our custom Processor
    await audioContextRef.current.audioWorklet.addModule('/RecorderProcessor.js');

    // 3) Create our node
    recorderNodeRef.current = new AudioWorkletNode(
      audioContextRef.current,
      'recorder-processor'
    );

    // 4) Handle PCM chunks from the processor
    recorderNodeRef.current.port.onmessage = (event) => {
      const { samples } = event.data;
      if (!samples) return;

      // (Optional) downsample from 48k -> 24k
      const downsampled = naiveDownsample(samples, 2);
      const int16 = float32ToInt16(downsampled);
      const base64Data = bufferToBase64(int16);
      
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: 'input_audio_buffer.append', audio: base64Data })
        );
      }
    };

    // 5) Get mic and connect
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioContextRef.current.createMediaStreamSource(stream);
    source.connect(recorderNodeRef.current);
    // Not connecting recorderNode to destination to avoid feedback
  }

  function stopListening() {
    setListening(false);
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }

  function float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      let s = float32Array[i];
      s = s < 0 ? s * 0x8000 : s * 0x7FFF; // convert from [-1, 1] to int16
      int16Array[i] = Math.max(-32768, Math.min(32767, s));
    }
    return int16Array;
  }

  function naiveDownsample(inputFloat32, factor) {
    const output = new Float32Array(Math.floor(inputFloat32.length / factor));
    let j = 0;
    for (let i = 0; i < inputFloat32.length; i += factor) {
      output[j++] = inputFloat32[i];
    }
    return output;
  }

  function bufferToBase64(int16Array) {
    const bytes = new Uint8Array(int16Array.buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

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

  return (
    <div>
      <div>
        <button onClick={
          () => {
            initializeSessionAndStart();
            setSessionInitialized(true);
            setWsStarted(true);
          }
        } disabled={sessionInitialized}>Initialize Session and Start WebSocket</button>
      </div>
      <button onClick={startListening} disabled={listening}>Start Listening</button>
      <button onClick={stopListening} disabled={!listening}>Stop Listening</button>
    </div>
  );
}

export default App;
