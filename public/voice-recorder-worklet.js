class VoiceRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(2048)
    this.offset = 0
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    let index = 0
    while (index < channel.length) {
      const count = Math.min(this.buffer.length - this.offset, channel.length - index)
      this.buffer.set(channel.subarray(index, index + count), this.offset)
      this.offset += count
      index += count
      if (this.offset === this.buffer.length) {
        const samples = this.buffer
        let power = 0
        for (const sample of samples) power += sample * sample
        const rms = Math.sqrt(power / samples.length)
        this.port.postMessage({ samples, rms }, [samples.buffer])
        this.buffer = new Float32Array(2048)
        this.offset = 0
      }
    }
    return true
  }
}

registerProcessor('voice-recorder', VoiceRecorderProcessor)
