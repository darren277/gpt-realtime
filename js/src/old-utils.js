

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

