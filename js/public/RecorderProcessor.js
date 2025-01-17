// RecorderProcessor.js
// Note: The AudioWorkletProcessor runs in a separate thread.

class RecorderProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      // We’ll accumulate samples here until we have a chunk to send to main thread.
      this._buffer = [];
      this._sampleRate = sampleRate; // The sample rate at which process() runs
    }
  
    process(inputs, outputs, parameters) {
      // inputs is an array of inputs—first dimension is channels, second dimension is samples
      // For simplicity, assume single-channel audio: inputs[0][0]
      const input = inputs[0];
      if (!input || !input[0]) {
        // No data
        return true;
      }
  
      const channelData = input[0]; // Float32Array of samples for this render quantum
      // channelData.length typically 128 or 256 samples, depending on the browser.
  
      // We can push these float samples into our buffer:
      // (In real usage, you might accumulate them or convert them right now.)
      this._buffer.push(new Float32Array(channelData));
  
      // Let’s send data every ~0.25 seconds, for example:
      const chunkDurationSec = 0.25;
      //const chunkDurationSec = 0.02;
      const samplesPerChunk = Math.floor(chunkDurationSec * sampleRate); // e.g. sampleRate=48000 => 12000 samples
  
      // Flatten out all samples we’ve collected so far
      const totalCollected = this._buffer.reduce((sum, arr) => sum + arr.length, 0);
  
      if (totalCollected >= samplesPerChunk) {
        // Combine everything into one Float32Array
        const fullData = new Float32Array(totalCollected);
        let offset = 0;
        for (const arr of this._buffer) {
          fullData.set(arr, offset);
          offset += arr.length;
        }
  
        // Clear buffer
        this._buffer = [];
  
        // Post fullData back to main thread
        this.port.postMessage({ samples: fullData });
      }
  
      // Returning true keeps the processor alive
      return true;
    }
  }
  
  registerProcessor('recorder-processor', RecorderProcessor);
  