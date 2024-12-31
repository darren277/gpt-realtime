// Helper function to downsample
function naiveDownsample(inputFloat32, factor) {
    const output = new Float32Array(Math.floor(inputFloat32.length / factor));
    let j = 0;
    for (let i = 0; i < inputFloat32.length; i += factor) {
        output[j++] = inputFloat32[i];
    }
    return output;
}

// Convert Float32 PCM to Int16
function float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        let s = float32Array[i];
        s = s < 0 ? s * 0x8000 : s * 0x7FFF; // convert from [-1,1] to int16
        int16Array[i] = Math.max(-32768, Math.min(32767, s));
    }
    return int16Array;
}

// Convert Int16 buffer to base64
function bufferToBase64(int16Array) {
    const bytes = new Uint8Array(int16Array.buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

module.exports = {
    naiveDownsample,
    float32ToInt16,
    bufferToBase64
};
