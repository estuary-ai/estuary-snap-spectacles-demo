import { EstuaryCharacter } from './estuary-lens-studio-sdk/src/Components/EstuaryCharacter';
import { EstuaryAudioPlayer, AudioOutputControl } from './estuary-lens-studio-sdk/src/Components/EstuaryAudioPlayer';
import { EstuaryMicrophone, AudioInputControl } from './estuary-lens-studio-sdk/src/Components/EstuaryMicrophone';
import { EstuaryConfig } from './estuary-lens-studio-sdk/src/Core/EstuaryConfig';
import { BotResponse } from './estuary-lens-studio-sdk/src/Models/BotResponse';
import { SttResponse } from './estuary-lens-studio-sdk/src/Models/SttResponse';
import { SessionInfo } from './estuary-lens-studio-sdk/src/Models/SessionInfo';

@component
export class EstuaryVoiceChat extends BaseScriptComponent {
    
    // === INPUTS (Configure in Inspector) ===
    @input
    @hint("Audio Output asset for AI voice playback")
    audioOutput: AudioTrackAsset;
    
    @input
    @hint("Audio Input asset for microphone (optional)")
    audioInput: AudioTrackAsset;
    
    @input
    @hint("Text component to display conversation (optional)")
    displayText: Text;
    
    // === CONFIGURATION ===
    // TODO: Replace these with your actual values!
    private readonly SERVER_URL = 'https://api.estuary-ai.com';
    private readonly API_KEY = 'est_QZV8LFmvBgq3rBfK39x22aWL_ukR4jd_cH7vBFGr4MU';
    private readonly CHARACTER_ID = '3799f1e4-1b67-426f-a342-65d40afc89e4';
    
    // === SDK Components ===
    private character: EstuaryCharacter;
    private audioPlayer: EstuaryAudioPlayer;
    private microphone: EstuaryMicrophone;
    
    // === State ===
    private isRecording: boolean = false;
    private playerId: string;
    
    onAwake() {
        // Generate a unique player ID for this device
        this.playerId = 'spectacles_' + Date.now().toString(36);
        
        // Create the character
        this.character = new EstuaryCharacter(this.CHARACTER_ID, this.playerId);
        
        // Set up audio player
        if (this.audioOutput) {
            const outputControl = this.audioOutput.control as AudioOutputControl;
            this.audioPlayer = new EstuaryAudioPlayer(outputControl);
            this.audioPlayer.debugLogging = true;
            this.character.audioPlayer = this.audioPlayer;
        }
        
        // Set up microphone (if available)
        if (this.audioInput) {
            this.microphone = new EstuaryMicrophone(this.character);
            const inputControl = this.audioInput.control as AudioInputControl;
            this.microphone.setAudioInput(inputControl);
            this.microphone.debugLogging = true;
            this.character.microphone = this.microphone;
        }
        
        // Subscribe to events
        this.setupEventHandlers();
        
        // Create configuration and connect
        const config: EstuaryConfig = {
            serverUrl: this.SERVER_URL,
            apiKey: this.API_KEY,
            characterId: this.CHARACTER_ID,
            playerId: this.playerId,
            debugLogging: true
        };
        
        this.character.initialize(config);
        
        print('[Estuary] Initializing...');
    }
    
    private setupEventHandlers() {
        // Connected to server
        this.character.on('connected', (session: SessionInfo) => {
            print('[Estuary] Connected! Session: ' + session.sessionId);
            this.updateDisplay('Connected! Say something...');
        });
        
        // Disconnected
        this.character.on('disconnected', () => {
            print('[Estuary] Disconnected');
            this.updateDisplay('Disconnected');
        });
        
        // AI response
        this.character.on('botResponse', (response: BotResponse) => {
            if (response.isFinal) {
                print('[Estuary] AI: ' + response.text);
                this.updateDisplay('AI: ' + response.text);
            }
        });
        
        // Your speech transcribed
        this.character.on('transcript', (response: SttResponse) => {
            if (response.isFinal) {
                print('[Estuary] You: ' + response.text);
                this.updateDisplay('You: ' + response.text);
            }
        });
        
        // Error
        this.character.on('error', (error: string) => {
            print('[Estuary] Error: ' + error);
            this.updateDisplay('Error: ' + error);
        });
        
        // Audio playback
        if (this.audioPlayer) {
            this.audioPlayer.on('playbackStarted', () => {
                print('[Estuary] AI is speaking...');
            });
            
            this.audioPlayer.on('playbackComplete', () => {
                print('[Estuary] AI finished speaking');
            });
        }
    }
    
    // Call this to start recording (e.g., from a button press)
    startRecording() {
        if (!this.character.isConnected) {
            print('[Estuary] Not connected yet!');
            return;
        }
        
        if (this.isRecording) return;
        
        this.isRecording = true;
        this.character.startVoiceSession();
        print('[Estuary] Recording started...');
        this.updateDisplay('Listening...');
    }
    
    // Call this to stop recording (e.g., from a button release)
    stopRecording() {
        if (!this.isRecording) return;
        
        this.isRecording = false;
        this.character.endVoiceSession();
        print('[Estuary] Recording stopped');
    }
    
    // Send a text message instead of voice
    sendMessage(text: string) {
        if (!this.character.isConnected) {
            print('[Estuary] Not connected yet!');
            return;
        }
        
        this.character.sendText(text);
        this.updateDisplay('You: ' + text);
    }
    
    onUpdate() {
        // Process audio each frame
        if (this.microphone && this.isRecording) {
            this.microphone.processAudioFrame(1024);
        }
        
        if (this.audioPlayer) {
            this.audioPlayer.processAudioFrame();
        }
    }
    
    private updateDisplay(text: string) {
        if (this.displayText) {
            this.displayText.text = text;
        }
    }
    
    onDestroy() {
        if (this.character) this.character.dispose();
        if (this.audioPlayer) this.audioPlayer.dispose();
        if (this.microphone) this.microphone.dispose();
    }
}