function encodeWAV(pcmData, sampleRate = 24000, numChannels = 1) {
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
  
    const writeString = (view, offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };
  
    // Write WAV header
    writeString(view, 0, 'RIFF'); // ChunkID
    view.setUint32(4, 36 + pcmData.length, true); // ChunkSize
    writeString(view, 8, 'WAVE'); // Format
    writeString(view, 12, 'fmt '); // Subchunk1ID
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * numChannels * 2, true); // ByteRate
    view.setUint16(32, numChannels * 2, true); // BlockAlign
    view.setUint16(34, 16, true); // BitsPerSample
    writeString(view, 36, 'data'); // Subchunk2ID
    view.setUint32(40, pcmData.length, true); // Subchunk2Size
  
    // Combine header and PCM data
    return new Uint8Array([...new Uint8Array(wavHeader), ...pcmData]);
}

module.exports = { encodeWAV };
