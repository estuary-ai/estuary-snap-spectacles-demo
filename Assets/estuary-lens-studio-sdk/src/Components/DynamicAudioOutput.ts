/**
 * DynamicAudioOutput - Hardware-compatible audio playback for Spectacles.
 * 
 * This component is based on Snap's official helper for streaming PCM16 audio.
 * It provides better hardware compatibility on Spectacles compared to JS-based
 * audio queue management.
 * 
 * Key features:
 * - Takes PCM16 Uint8Array directly (from Base64.decode())
 * - Converts PCM16 to Float32 internally
 * - Uses AudioOutputProvider.enqueueAudioFrame() for native playback
 * - Proper interrupt support via audComponent.stop()
 * 
 * Usage in Lens Studio:
 * 1. Add this script to a SceneObject
 * 2. Add an AudioComponent to the same SceneObject
 * 3. Create an Audio Track asset and assign it to audioOutputTrack
 * 4. Call initialize(sampleRate) before playing audio
 * 5. Call addAudioFrame(pcmBytes) to play audio chunks
 * 6. Call interruptAudioOutput() to stop playback immediately
 * 
 * @see https://developers.snap.com/lens-studio/api/modules/Audio
 */
@component
export class DynamicAudioOutput extends BaseScriptComponent {
    @ui.separator
    @ui.label("This script manages audio output for generative AI models.")
    @ui.separator
    @input
    private audioOutputTrack: AudioTrackAsset;

    private audComponent: AudioComponent;
    private audioOutputProvider: AudioOutputProvider;

    onAwake() {
        this.audioOutputProvider = this.audioOutputTrack
            .control as AudioOutputProvider;
        this.audComponent = this.sceneObject.getComponent("AudioComponent");
    }

    /**
     * Initializes the audio output with the specified sample rate.
     * Call this once before playing any audio.
     * 
     * @param sampleRate - Sample rate for the audio output (e.g., 24000 for ElevenLabs)
     */
    initialize(sampleRate: number) {
        this.audioOutputProvider.sampleRate = sampleRate;
        this.audComponent.audioTrack = this.audioOutputTrack;
        this.audComponent.play(-1);
    }

    /**
     * Adds an audio frame to the output buffer for playback.
     * 
     * @param uint8Array - Audio data in PCM 16-bit format as a Uint8Array.
     *                     This is what you get from Base64.decode(audioString).
     * @param channels - Optional channel count. Default is 1 (mono).
     *
     * Expects interleaved PCM16 for multi-channel input.
     */
    addAudioFrame(uint8Array: Uint8Array, channels: number = 1) {
        if (!this.audComponent.isPlaying()) {
            this.audComponent.play(-1);
        }
        let { data, shape } = this.convertPCM16ToAudFrameAndShape(
            uint8Array,
            channels
        );
        this.audioOutputProvider.enqueueAudioFrame(data, shape);
    }

    /**
     * Stops the audio output immediately.
     * Use this when:
     * - User starts speaking (interrupt)
     * - New message arrives and autoInterrupt is enabled
     * - Manual stop requested
     * 
     * This properly stops the hardware AudioComponent, not just clearing a JS queue.
     */
    interruptAudioOutput() {
        if (this.audComponent.isPlaying()) {
            this.audComponent.stop(false);
        }
    }

    /**
     * Check if audio is currently playing.
     */
    isPlaying(): boolean {
        return this.audComponent?.isPlaying() ?? false;
    }

    /**
     * Converts PCM16 byte array to Float32Array with shape for enqueueAudioFrame.
     */
    private convertPCM16ToAudFrameAndShape(
        uint8Array: Uint8Array,
        channels: number = 1
    ): {
        data: Float32Array;
        shape: vec3;
    } {
        const clampedChannels = Math.max(1, channels | 0);
        const bytesPerFrame = 2 * clampedChannels;
        const safeLength = uint8Array.length - (uint8Array.length % bytesPerFrame);
        const totalSamples = safeLength / 2;
        const frames = totalSamples / clampedChannels;

        let monoData = new Float32Array(frames);
        if (clampedChannels === 1) {
            for (let i = 0, j = 0; i < safeLength; i += 2, j++) {
                const sample = ((uint8Array[i] | (uint8Array[i + 1] << 8)) << 16) >> 16;
                monoData[j] = sample / 32768.0;
            }
        } else {
            for (let f = 0; f < frames; f++) {
                const byteIndex = f * bytesPerFrame;
                const sample =
                    ((uint8Array[byteIndex] | (uint8Array[byteIndex + 1] << 8)) << 16) >>
                    16;
                monoData[f] = sample / 32768.0;
            }
        }

        let shape = new vec3(monoData.length, 1, 1);
        return { data: monoData, shape: shape };
    }
}

