/**
 * AudioPipeline — manages mic capture via AudioWorklet, resamples to 16 kHz mono,
 * and distributes PCM frames to registered consumers (KWS, VAD, ASR buffer).
 *
 * Usage:
 *   const pipeline = new AudioPipeline();
 *   await pipeline.init();
 *   pipeline.onFrame((frame) => { ... }); // 80ms frames of 16kHz Float32 PCM
 *   pipeline.start();
 *   pipeline.stop();
 *   pipeline.destroy();
 */

export type PcmFrameCallback = (frame: Float32Array) => void;

export class AudioPipeline {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private frameListeners: Set<PcmFrameCallback> = new Set();
  private capturing = false;
  private captureBuffer: Float32Array[] = [];
  private workletUrl: string | undefined;

  /**
   * @param workletUrl URL to the compiled worklet JS file.
   *   In a Vite dev setup this is typically a static asset in public/.
   */
  constructor(workletUrl?: string) {
    this.workletUrl = workletUrl;
  }

  /**
   * Initialize: request mic permission, create AudioContext, load worklet.
   */
  async init(workletUrl?: string): Promise<void> {
    // Request microphone
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: { ideal: 16000 },
      },
    });

    this.context = new AudioContext({ sampleRate: this.stream.getAudioTracks()[0].getSettings().sampleRate ?? 48000 });

    // Load the AudioWorklet processor
    const url = workletUrl ?? this.workletUrl ?? new URL('./pcm-processor.worklet.js', import.meta.url).href;
    await this.context.audioWorklet.addModule(url);

    // Create source -> worklet node
    this.sourceNode = this.context.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.context, 'voicepage-pcm-processor');

    this.workletNode.port.onmessage = (e: MessageEvent) => {
      if (e.data.type === 'pcm-frame') {
        const frame = e.data.frame as Float32Array;
        this.distributeFrame(frame);
      }
    };

    this.sourceNode.connect(this.workletNode);
    // Don't connect to destination — we don't want to play back mic audio
    // The worklet will process and post frames without needing an output connection.
    // However, some browsers require a connected graph to keep processing,
    // so connect to a silent gain node.
    const silentGain = this.context.createGain();
    silentGain.gain.value = 0;
    this.workletNode.connect(silentGain);
    silentGain.connect(this.context.destination);
  }

  /**
   * Register a callback to receive 80ms PCM frames (Float32, 16kHz, 1280 samples).
   * Returns an unsubscribe function.
   */
  onFrame(callback: PcmFrameCallback): () => void {
    this.frameListeners.add(callback);
    return () => this.frameListeners.delete(callback);
  }

  /**
   * Tell the worklet to start forwarding frames.
   */
  start(): void {
    if (this.context?.state === 'suspended') {
      this.context.resume();
    }
    this.workletNode?.port.postMessage({ type: 'start' });
  }

  /**
   * Tell the worklet to stop forwarding frames.
   */
  stop(): void {
    this.workletNode?.port.postMessage({ type: 'stop' });
  }

  /**
   * Begin buffering captured audio for ASR transcription.
   */
  startCapture(): void {
    this.captureBuffer = [];
    this.capturing = true;
  }

  /**
   * Stop capturing and return the full captured audio as a single Float32Array.
   */
  stopCapture(): Float32Array {
    this.capturing = false;
    if (this.captureBuffer.length === 0) return new Float32Array(0);

    const totalLength = this.captureBuffer.reduce((sum, buf) => sum + buf.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.captureBuffer) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    this.captureBuffer = [];
    return result;
  }

  /**
   * Get the AudioContext sample rate (for reference).
   */
  getSampleRate(): number {
    return this.context?.sampleRate ?? 16000;
  }

  /**
   * Tear down everything.
   */
  destroy(): void {
    this.stop();
    this.workletNode?.disconnect();
    this.sourceNode?.disconnect();
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
    }
    this.context?.close();
    this.context = null;
    this.stream = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.frameListeners.clear();
    this.captureBuffer = [];
  }

  private distributeFrame(frame: Float32Array): void {
    // If we're capturing for ASR, buffer the frame
    if (this.capturing) {
      this.captureBuffer.push(new Float32Array(frame));
    }
    // Distribute to all listeners (KWS, VAD, etc.)
    for (const listener of this.frameListeners) {
      try {
        listener(frame);
      } catch {
        // Listeners must not crash the pipeline
      }
    }
  }
}
