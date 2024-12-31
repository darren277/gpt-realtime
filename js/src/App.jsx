import React, { useRef, useState, useEffect } from 'react';

let nextPlaybackTime = 0;
const truncatedItems = new Set();
const playbackQueue = [];
let isPlaying = false;

function processQueue(audioContextRef, pauseInterval = 0.001) {
  if (playbackQueue.length === 0 || isPlaying) {
    return;
  }

  const audioContext = audioContextRef.current;
  if (!audioContext) {
    console.error("AudioContext is not initialized.");
    return;
  }

  const { decodedData, duration } = playbackQueue.shift();
  isPlaying = true;

  const source = audioContext.createBufferSource();
  source.buffer = decodedData;
  source.connect(audioContext.destination);

  applyFades(audioContextRef, source);
  source.start();

  // Wait for the audio to finish playing before processing the next chunk
  setTimeout(() => {
    isPlaying = false;
    processQueue(audioContextRef);
  }, (duration + pauseInterval) * 1000); // Convert seconds to milliseconds
}

function applyFades(audioContextRef, bufferSource, fadeDuration = 0.1) {
  const audioContext = audioContextRef.current;
  if (!audioContext) {
    console.error("AudioContext not initialized for fades");
    return;
  }

  const gainNode = audioContext.createGain();
  bufferSource.connect(gainNode);
  gainNode.connect(audioContext.destination);

  const currentTime = audioContext.currentTime;

  // Fade in
  gainNode.gain.setValueAtTime(0, currentTime);
  gainNode.gain.linearRampToValueAtTime(1, currentTime + fadeDuration);

  // Fade out
  gainNode.gain.setValueAtTime(1, currentTime + bufferSource.buffer.duration - fadeDuration);
  gainNode.gain.linearRampToValueAtTime(0, currentTime + bufferSource.buffer.duration);
}

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

  const playAudioDelta = async (base64Audio) => {
    console.log("!!!!!!!!!!!!!!!!!!!!!!!!! Playing audio delta:", base64Audio.length, "bytes", typeof base64Audio);
    try {
      if (!audioContextRef.current) {
        throw new Error("AudioContext is not initialized.");
      }

      if (audioContextRef.current.state === 'suspended') {
        console.log("Resuming AudioContext...");
        await audioContextRef.current.resume();
      }

      const audioContext = audioContextRef.current;
      const audioBuffer = Uint8Array.from(atob(base64Audio), (c) => c.charCodeAt(0));

      const decodedData = await audioContext.decodeAudioData(audioBuffer.buffer);
      //const duration = decodedData.duration;

      //playbackQueue.push({ decodedData, duration });

      //processQueue(audioContextRef);
      
      //setAudioChunks((chunks) => [...chunks, audioBuffer]);

      // Instead of pushing to a queue and calling processQueue,
      // we just call playChunk() directly with the decoded data.
      playChunk(decodedData);
    } catch (err) {
      console.error("Error decoding audio:", err);
    }
  };

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

      const int16 = float32ToInt16(downsampled);
      const base64Data = bufferToBase64(int16);
      
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const timestamp = Date.now();
        console.log(`[${timestamp}] Sending audio chunk to server.`);
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
