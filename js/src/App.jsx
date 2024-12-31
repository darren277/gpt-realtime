import React, { useRef, useState, useEffect } from 'react';

import { bufferToBase64, float32ToInt16, naiveDownsample } from './utils';

let nextPlaybackTime = 0;
const truncatedItems = new Set();

function App() {
  const [sessionInitialized, setSessionInitialized] = useState(false);
  const [wsStarted, setWsStarted] = useState(false);
  const [listening, setListening] = useState(false);
  const audioContextRef = useRef(null);
  const recorderNodeRef = useRef(null);
  const wsRef = useRef(null);

  function playChunk(decodedData) {
    const audioCtx = audioContextRef.current;
    const source = audioCtx.createBufferSource();
    source.buffer = decodedData;
    source.connect(audioCtx.destination);

    // Schedule this chunk to begin at nextPlaybackTime
    // If nextPlaybackTime is in the past, schedule it as soon as possible
    const startTime = Math.max(audioCtx.currentTime, nextPlaybackTime);
    source.start(startTime);

    // Then increment nextPlaybackTime by the chunk's duration
    nextPlaybackTime = startTime + decodedData.duration;
  }

  useEffect(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      console.log("AudioContext initialized:", audioContextRef.current);
    }
  }, []);

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
        //console.log("Received audio delta:", data.delta.length, "bytes");
        //await playAudioDelta(data.delta);
        // If item was truncated, skip playing
        if (truncatedItems.has(data.item_id)) return;

        // Otherwise play
        playChunk(data.delta);

      } else if (data.type === "conversation.item.truncated") {
        console.log("Item truncated:", data);

        // Mark that item as truncated
        truncatedItems.add(data.item_id);
    
        // Optionally call something like cancelPlaybackForItem(data.item_id)
        // if you want to fade out or kill a chunk already in progress.
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
      //const downsampled = naiveDownsample(samples, 2);
      //     If your RecorderProcessor.js is capturing a large chunk every time (e.g. 2048 frames or 4096 frames at 48 kHz?), you might be sending too-large lumps of audio. GPT’s server VAD may only detect speech once every big chunk.
      // Suggestion: Lower your processor’s chunk size (e.g. 512 or 1024 frames) so you have smaller chunks, more frequent updates. GPT’s server VAD can then respond more promptly.
      const downsampled = samples;

      // Officially, the docs mention 16 kHz or 8 kHz for Whisper. The real-time endpoints may support more, but you might get better luck if you systematically feed 16 kHz PCM16.
      const downsampled16k = naiveDownsample(downsampled, 3);

      const int16 = float32ToInt16(downsampled16k);
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
