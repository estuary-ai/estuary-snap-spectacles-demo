/**
 * SimpleAutoConnect.ts
 * 
 * Auto-connects to Estuary and streams microphone audio continuously.
 * VAD is handled by the backend (Deepgram), so we just stream everything.
 * 
 * Setup in Lens Studio:
 * 1. Create a new Script component on a SceneObject
 * 2. Add an "Internet Module" to your scene (Asset Library > Helper Scripts)
 *    Note: As of Lens Studio 5.9, use InternetModule instead of RemoteServiceModule
 * 3. Assign this script to the component
 * 4. Connect the Internet Module in the Inspector
 * 5. Create AudioTrackAssets for microphone input and speaker output
 * 6. Set the serverUrl and characterId in the Inspector
 */

import { EstuaryCharacter } from '../src/Components/EstuaryCharacter';
import { EstuaryMicrophone, AudioInputControl } from '../src/Components/EstuaryMicrophone';
import { EstuaryAudioPlayer, AudioOutputControl } from '../src/Components/EstuaryAudioPlayer';
import { EstuaryConfig } from '../src/Core/EstuaryConfig';
import { SessionInfo } from '../src/Models/SessionInfo';
import { BotResponse } from '../src/Models/BotResponse';
import { SttResponse } from '../src/Models/SttResponse';
import { setInternetModule } from '../src/Core/EstuaryClient';

@component
export class SimpleAutoConnect extends BaseScriptComponent {
    
    // ==================== Configuration (set in Inspector) ====================
    
    /** Internet Module - REQUIRED for WebSocket connections on Spectacles */
    @input
    @hint("Add Internet Module from Asset Library > Helper Scripts")
    internetModule: InternetModule;
    
    /** Your Estuary server URL */
    @input
    @hint("Estuary server WebSocket URL")
    serverUrl: string = "ws://localhost:4001";
    
    /** The character/agent ID to connect to */
    @input
    @hint("Character/Agent ID from your Estuary backend")
    characterId: string = "3799f1e4-1b67-426f-a342-65d40afc89e4";
    
    /** Audio input for microphone streaming */
    @input
    @hint("AudioTrackAsset for microphone input")
    audioInput: AudioTrackAsset;
    
    /** Audio output for AI voice playback */
    @input
    @hint("AudioTrackAsset for speaker output")
    audioOutput: AudioTrackAsset;
    
    /** Optional: API key if your server requires it */
    @input
    apiKey: string = "est_QZV8LFmvBgq3rBfK39x22aWL_ukR4jd_cH7vBFGr4MU";
    
    /** Enable debug logging */
    @input
    debugMode: boolean = true;
    
    // ==================== Private Members ====================
    
    private character: EstuaryCharacter | null = null;
    private microphone: EstuaryMicrophone | null = null;
    private audioPlayer: EstuaryAudioPlayer | null = null;
    private playerId: string = "";
    private updateEvent: SceneEvent | null = null;
    
    // ==================== Lifecycle ====================
    
    onAwake() {
        this.log("Initializing...");
        
        // Generate a unique player ID
        this.playerId = "spectacles_" + Date.now().toString(36);
        
        // Set up the update loop for audio processing
        this.updateEvent = this.createEvent("UpdateEvent");
        this.updateEvent.bind(() => this.onUpdate());
        
        // Connect immediately
        this.connect();
    }
    
    onDestroy() {
        this.disconnect();
    }
    
    // ==================== Connection ====================
    
    private connect(): void {
        print("[SimpleAutoConnect] connect() called");
        
        if (!this.internetModule) {
            print("[SimpleAutoConnect] ERROR: InternetModule is required!");
            print("[SimpleAutoConnect] Add 'Internet Module' from Asset Library > Helper Scripts");
            print("[SimpleAutoConnect] Then connect it in the Inspector");
            return;
        }
        
        if (!this.characterId) {
            print("[SimpleAutoConnect] ERROR: characterId is required!");
            return;
        }
        
        // Set the internet module for WebSocket creation
        // Note: As of Lens Studio 5.9, createWebSocket was moved from RemoteServiceModule to InternetModule
        setInternetModule(this.internetModule);
        
        print(`[SimpleAutoConnect] Connecting to ${this.serverUrl}...`);
        print(`[SimpleAutoConnect] Character ID: ${this.characterId}`);
        
        try {
            // Create the character
            print("[SimpleAutoConnect] Creating EstuaryCharacter...");
            this.character = new EstuaryCharacter(this.characterId, this.playerId);
            print("[SimpleAutoConnect] EstuaryCharacter created");
            
            // Create microphone (VAD disabled - backend handles it)
            print("[SimpleAutoConnect] Creating microphone...");
            this.microphone = new EstuaryMicrophone(this.character);
            this.microphone.useVoiceActivityDetection = false; // Backend has Deepgram VAD
            this.microphone.debugLogging = this.debugMode;
            print("[SimpleAutoConnect] Microphone created");
            
            // Set up audio input (microphone)
            if (this.audioInput) {
                print("[SimpleAutoConnect] Setting up audio input...");
                const inputControl = this.audioInput.control as AudioInputControl;
                this.microphone.setAudioInput(inputControl);
                this.character.microphone = this.microphone;
                print("[SimpleAutoConnect] Audio input configured");
            } else {
                print("[SimpleAutoConnect] WARNING: No audioInput assigned - mic streaming won't work");
            }
            
            // Set up audio output (speaker for AI voice)
            if (this.audioOutput) {
                print("[SimpleAutoConnect] Setting up audio output...");
                const outputControl = this.audioOutput.control as AudioOutputControl;
                this.audioPlayer = new EstuaryAudioPlayer(outputControl);
                this.audioPlayer.debugLogging = this.debugMode;
                this.character.audioPlayer = this.audioPlayer;
                print("[SimpleAutoConnect] Audio output configured");
            } else {
                print("[SimpleAutoConnect] WARNING: No audioOutput assigned - AI voice won't play");
            }
            
            // Set up event handlers
            print("[SimpleAutoConnect] Setting up event handlers...");
            this.setupEventHandlers();
            print("[SimpleAutoConnect] Event handlers configured");
            
            // Connect
            print("[SimpleAutoConnect] Creating config and initializing...");
            const config: EstuaryConfig = {
                serverUrl: this.serverUrl,
                apiKey: this.apiKey,
                characterId: this.characterId,
                playerId: this.playerId,
                debugLogging: this.debugMode
            };
            
            print("[SimpleAutoConnect] Calling character.initialize()...");
            this.character.initialize(config);
            print("[SimpleAutoConnect] initialize() called - waiting for connection...");
            
        } catch (e) {
            print("[SimpleAutoConnect] ERROR in connect(): " + e);
        }
    }
    
    private disconnect(): void {
        if (this.microphone) {
            this.microphone.stopRecording();
            this.microphone.dispose();
            this.microphone = null;
        }
        if (this.audioPlayer) {
            this.audioPlayer.dispose();
            this.audioPlayer = null;
        }
        if (this.character) {
            this.character.dispose();
            this.character = null;
        }
    }
    
    // ==================== Event Handlers ====================
    
    private setupEventHandlers(): void {
        if (!this.character) return;
        
        // Connected - start streaming mic immediately
        this.character.on('connected', (session: SessionInfo) => {
            print("===========================================");
            print("  Connected! Starting mic stream...");
            print(`  Session: ${session.sessionId}`);
            print("===========================================");
            
            // Start voice session (required for audio streaming)
            this.character.startVoiceSession();
            
            // Send a greeting to verify the response pipeline works
            // This bypasses the microphone to test if AI responses work
            print("[SimpleAutoConnect] Sending initial greeting to AI...");
            this.character.sendText("Hey there! I'm testing the voice chat.");
            
            // Start mic streaming immediately
            this.startMicStream();
        });
        
        // Disconnected
        this.character.on('disconnected', () => {
            this.log("Disconnected");
            if (this.microphone) {
                this.microphone.stopRecording();
            }
        });
        
        // AI response
        this.character.on('botResponse', (response: BotResponse) => {
            if (response.isFinal) {
                print(`[AI] ${response.text}`);
            }
        });
        
        // STT from Deepgram
        this.character.on('transcript', (stt: SttResponse) => {
            if (stt.isFinal) {
                print(`[You] ${stt.text}`);
            }
        });
        
        // Errors
        this.character.on('error', (error: string) => {
            print(`[SimpleAutoConnect] Error: ${error}`);
        });
        
        // Connection state changes (for debugging)
        this.character.on('connectionStateChanged', (state: any) => {
            print(`[SimpleAutoConnect] Connection state changed: ${state}`);
        });
    }
    
    private startMicStream(): void {
        if (this.microphone) {
            this.microphone.startRecording();
            this.log("Mic streaming started");
        }
    }
    
    // ==================== Update Loop ====================
    
    private onUpdate(): void {
        // Process microphone input (send to server)
        if (this.microphone && this.microphone.isRecording) {
            this.microphone.processAudioFrame(1024);
        }
        
        // Process audio output (play AI voice)
        if (this.audioPlayer) {
            this.audioPlayer.processAudioFrame();
        }
    }
    
    // ==================== Public Methods ====================
    
    /** Send a text message to the AI */
    sendMessage(text: string): void {
        if (this.character?.isConnected) {
            this.character.sendText(text);
        }
    }
    
    // ==================== Utility ====================
    
    private log(message: string): void {
        if (this.debugMode) {
            print(`[SimpleAutoConnect] ${message}`);
        }
    }
}
