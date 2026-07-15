// AudioWorklet Processor - Converts Float32 to Int16 PCM
class PCM16Processor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 4096; // Buffer size in samples
        this.buffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        
        if (input.length > 0) {
            const inputChannel = input[0]; // Mono channel
            
            for (let i = 0; i < inputChannel.length; i++) {
                this.buffer[this.bufferIndex] = inputChannel[i];
                this.bufferIndex++;
                
                // When buffer is full, convert to Int16 and send
                if (this.bufferIndex >= this.bufferSize) {
                    // Convert Float32 (-1.0 to 1.0) to Int16 (-32768 to 32767)
                    const int16Buffer = new Int16Array(this.bufferSize);
                    for (let j = 0; j < this.bufferSize; j++) {
                        // Clamp to [-1, 1] range
                        const sample = Math.max(-1, Math.min(1, this.buffer[j]));
                        // Convert to Int16
                        int16Buffer[j] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                    }
                    
                    // Send to main thread
                    this.port.postMessage({
                        type: 'audio',
                        data: int16Buffer.buffer
                    });
                    
                    // Reset buffer
                    this.bufferIndex = 0;
                }
            }
        }
        
        return true; // Keep processor alive
    }
}

registerProcessor('pcm16-processor', PCM16Processor);
