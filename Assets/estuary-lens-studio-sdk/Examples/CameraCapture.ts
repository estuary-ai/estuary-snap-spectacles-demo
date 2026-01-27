/**
 * CameraCapture - Example component for handling camera capture requests.
 * 
 * This example shows how to respond to the server's camera capture requests,
 * capture an image from the device camera, and send it back for vision analysis.
 * 
 * Setup in Lens Studio:
 * 1. Add a Device Camera Texture to your scene (Resources > Create > Textures > Device Camera Texture)
 * 2. Create a Scene Object and add this script
 * 3. Drag the Device Camera Texture to the "Camera Texture" field in the Inspector
 * 4. Make sure you have an EstuaryCredentials and EstuaryCharacter set up
 * 
 * Usage:
 * When connected, say something like "What am I looking at?" or "Turn on the camera"
 * The server will detect the vision intent and request a camera capture.
 * This component will automatically capture and send the image.
 */

import { EstuaryManager } from '../src/Components/EstuaryManager';
import { CameraCaptureRequest } from '../src/Core/EstuaryEvents';

@component
export class CameraCapture extends BaseScriptComponent {
    
    // ==================== Configuration ====================
    
    /**
     * The device camera texture to capture from.
     * Create this in Lens Studio: Resources > Create > Textures > Device Camera Texture
     */
    @input
    @hint("Device Camera Texture from your scene")
    cameraTexture: Texture;
    
    /**
     * Enable debug logging
     */
    @input
    @hint("Enable debug logging")
    debugMode: boolean = true;
    
    // ==================== State ====================
    
    private _pendingRequest: CameraCaptureRequest | null = null;
    private _isSubscribed: boolean = false;
    
    // ==================== Lifecycle ====================
    
    onAwake() {
        this.log('CameraCapture initializing...');
        
        // Validate camera texture
        if (!this.cameraTexture) {
            this.logError('No camera texture assigned! Please add a Device Camera Texture.');
            return;
        }
        
        // Wait a frame for EstuaryManager to initialize
        this.createEvent('OnStartEvent').bind(() => {
            this.subscribeToEvents();
        });
    }
    
    private subscribeToEvents(): void {
        if (this._isSubscribed) return;
        
        const manager = EstuaryManager.instance;
        if (!manager) {
            this.logError('EstuaryManager not found! Make sure it is initialized first.');
            return;
        }
        
        // Subscribe to camera capture requests from the server
        manager.on('cameraCaptureRequest', (request: CameraCaptureRequest) => {
            this.handleCaptureRequest(request);
        });
        
        this._isSubscribed = true;
        this.log('✅ Subscribed to camera capture requests');
        this.log('Say "What am I looking at?" to trigger camera capture');
    }
    
    // ==================== Camera Capture ====================
    
    /**
     * Handle a camera capture request from the server.
     */
    private handleCaptureRequest(request: CameraCaptureRequest): void {
        print('');
        print('📸 ================================================');
        print('📸 CAMERA CAPTURE REQUEST RECEIVED!');
        print(`📸 Request ID: ${request.request_id}`);
        print(`📸 Context: ${request.text || '(none)'}`);
        print('📸 Capturing image...');
        print('📸 ================================================');
        print('');
        
        this._pendingRequest = request;
        
        // Capture on next frame to ensure camera has latest image
        this.createEvent('UpdateEvent').bind(() => {
            this.captureAndSend();
        });
    }
    
    /**
     * Capture the current camera frame and send it to the server.
     */
    private captureAndSend(): void {
        try {
            const imageBase64 = this.captureToBase64();
            
            if (!imageBase64) {
                this.logError('Failed to capture camera image');
                this._pendingRequest = null;
                return;
            }
            
            this.log(`📸 Captured image: ${imageBase64.length} base64 chars`);
            
            // Send to server via EstuaryManager
            const manager = EstuaryManager.instance;
            if (!manager) {
                this.logError('EstuaryManager not available');
                return;
            }
            
            manager.sendCameraImage(
                imageBase64,
                'image/jpeg',
                this._pendingRequest?.request_id,
                this._pendingRequest?.text
            );
            
            print('📸 Image sent to server for analysis!');
            this._pendingRequest = null;
            
        } catch (e) {
            this.logError(`Error capturing camera: ${e}`);
            this._pendingRequest = null;
        }
    }
    
    /**
     * Capture the current camera frame to a base64 string.
     * @returns Base64-encoded JPEG image, or null if capture failed
     */
    private captureToBase64(): string | null {
        try {
            if (!this.cameraTexture) {
                this.logError('No camera texture configured');
                return null;
            }
            
            // Method 1: Use Lens Studio's Base64 global API
            // @ts-ignore - Lens Studio global API
            if (typeof Base64 !== 'undefined' && Base64.encode) {
                // @ts-ignore
                const encoded = Base64.encode(this.cameraTexture);
                this.log('Used Base64.encode() for texture encoding');
                return encoded;
            }
            
            // Method 2: Check for encodeToBase64 on texture
            // @ts-ignore
            if (this.cameraTexture.encodeToBase64) {
                // @ts-ignore
                const encoded = this.cameraTexture.encodeToBase64();
                this.log('Used texture.encodeToBase64() for encoding');
                return encoded;
            }
            
            // Method 3: Use EncodeTexture API if available
            // @ts-ignore
            if (typeof EncodeTexture !== 'undefined') {
                // @ts-ignore
                const encoded = EncodeTexture.encodeToBase64(this.cameraTexture, 'jpeg', 85);
                this.log('Used EncodeTexture API for encoding');
                return encoded;
            }
            
            this.logError('No texture encoding method available in this Lens Studio version');
            return null;
            
        } catch (e) {
            this.logError(`Failed to encode texture: ${e}`);
            return null;
        }
    }
    
    /**
     * Manually trigger a camera capture (for testing).
     * Call this from another script or via a tap event.
     */
    manualCapture(text?: string): void {
        this.log('Manual capture triggered');
        this._pendingRequest = {
            request_id: 'manual-' + Date.now(),
            text: text || 'What do you see?'
        };
        this.captureAndSend();
    }
    
    // ==================== Logging ====================
    
    private log(message: string): void {
        if (this.debugMode) {
            print(`[CameraCapture] ${message}`);
        }
    }
    
    private logError(message: string): void {
        print(`[CameraCapture] ERROR: ${message}`);
    }
}
