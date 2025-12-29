/**
 * Microphone component for Estuary voice input in Lens Studio.
 * Captures audio from the microphone and streams it to Estuary for speech-to-text.
 * 
 * Lens Studio provides multiple options for audio input:
 * 1. VoiceML - Built-in speech recognition (uses Snap's STT)
 * 2. AudioInput - Raw audio access (requires extended permissions)
 * 
 * This implementation supports both approaches.
 */

import { EstuaryCharacter, IEstuaryMicrophoneController } from './EstuaryCharacter';
import { encodeAudio } from '../Utilities/Base64Helper';
import { calculateRMS, resample, DEFAULT_RECORD_SAMPLE_RATE } from '../Utilities/AudioConverter';
import { EventEmitter } from '../Core/EstuaryEvents';

/**
 * Event types for EstuaryMicrophone
 */
export interface EstuaryMicrophoneEvents {
    recordingStarted: () => void;
    recordingStopped: () => void;
    volumeChanged: (volume: number) => void;
    speechDetected: () => void;
    silenceDetected: () => void;
    audioChunkSent: (chunkSize: number) => void;
}

/**
 * Interface for Lens Studio's Audio Input control.
 * Using 'any' to be compatible with Lens Studio's AudioTrackProvider.
 */
export type AudioInputControl = any;

/**
 * Interface for VoiceML transcription options
 */
export interface VoiceMLOptions {
    /** Enable continuous listening */
    continuous: boolean;
    /** Language code (e.g., 'en-US') */
    language: string;
}

/**
 * EstuaryMicrophone - Handles microphone input for voice chat.
 * Implements IEstuaryMicrophoneController for use with EstuaryCharacter.
 */
export class EstuaryMicrophone 
    extends EventEmitter<any>
    implements IEstuaryMicrophoneController {

    // ==================== Configuration ====================

    /** Sample rate for recording (must be 16000 for STT) */
    private _sampleRate: number = DEFAULT_RECORD_SAMPLE_RATE;

    /** Duration of each audio chunk in milliseconds.
     * Reduced to 40ms to keep WebSocket messages under 2KB to avoid
     * buffer overflow issues in Lens Studio's WebSocket implementation.
     */
    private _chunkDurationMs: number = 40;

    /** Volume threshold for voice activity detection (0-1) */
    private _vadThreshold: number = 0.02;

    /** Enable voice activity detection */
    private _useVoiceActivityDetection: boolean = false;

    /** Debug logging enabled */
    private _debugLogging: boolean = false;

    // ==================== State ====================

    /** Whether currently recording */
    private _isRecording: boolean = false;

    /** Current audio volume level (0-1) */
    private _currentVolume: number = 0;

    /** Whether speech is currently detected (VAD mode) */
    private _isSpeechDetected: boolean = false;

    /** Was speaking in the previous frame */
    private _wasSpeaking: boolean = false;

    // ==================== References ====================

    /** Target character to send audio to */
    private _targetCharacter: EstuaryCharacter | null = null;

    /** Audio input control from Lens Studio */
    private _audioInput: AudioInputControl | null = null;

    /** Buffer for accumulating audio samples */
    private _sampleBuffer: Float32Array | null = null;

    /** Current position in sample buffer */
    private _bufferPosition: number = 0;

    /** Frame counter for debug logging */
    private _frameCount: number = 0;

    // ==================== Constructor ====================

    constructor(targetCharacter?: EstuaryCharacter) {
        super();
        if (targetCharacter) {
            this._targetCharacter = targetCharacter;
        }
    }

    // ==================== Properties ====================

    get sampleRate(): number {
        return this._sampleRate;
    }

    set sampleRate(value: number) {
        this._sampleRate = value;
        this.updateSampleBuffer();
    }

    get chunkDurationMs(): number {
        return this._chunkDurationMs;
    }

    set chunkDurationMs(value: number) {
        this._chunkDurationMs = value;
        this.updateSampleBuffer();
    }

    get vadThreshold(): number {
        return this._vadThreshold;
    }

    set vadThreshold(value: number) {
        this._vadThreshold = Math.max(0, Math.min(1, value));
    }

    get useVoiceActivityDetection(): boolean {
        return this._useVoiceActivityDetection;
    }

    set useVoiceActivityDetection(value: boolean) {
        this._useVoiceActivityDetection = value;
    }

    get debugLogging(): boolean {
        return this._debugLogging;
    }

    set debugLogging(value: boolean) {
        this._debugLogging = value;
    }

    get isRecording(): boolean {
        return this._isRecording;
    }

    get currentVolume(): number {
        return this._currentVolume;
    }

    get isSpeechDetected(): boolean {
        return this._isSpeechDetected;
    }

    get targetCharacter(): EstuaryCharacter | null {
        return this._targetCharacter;
    }

    set targetCharacter(character: EstuaryCharacter | null) {
        this._targetCharacter = character;
    }

    // ==================== Public Methods ====================

    /**
     * Set the audio input control from Lens Studio.
     * @param audioInput The audio input control
     */
    /** Actual sample rate of the audio input device */
    private _inputSampleRate: number = 16000;

    setAudioInput(audioInput: AudioInputControl): void {
        this._audioInput = audioInput;
        
        // Log available methods and properties for debugging
        if (audioInput) {
            const methods: string[] = [];
            const props: string[] = [];
            for (const key in audioInput) {
                if (typeof audioInput[key] === 'function') {
                    methods.push(key);
                } else {
                    props.push(`${key}=${audioInput[key]}`);
                }
            }
            print(`[EstuaryMicrophone] Audio input methods: ${methods.join(', ')}`);
            print(`[EstuaryMicrophone] Audio input properties: ${props.join(', ')}`);
            
            // Capture the actual input sample rate for resampling
            if ('sampleRate' in audioInput && typeof audioInput['sampleRate'] === 'number') {
                this._inputSampleRate = audioInput['sampleRate'];
                print(`[EstuaryMicrophone] ========================================`);
                print(`[EstuaryMicrophone] Audio Input Configuration:`);
                print(`[EstuaryMicrophone]   Input sample rate: ${this._inputSampleRate}Hz`);
                print(`[EstuaryMicrophone]   Target sample rate: ${this._sampleRate}Hz (for Deepgram)`);
                print(`[EstuaryMicrophone]   Chunk duration: ${this._chunkDurationMs}ms`);
                
                if (this._inputSampleRate !== this._sampleRate) {
                    const ratio = this._inputSampleRate / this._sampleRate;
                    print(`[EstuaryMicrophone]   Resample ratio: ${ratio.toFixed(2)}x`);
                } else {
                    print(`[EstuaryMicrophone]   No resampling needed`);
                }
                print(`[EstuaryMicrophone] ========================================`);
            } else {
                print(`[EstuaryMicrophone] WARNING: Could not detect input sample rate, using default ${this._inputSampleRate}Hz`);
            }
        }
        
        this.updateSampleBuffer();
        this.log('Audio input configured');
    }

    /**
     * Start recording from the microphone.
     */
    startRecording(): void {
        if (this._isRecording) {
            this.log('Already recording');
            return;
        }

        if (!this._audioInput) {
            print('[EstuaryMicrophone] Warning: AudioInput not set - recording may not work');
        }

        // Start the audio input if it has a start method
        // This is required in Lens Studio to begin receiving audio frames
        if (this._audioInput && typeof this._audioInput.start === 'function') {
            try {
                this._audioInput.start();
                print('[EstuaryMicrophone] Called audioInput.start()');
            } catch (e) {
                print(`[EstuaryMicrophone] audioInput.start() error: ${e}`);
            }
        }

        this.updateSampleBuffer();
        this._bufferPosition = 0;
        this._isRecording = true;
        this._chunksSent = 0;
        this._chunksWithAudio = 0;

        this.log(`Started recording at ${this._sampleRate}Hz`);
        this.emit('recordingStarted');
    }

    /**
     * Stop recording from the microphone.
     */
    stopRecording(): void {
        if (!this._isRecording) {
            return;
        }

        // Stop the audio input if it has a stop method
        if (this._audioInput && typeof this._audioInput.stop === 'function') {
            try {
                this._audioInput.stop();
                print('[EstuaryMicrophone] Called audioInput.stop()');
            } catch (e) {
                print(`[EstuaryMicrophone] audioInput.stop() error: ${e}`);
            }
        }

        this._isRecording = false;
        this._bufferPosition = 0;
        this._isSpeechDetected = false;
        this._wasSpeaking = false;

        // Log final stats
        if (this._chunksSent > 0) {
            print(`[EstuaryMicrophone] Recording stats: sent=${this._chunksSent}, withAudio=${this._chunksWithAudio} (${((this._chunksWithAudio/this._chunksSent)*100).toFixed(1)}%)`);
        }

        this.log('Stopped recording');
        this.emit('recordingStopped');
    }

    /**
     * Toggle recording on/off.
     */
    toggleRecording(): void {
        if (this._isRecording) {
            this.stopRecording();
        } else {
            this.startRecording();
        }
    }

    /**
     * Process audio for the current frame.
     * Call this from an UpdateEvent in Lens Studio.
     * @param frameSize Number of samples to read this frame
     */
    processAudioFrame(frameSize: number): void {
        if (!this._isRecording || !this._audioInput || !this._sampleBuffer) {
            return;
        }

        // Get audio samples from input
        // Lens Studio's getAudioFrame expects a Float32Array buffer to fill
        let samples: Float32Array | null = null;
        
        // Try different audio input methods depending on Lens Studio version
        if (typeof this._audioInput.getAudioFrame === 'function') {
            try {
                // Create a buffer for the audio frame
                const frameBuffer = new Float32Array(frameSize);
                // getAudioFrame fills the buffer and returns the number of samples read
                const result = this._audioInput.getAudioFrame(frameBuffer);
                
                // Result could be a number (samples read) or the buffer itself depending on API version
                if (typeof result === 'number' && result > 0) {
                    // Create a COPY of the data (not a view with subarray)
                    // This prevents buffer corruption issues
                    samples = new Float32Array(result);
                    for (let i = 0; i < result; i++) {
                        samples[i] = frameBuffer[i];
                    }
                } else if (result instanceof Float32Array && result.length > 0) {
                    // Create a copy to be safe
                    samples = new Float32Array(result.length);
                    for (let i = 0; i < result.length; i++) {
                        samples[i] = result[i];
                    }
                } else if (frameBuffer.length > 0) {
                    // Check if the buffer was filled (non-zero values)
                    let hasData = false;
                    for (let i = 0; i < Math.min(10, frameBuffer.length); i++) {
                        if (frameBuffer[i] !== 0) {
                            hasData = true;
                            break;
                        }
                    }
                    if (hasData) {
                        // Create a copy
                        samples = new Float32Array(frameBuffer.length);
                        for (let i = 0; i < frameBuffer.length; i++) {
                            samples[i] = frameBuffer[i];
                        }
                    }
                }
            } catch (e) {
                // Log the error once
                if (this._debugLogging) {
                    print(`[EstuaryMicrophone] getAudioFrame error: ${e}`);
                }
            }
        }
        
        // Debug logging every 100 frames
        this._frameCount++;
        if (this._debugLogging && this._frameCount % 100 === 0) {
            if (samples) {
                print(`[EstuaryMicrophone] Frame ${this._frameCount}: got ${samples.length} samples`);
            } else {
                print(`[EstuaryMicrophone] Frame ${this._frameCount}: no samples available`);
            }
        }
        
        if (!samples || samples.length === 0) {
            return;
        }

        // Copy samples to buffer
        const spaceInBuffer = this._sampleBuffer.length - this._bufferPosition;
        const samplesToCopy = Math.min(samples.length, spaceInBuffer);

        for (let i = 0; i < samplesToCopy; i++) {
            this._sampleBuffer[this._bufferPosition + i] = samples[i];
        }
        this._bufferPosition += samplesToCopy;

        // Check if buffer is full (one chunk complete)
        if (this._bufferPosition >= this._sampleBuffer.length) {
            this.processAudioChunk(this._sampleBuffer);
            this._bufferPosition = 0;

            // Handle overflow - copy remaining samples to start of buffer
            const overflow = samples.length - samplesToCopy;
            if (overflow > 0) {
                for (let i = 0; i < overflow; i++) {
                    this._sampleBuffer[i] = samples[samplesToCopy + i];
                }
                this._bufferPosition = overflow;
            }
        }
    }

    /**
     * Dispose of resources.
     */
    dispose(): void {
        this.stopRecording();
        this._audioInput = null;
        this._targetCharacter = null;
        this._sampleBuffer = null;
        this.removeAllListeners();
    }

    // ==================== Private Methods ====================

    private updateSampleBuffer(): void {
        // Buffer size is based on INPUT sample rate since we collect at that rate
        // then resample to OUTPUT sample rate (16kHz for Deepgram)
        const inputRate = this._inputSampleRate || this._sampleRate;
        const samplesPerChunk = Math.floor((inputRate * this._chunkDurationMs) / 1000);
        this._sampleBuffer = new Float32Array(samplesPerChunk);
        this._bufferPosition = 0;
        
        if (this._debugLogging) {
            print(`[EstuaryMicrophone] Buffer size: ${samplesPerChunk} samples (${this._chunkDurationMs}ms @ ${inputRate}Hz)`);
        }
    }

    private processAudioChunk(samples: Float32Array): void {
        // Calculate volume
        this._currentVolume = calculateRMS(samples);
        this.emit('volumeChanged', this._currentVolume);

        // Voice activity detection
        if (this._useVoiceActivityDetection) {
            const isSpeaking = this._currentVolume > this._vadThreshold;

            if (isSpeaking && !this._wasSpeaking) {
                this._isSpeechDetected = true;
                this.emit('speechDetected');
            } else if (!isSpeaking && this._wasSpeaking) {
                this._isSpeechDetected = false;
                this.emit('silenceDetected');
            }

            this._wasSpeaking = isSpeaking;

            // Don't send audio if no speech detected
            if (!isSpeaking) {
                return;
            }
        }

        // Send audio chunk
        this.sendAudioChunk(samples);
    }

    private _chunksSent: number = 0;
    private _chunksWithAudio: number = 0;
    
    private sendAudioChunk(samples: Float32Array): void {
        if (!this._targetCharacter || !this._targetCharacter.isConnected) {
            if (this._debugLogging && this._chunksSent === 0) {
                print(`[EstuaryMicrophone] Not connected, skipping audio chunk`);
            }
            return;
        }

        // Resample if input sample rate differs from target (16kHz for Deepgram)
        let audioToSend = samples;
        if (this._inputSampleRate !== this._sampleRate) {
            audioToSend = resample(samples, this._inputSampleRate, this._sampleRate);
            // Only log first resample
            if (this._chunksSent === 0) {
                print(`[EstuaryMicrophone] Resampling: ${samples.length} @ ${this._inputSampleRate}Hz -> ${audioToSend.length} @ ${this._sampleRate}Hz`);
            }
        }

        // Check if audio has actual content (not silent)
        let maxSample = 0;
        for (let i = 0; i < audioToSend.length; i++) {
            const abs = Math.abs(audioToSend[i]);
            if (abs > maxSample) maxSample = abs;
        }
        
        if (maxSample > 0.01) {
            this._chunksWithAudio++;
        }

        // Convert to Base64 PCM16
        const base64Audio = encodeAudio(audioToSend);
        
        this._chunksSent++;
        
        // Log every 25 chunks (roughly once per second with 40ms chunks)
        if (this._debugLogging && this._chunksSent % 25 === 0) {
            print(`[EstuaryMicrophone] Stats: sent=${this._chunksSent}, withAudio=${this._chunksWithAudio}, volume=${this._currentVolume.toFixed(4)}, maxSample=${maxSample.toFixed(4)}`);
        }

        // Send to character
        this._targetCharacter.streamAudio(base64Audio);
        this.emit('audioChunkSent', audioToSend.length);
    }

    private log(message: string): void {
        if (this._debugLogging) {
            print(`[EstuaryMicrophone] ${message}`);
        }
    }
}

/**
 * Alternative microphone implementation using VoiceML for transcription.
 * This uses Lens Studio's built-in speech recognition instead of streaming audio.
 * 
 * Usage:
 * 1. Import VoiceMLModule in your project
 * 2. Use VoiceMLMicrophone to get transcriptions
 * 3. Send transcriptions as text to EstuaryCharacter
 */
export class VoiceMLMicrophone extends EventEmitter<any> {
    private _targetCharacter: EstuaryCharacter | null = null;
    private _isListening: boolean = false;

    constructor(targetCharacter?: EstuaryCharacter) {
        super();
        if (targetCharacter) {
            this._targetCharacter = targetCharacter;
        }
    }

    get targetCharacter(): EstuaryCharacter | null {
        return this._targetCharacter;
    }

    set targetCharacter(character: EstuaryCharacter | null) {
        this._targetCharacter = character;
    }

    get isListening(): boolean {
        return this._isListening;
    }

    /**
     * Handle transcription result from VoiceML.
     * Call this from your VoiceML callback.
     * @param text Transcribed text
     * @param isFinal Whether this is a final result
     */
    handleTranscription(text: string, isFinal: boolean): void {
        this.emit('transcription', text, isFinal);

        // Send final transcriptions to character
        if (isFinal && this._targetCharacter && this._targetCharacter.isConnected) {
            this._targetCharacter.sendText(text);
        }
    }

    /**
     * Notify that listening has started.
     */
    notifyStarted(): void {
        this._isListening = true;
        this.emit('started');
    }

    /**
     * Notify that listening has stopped.
     */
    notifyStopped(): void {
        this._isListening = false;
        this.emit('stopped');
    }
}

/**
 * Create an EstuaryMicrophone for use with Lens Studio.
 * 
 * Example usage in a Lens Studio script:
 * ```typescript
 * @component
 * export class MyScript extends BaseScriptComponent {
 *     @input audioInput: AudioTrackAsset;
 *     
 *     private microphone: EstuaryMicrophone;
 *     private character: EstuaryCharacter;
 *     
 *     onAwake() {
 *         this.microphone = new EstuaryMicrophone(this.character);
 *         this.microphone.setAudioInput(this.audioInput.control);
 *     }
 *     
 *     onUpdate() {
 *         this.microphone.processAudioFrame(1024);
 *     }
 * }
 * ```
 */
export function createMicrophone(
    targetCharacter: EstuaryCharacter,
    audioInputControl?: AudioInputControl
): EstuaryMicrophone {
    const mic = new EstuaryMicrophone(targetCharacter);
    if (audioInputControl) {
        mic.setAudioInput(audioInputControl);
    }
    return mic;
}





