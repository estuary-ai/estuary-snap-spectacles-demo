/**
 * ConnectionIndicator.ts
 *
 * Displays a colored sphere on the user's palm to show server connection status.
 * - Red:    Not connected to the Estuary backend
 * - Yellow: Connecting / reconnecting
 * - Green:  Successfully connected
 * - Dark red: Error state
 *
 * Setup in Lens Studio:
 * 1. Create an ObjectTracking3D SceneObject with a Hand Tracking 3D asset
 * 2. Add a Sphere mesh to the scene (scale it small, e.g. 0.5)
 * 3. Create an Unlit material and assign it to the sphere
 * 4. Attach this script to any SceneObject
 * 5. Wire up the inputs in the Inspector:
 *    - handTracking → the ObjectTracking3D component
 *    - indicatorObject → the sphere SceneObject
 *    - indicatorMaterial → the unlit material on the sphere
 */

import { EstuaryManager } from "../estuary-lens-studio-sdk/src/Components/EstuaryManager";
import { ConnectionState } from "../estuary-lens-studio-sdk/src/Core/EstuaryEvents";

@component
export class ConnectionIndicator extends BaseScriptComponent {

    // ==================== Configuration (set in Inspector) ====================

    @input
    @hint("ObjectTracking3D component for hand tracking")
    handTracking: ObjectTracking3D;

    @input
    @hint("The sphere SceneObject used as the indicator")
    indicatorObject: SceneObject;

    @input
    @hint("Material on the indicator sphere (will change baseColor)")
    indicatorMaterial: Material;

    @input
    @hint("Enable debug logging")
    debugLogging: boolean = false;

    // ==================== Colors ====================

    /** Red = disconnected */
    private readonly COLOR_DISCONNECTED: vec4 = new vec4(1, 0, 0, 1);

    /** Yellow = connecting / reconnecting */
    private readonly COLOR_CONNECTING: vec4 = new vec4(1, 0.8, 0, 1);

    /** Green = connected */
    private readonly COLOR_CONNECTED: vec4 = new vec4(0, 1, 0, 1);

    /** Dark red = error */
    private readonly COLOR_ERROR: vec4 = new vec4(0.6, 0, 0, 1);

    // ==================== State ====================

    private _material: Material | null = null;
    private _lastState: ConnectionState = ConnectionState.Disconnected;
    private _attached: boolean = false;

    // ==================== Lifecycle ====================

    onAwake() {
        // Resolve the material to modify
        this._material = this.resolveMaterial();
        if (!this._material) {
            print("[ConnectionIndicator] ERROR: No material found! Assign indicatorMaterial or indicatorObject with a material.");
            return;
        }

        // Set initial color to red (disconnected)
        this.setColor(this.COLOR_DISCONNECTED);

        // Attach the indicator sphere to the palm via script
        this.attachToPalm();

        // Poll connection state every frame
        const updateEvent = this.createEvent("UpdateEvent");
        updateEvent.bind(() => this.onUpdate());

        this.log("Initialized — waiting for connection...");
    }

    // ==================== Hand Attachment ====================

    /**
     * Programmatically attach the indicator sphere to the hand_center
     * (palm center) joint on the tracked hand.
     */
    private attachToPalm(): void {
        if (!this.handTracking) {
            this.log("No handTracking input — sphere will stay where it is in the scene");
            return;
        }

        if (!this.indicatorObject) {
            this.log("No indicatorObject — nothing to attach");
            return;
        }

        // Attach the sphere to the hand_center joint (palm center)
        this.handTracking.addAttachmentPoint("hand_center", this.indicatorObject);
        this._attached = true;
        this.log("Attached indicator to hand_center (palm)");
    }

    // ==================== Material Resolution ====================

    private resolveMaterial(): Material | null {
        // Prefer directly-assigned material input
        if (this.indicatorMaterial) {
            return this.indicatorMaterial;
        }

        // Try to get material from the indicator object's mesh visual
        const obj = this.indicatorObject || this.getSceneObject();
        if (obj) {
            const meshVisual = obj.getComponent("Component.RenderMeshVisual") as RenderMeshVisual;
            if (meshVisual && meshVisual.getMaterialsCount() > 0) {
                return meshVisual.getMaterial(0);
            }
        }

        return null;
    }

    // ==================== Update Loop ====================

    private onUpdate(): void {
        // Wait for EstuaryManager singleton to be created by SimpleAutoConnect
        if (!EstuaryManager.hasInstance) {
            return;
        }

        const currentState = EstuaryManager.instance.connectionState;

        // Only update color when state actually changes
        if (currentState !== this._lastState) {
            this._lastState = currentState;
            this.onConnectionStateChanged(currentState);
        }
    }

    // ==================== Connection State ====================

    private onConnectionStateChanged(state: ConnectionState): void {
        this.log(`Connection state changed: ${state}`);

        switch (state) {
            case ConnectionState.Connected:
                this.setColor(this.COLOR_CONNECTED);
                break;
            case ConnectionState.Connecting:
            case ConnectionState.Reconnecting:
                this.setColor(this.COLOR_CONNECTING);
                break;
            case ConnectionState.Error:
                this.setColor(this.COLOR_ERROR);
                break;
            case ConnectionState.Disconnected:
            default:
                this.setColor(this.COLOR_DISCONNECTED);
                break;
        }
    }

    private setColor(color: vec4): void {
        if (this._material) {
            this._material.mainPass.baseColor = color;
        }
    }

    // ==================== Utility ====================

    private log(message: string): void {
        if (this.debugLogging) {
            print(`[ConnectionIndicator] ${message}`);
        }
    }
}
