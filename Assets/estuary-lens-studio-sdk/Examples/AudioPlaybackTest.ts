/**
 * Minimal Audio Playback Test for Lens Studio
 * 
 * This script tests audio output independently from the Estuary SDK.
 * It generates a simple sine wave tone and attempts to play it.
 * 
 * Setup in Lens Studio:
 * 1. Create a new Script component
 * 2. Attach this script
 * 3. Create an Audio Track asset (Output type)
 * 4. Create an Audio component, assign the Audio Track
 * 5. Assign the Audio Track's control to this script's audioOutput
 */

@component
export class AudioPlaybackTest extends BaseScriptComponent {
    
    @input
    @hint("Audio Track asset with Output type")
    audioTrack: AudioTrackAsset;
    
    @input
    @hint("Audio Component that will play the audio")
    audioComponent: AudioComponent;
    
    @input
    @hint("Sample rate for generated audio (use 44100 to match Lens Studio default)")
    sampleRate: number = 44100;
    
    @input
    @hint("Frequency of test tone in Hz")
    toneFrequency: number = 440; // A4 note
    
    @input
    @hint("Duration of test tone in seconds")
    toneDuration: number = 2.0;
    
    private _audioControl: any = null;
    private _testAudio: Float32Array | null = null;
    private _playbackPosition: number = 0;
    private _isPlaying: boolean = false;
    private _updateEvent: SceneEvent | null = null;
    private _frameCount: number = 0;
    private _workingApproach: number = -1;
    private _totalEnqueueAttempts: number = 0;
    private _successfulEnqueues: number = 0;
    
    onAwake() {
        print("===========================================");
        print("  AUDIO PLAYBACK TEST");
        print("===========================================");
        
        // Get audio control from the AudioTrackAsset
        if (this.audioTrack) {
            print("[AudioTest] AudioTrack asset assigned");
            print(`[AudioTest] AudioTrack type: ${typeof this.audioTrack}`);
            
            // Try different ways to get the control
            if ((this.audioTrack as any).control) {
                this._audioControl = (this.audioTrack as any).control;
                print("[AudioTest] Got control from audioTrack.control");
            } else {
                // The audioTrack itself might be the control
                this._audioControl = this.audioTrack;
                print("[AudioTest] Using audioTrack directly as control");
            }
            
            // Log available methods
            this.logAudioControlInfo();
        } else {
            print("[AudioTest] ERROR: No audioTrack assigned!");
            print("[AudioTest] Please assign an AudioTrack asset with Output type");
        }
        
        // Log audio component info
        if (this.audioComponent) {
            print("[AudioTest] AudioComponent assigned");
            this.logAudioComponentInfo();
        } else {
            print("[AudioTest] WARNING: No audioComponent assigned");
            print("[AudioTest] Audio may not play without an AudioComponent");
        }
        
        // Generate test tone
        this.generateTestTone();
        
        // Set up update loop
        this._updateEvent = this.createEvent("UpdateEvent");
        this._updateEvent.bind(() => this.onUpdate());
        
        // Start playback after a short delay
        const delayEvent = this.createEvent("DelayedCallbackEvent");
        delayEvent.bind(() => {
            print("[AudioTest] ========== STARTING PLAYBACK TEST ==========");
            // Reset frame count so we log the first approach attempts
            this._frameCount = 0;
            this._isPlaying = true;
        });
        (delayEvent as any).reset(1.0); // 1 second delay
    }
    
    private logAudioComponentInfo(): void {
        print("[AudioTest] ---------- Audio Component Info ----------");
        
        const methods: string[] = [];
        const props: string[] = [];
        
        try {
            for (const key in this.audioComponent) {
                try {
                    if (typeof (this.audioComponent as any)[key] === 'function') {
                        methods.push(key);
                    } else {
                        const value = (this.audioComponent as any)[key];
                        const valueStr = typeof value === 'object' ? '[object]' : String(value);
                        props.push(`${key}=${valueStr}`);
                    }
                } catch (e) {
                    props.push(`${key}=[error reading]`);
                }
            }
        } catch (e) {
            print(`[AudioTest] Error enumerating component: ${e}`);
        }
        
        print(`[AudioTest] Methods: ${methods.length > 0 ? methods.join(', ') : 'none found'}`);
        print(`[AudioTest] Properties: ${props.length > 0 ? props.join(', ') : 'none found'}`);
        print("[AudioTest] ----------------------------------------");
    }
    
    private logAudioControlInfo(): void {
        print("[AudioTest] ---------- Audio Control Info ----------");
        print(`[AudioTest] Control type: ${typeof this._audioControl}`);
        print(`[AudioTest] Control constructor: ${this._audioControl?.constructor?.name || 'unknown'}`);
        
        const methods: string[] = [];
        const props: string[] = [];
        
        try {
            for (const key in this._audioControl) {
                try {
                    if (typeof this._audioControl[key] === 'function') {
                        methods.push(key);
                    } else {
                        const value = this._audioControl[key];
                        const valueStr = typeof value === 'object' ? '[object]' : String(value);
                        props.push(`${key}=${valueStr}`);
                    }
                } catch (e) {
                    props.push(`${key}=[error reading]`);
                }
            }
        } catch (e) {
            print(`[AudioTest] Error enumerating control: ${e}`);
        }
        
        print(`[AudioTest] Methods: ${methods.length > 0 ? methods.join(', ') : 'none found'}`);
        print(`[AudioTest] Properties: ${props.length > 0 ? props.join(', ') : 'none found'}`);
        
        // Check for specific methods we need
        print("[AudioTest] ---------- API Checks ----------");
        
        if (typeof this._audioControl.enqueueAudioFrame === 'function') {
            print("[AudioTest]   ✓ enqueueAudioFrame is available");
        } else {
            print("[AudioTest]   ✗ enqueueAudioFrame NOT available - audio won't play!");
        }
        
        if (typeof this._audioControl.allocateAudioFrame === 'function') {
            print("[AudioTest]   ✓ allocateAudioFrame is available");
        } else {
            print("[AudioTest]   ✗ allocateAudioFrame not available");
        }
        
        if (typeof this._audioControl.putAudioFrame === 'function') {
            print("[AudioTest]   ✓ putAudioFrame is available");
        } else {
            print("[AudioTest]   ✗ putAudioFrame not available");
        }
        
        if (typeof this._audioControl.getPreferredFrameSize === 'function') {
            try {
                const frameSize = this._audioControl.getPreferredFrameSize();
                print(`[AudioTest]   ✓ getPreferredFrameSize = ${frameSize}`);
            } catch (e) {
                print(`[AudioTest]   ✗ getPreferredFrameSize error: ${e}`);
            }
        }
        
        // Check and set sample rate
        if ('sampleRate' in this._audioControl) {
            print(`[AudioTest]   Current sample rate: ${this._audioControl.sampleRate}`);
            try {
                this._audioControl.sampleRate = this.sampleRate;
                print(`[AudioTest]   ✓ Set sample rate to: ${this.sampleRate}`);
            } catch (e) {
                print(`[AudioTest]   ✗ Failed to set sample rate: ${e}`);
            }
        } else {
            print("[AudioTest]   sampleRate property not found");
        }
        
        // Check global audio types
        print("[AudioTest] ---------- Global Audio Types ----------");
        if (typeof (global as any).Float32AudioFrame !== 'undefined') {
            print("[AudioTest]   ✓ Float32AudioFrame is available");
        }
        if (typeof (global as any).AudioFrame !== 'undefined') {
            print("[AudioTest]   ✓ AudioFrame is available");
        }
        
        print("[AudioTest] ----------------------------------------");
    }
    
    private generateTestTone(): void {
        const numSamples = Math.floor(this.sampleRate * this.toneDuration);
        this._testAudio = new Float32Array(numSamples);
        
        const angularFrequency = 2 * Math.PI * this.toneFrequency / this.sampleRate;
        
        for (let i = 0; i < numSamples; i++) {
            // Generate sine wave
            const sample = Math.sin(angularFrequency * i);
            
            // Apply fade in/out to avoid clicks (100ms fade)
            const fadeLength = Math.floor(this.sampleRate * 0.1);
            let amplitude = 0.3; // Keep volume moderate
            
            if (i < fadeLength) {
                amplitude *= i / fadeLength; // Fade in
            } else if (i > numSamples - fadeLength) {
                amplitude *= (numSamples - i) / fadeLength; // Fade out
            }
            
            this._testAudio[i] = sample * amplitude;
        }
        
        print(`[AudioTest] Generated ${numSamples} samples (${this.toneDuration}s @ ${this.sampleRate}Hz)`);
        print(`[AudioTest] Tone frequency: ${this.toneFrequency}Hz`);
    }
    
    private onUpdate(): void {
        this._frameCount++;
        
        if (!this._isPlaying || !this._audioControl || !this._testAudio) {
            return;
        }
        
        // Get preferred frame size
        let frameSize = 1024;
        if (typeof this._audioControl.getPreferredFrameSize === 'function') {
            const preferredSize = this._audioControl.getPreferredFrameSize();
            if (preferredSize > 0) {
                frameSize = preferredSize;
            }
        }
        
        // Check if we're done
        if (this._playbackPosition >= this._testAudio.length) {
            if (this._isPlaying) {
                print("[AudioTest] ========== PLAYBACK COMPLETE ==========");
                this._isPlaying = false;
                this.printSummary();
            }
            return;
        }
        
        // Calculate how many samples to send
        const remainingSamples = this._testAudio.length - this._playbackPosition;
        const samplesToSend = Math.min(frameSize, remainingSamples);
        
        // Create frame buffer
        const frameData = new Float32Array(samplesToSend);
        for (let i = 0; i < samplesToSend; i++) {
            frameData[i] = this._testAudio[this._playbackPosition + i];
        }
        
        // Log first few frame details
        if (this._totalEnqueueAttempts <= 6) {
            print(`[AudioTest] Frame: ${samplesToSend} samples, preferredFrameSize=${frameSize}`);
            print(`[AudioTest] Sample values: [${frameData[0].toFixed(4)}, ${frameData[1].toFixed(4)}, ... ${frameData[samplesToSend-1].toFixed(4)}]`);
        }
        
        // Try to enqueue the audio
        this.tryEnqueueAudio(frameData, samplesToSend);
        
        this._playbackPosition += samplesToSend;
        
        // Log progress every second (assuming ~30fps)
        if (this._frameCount % 30 === 0) {
            const progress = (this._playbackPosition / this._testAudio.length * 100).toFixed(1);
            print(`[AudioTest] Progress: ${progress}% (${this._successfulEnqueues}/${this._totalEnqueueAttempts} successful)`);
        }
    }
    
    private tryEnqueueAudio(frameData: Float32Array, numSamples: number): void {
        this._totalEnqueueAttempts++;
        
        if (typeof this._audioControl.enqueueAudioFrame !== 'function') {
            if (this._totalEnqueueAttempts === 1) {
                print("[AudioTest] ERROR: enqueueAudioFrame not available!");
            }
            return;
        }
        
        // If we already found a working approach, use it
        if (this._workingApproach >= 0) {
            this.executeApproach(this._workingApproach, frameData, numSamples, false);
            return;
        }
        
        // Define different approaches to try
        const approachCount = 6;
        
        // On first few attempts, try each approach (always log results)
        if (this._totalEnqueueAttempts <= approachCount) {
            const approachIndex = this._totalEnqueueAttempts - 1;
            print(`[AudioTest] Trying approach ${approachIndex + 1}...`);
            const success = this.executeApproach(approachIndex, frameData, numSamples, true);
            if (success && this._workingApproach < 0) {
                this._workingApproach = approachIndex;
                print(`[AudioTest] ✓ Will use approach ${approachIndex + 1} for subsequent frames`);
            }
        } else {
            // After trying all approaches, just try approach 0 silently
            this.executeApproach(0, frameData, numSamples, false);
        }
    }
    
    private executeApproach(index: number, frameData: Float32Array, numSamples: number, logResult: boolean): boolean {
        try {
            switch (index) {
                case 0:
                    // Approach 1: shape as object {x, y, z}
                    this._audioControl.enqueueAudioFrame(frameData, { x: numSamples, y: 1, z: 1 });
                    if (logResult) print(`[AudioTest] Approach 1 (shape {x,y,z}): ✓ SUCCESS`);
                    break;
                    
                case 1:
                    // Approach 2: shape as vec3
                    const shape = new vec3(numSamples, 1, 1);
                    this._audioControl.enqueueAudioFrame(frameData, shape);
                    if (logResult) print(`[AudioTest] Approach 2 (vec3 shape): ✓ SUCCESS`);
                    break;
                    
                case 2:
                    // Approach 3: just the data, no shape
                    this._audioControl.enqueueAudioFrame(frameData);
                    if (logResult) print(`[AudioTest] Approach 3 (data only): ✓ SUCCESS`);
                    break;
                    
                case 3:
                    // Approach 4: Try to get native buffer from audio control
                    if (typeof this._audioControl.allocateAudioFrame === 'function') {
                        const nativeBuffer = this._audioControl.allocateAudioFrame(numSamples);
                        for (let i = 0; i < numSamples; i++) {
                            nativeBuffer[i] = frameData[i];
                        }
                        this._audioControl.enqueueAudioFrame(nativeBuffer, { x: numSamples, y: 1, z: 1 });
                        if (logResult) print(`[AudioTest] Approach 4 (allocateAudioFrame): ✓ SUCCESS`);
                    } else {
                        throw new Error("allocateAudioFrame not available");
                    }
                    break;
                    
                case 4:
                    // Approach 5: Use putAudioFrame if available
                    if (typeof this._audioControl.putAudioFrame === 'function') {
                        this._audioControl.putAudioFrame(frameData, { x: numSamples, y: 1, z: 1 });
                        if (logResult) print(`[AudioTest] Approach 5 (putAudioFrame): ✓ SUCCESS`);
                    } else {
                        throw new Error("putAudioFrame not available");
                    }
                    break;
                    
                case 5:
                    // Approach 6: Try Float32AudioFrame if available
                    if (typeof (global as any).Float32AudioFrame !== 'undefined') {
                        const audioFrame = new (global as any).Float32AudioFrame(numSamples, 1, 1);
                        for (let i = 0; i < numSamples; i++) {
                            audioFrame.data[i] = frameData[i];
                        }
                        this._audioControl.enqueueAudioFrame(audioFrame);
                        if (logResult) print(`[AudioTest] Approach 6 (Float32AudioFrame): ✓ SUCCESS`);
                    } else {
                        throw new Error("Float32AudioFrame not available");
                    }
                    break;
                    
                default:
                    throw new Error("Unknown approach");
            }
            
            this._successfulEnqueues++;
            return true;
            
        } catch (e) {
            // Always log errors for the first 6 approaches so we can diagnose
            print(`[AudioTest] Approach ${index + 1}: ✗ FAILED`);
            print(`[AudioTest]   Error: ${e}`);
            if (e && typeof e === 'object' && 'stack' in e) {
                print(`[AudioTest]   Stack: ${(e as any).stack}`);
            }
            return false;
        }
    }
    
    private printSummary(): void {
        print("===========================================");
        print("  AUDIO TEST SUMMARY");
        print("===========================================");
        print(`[AudioTest] Total enqueue attempts: ${this._totalEnqueueAttempts}`);
        print(`[AudioTest] Successful enqueues: ${this._successfulEnqueues}`);
        print(`[AudioTest] Working approach: ${this._workingApproach >= 0 ? this._workingApproach + 1 : 'None found'}`);
        print(`[AudioTest] Frames processed: ${this._frameCount}`);
        
        if (this._successfulEnqueues > 0) {
            print("[AudioTest] ✓ Audio enqueue API is working");
            print("[AudioTest] If you didn't hear the tone, check:");
            print("[AudioTest]   - Audio component volume is > 0");
            print("[AudioTest]   - Audio is not muted in preview");
            print("[AudioTest]   - Spectacles hardware audio output");
        } else {
            print("[AudioTest] ✗ No audio frames were successfully enqueued");
            print("[AudioTest] This may be a Lens Studio API compatibility issue");
        }
        print("===========================================");
    }
}

