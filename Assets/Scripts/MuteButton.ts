/**
 * MuteButton.ts
 *
 * Attaches a SpectaclesUIKit RoundButton (toggle mode) to the user's right palm
 * and uses its toggle state to mute/unmute the microphone.
 *
 * Setup in Lens Studio:
 * 1. Create a SceneObject "Mute Button"
 * 2. Add the RoundButton component (from SpectaclesUIKit):
 *    - _toggleable = true
 *    - _defaultToOn = false  (starts unmuted)
 *    - _width = 2            (2 cm diameter)
 *    - _style = "Primary"
 * 3. Add this MuteButton script to the SAME SceneObject
 * 4. Wire voiceConnection → the "Estuary Character" SceneObject
 * 5. Assign unmutedIconObject and mutedIconObject child SceneObjects (optional — button works without icons)
 *
 * Toggle mapping:
 *   Button OFF (default) = mic LIVE  (unmuted)
 *   Button ON  (toggled) = mic MUTED
 */

import { HandInputData } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/HandInputData";
import { BaseHand } from "SpectaclesInteractionKit.lspkg/Providers/HandInputData/BaseHand";
import SIKLogLevelProvider from "SpectaclesInteractionKit.lspkg/Providers/InteractionConfigurationProvider/SIKLogLevelProvider";
import { LogLevel } from "SpectaclesInteractionKit.lspkg/Utils/LogLevel";

/** Duck-typed interface for SimpleAutoConnect's mute API */
interface MuteController {
    setMuted(muted: boolean): void;
    isMuted: boolean;
}

/** Duck-typed interface for the RoundButton's toggle events */
interface ToggleButton {
    onValueChange: { add(callback: (value: number) => void): void };
    isOn: boolean;
    initialized: boolean;
}

@component
export class MuteButton extends BaseScriptComponent {

    @input
    @hint("SceneObject with SimpleAutoConnect script (Estuary Character)")
    voiceConnection: SceneObject;

    @input
    @hint("Child SceneObject showing unmuted mic icon (visible when LIVE)")
    unmutedIconObject: SceneObject;

    @input
    @hint("Child SceneObject showing muted mic icon (visible when MUTED)")
    mutedIconObject: SceneObject;

    @input
    @hint("Offset from hand attachment point (cm). Positive Y = above palm.")
    palmOffset: vec3 = new vec3(0, 3, 0);

    @input
    @hint("Enable debug logging")
    debugLogging: boolean = false;

    // ==================== State ====================

    private _hand: BaseHand;
    private _muteController: MuteController | null = null;
    private _toggleButton: ToggleButton | null = null;
    private _connected: boolean = false;

    // ==================== Lifecycle ====================

    onAwake() {
        print("[MuteButton] onAwake() started");

        // Attach to right hand palm
        this._hand = HandInputData.getInstance().getHand("right");
        const sceneObj = this.getSceneObject();

        // Hide until hand is found
        sceneObj.enabled = false;

        this._hand.onHandFound.add(() => {
            print("[MuteButton] Hand found — attaching mute button");
            this.attachToHand(sceneObj);
        });

        this._hand.onHandLost.add(() => {
            this.log("Hand lost — hiding mute button");
            sceneObj.enabled = false;
        });

        // If hand is already tracked, attach immediately
        if (this._hand.isTracked()) {
            this.attachToHand(sceneObj);
        }

        // Poll for RoundButton and MuteController in update loop
        const updateEvent = this.createEvent("UpdateEvent");
        updateEvent.bind(() => this.onUpdate());

        print("[MuteButton] onAwake() completed — waiting for components...");

        // Suppress verbose SIK hand-tracking logs (defensive — must not crash onAwake)
        try {
            SIKLogLevelProvider.getInstance().logLevel = LogLevel.Warning;
        } catch (e) {
            print("[MuteButton] Could not set SIK log level: " + e);
        }
    }

    // ==================== Hand Attachment ====================

    private attachToHand(sceneObj: SceneObject): void {
        const attachPoint = this._hand.middleToWrist.getAttachmentPoint();
        sceneObj.setParent(attachPoint);
        sceneObj.getTransform().setLocalPosition(this.palmOffset);
        sceneObj.enabled = true;
    }

    // ==================== Update Loop ====================

    private onUpdate(): void {
        if (this._connected) return;

        // Discover RoundButton on same SceneObject (lazy — waits for UIKit init)
        if (!this._toggleButton) {
            this._toggleButton = this.discoverToggleButton();
        }

        // Discover SimpleAutoConnect on voiceConnection SceneObject
        if (!this._muteController) {
            this._muteController = this.discoverMuteController();
        }

        // Once both are ready, wire them up
        if (this._toggleButton && this._muteController) {
            this.wireToggle();
        }
    }

    // ==================== Discovery ====================

    private discoverToggleButton(): ToggleButton | null {
        const scripts = this.getSceneObject().getComponents("Component.ScriptComponent") as any[];
        for (let i = 0; i < scripts.length; i++) {
            const sc = scripts[i] as any;
            if (!sc || sc === this) continue;
            // Duck-type check for RoundButton toggle API
            if (sc.onValueChange && typeof sc.isOn === 'boolean' && sc.initialized === true) {
                print("[MuteButton] Found RoundButton toggle on same SceneObject");
                return sc as ToggleButton;
            }
        }
        return null;
    }

    private discoverMuteController(): MuteController | null {
        if (!this.voiceConnection) return null;

        const scripts = this.voiceConnection.getComponents("Component.ScriptComponent") as any[];
        for (let i = 0; i < scripts.length; i++) {
            const sc = scripts[i] as any;
            if (!sc) continue;
            // Duck-type check for SimpleAutoConnect mute API
            if (typeof sc.setMuted === 'function' && 'isMuted' in sc) {
                this.log("Found SimpleAutoConnect mute controller");
                return sc as MuteController;
            }
        }
        return null;
    }

    // ==================== Wiring ====================

    private wireToggle(): void {
        this._connected = true;
        const btn = this._toggleButton!;
        const ctrl = this._muteController!;

        // Set initial icon visibility
        this.updateIcons(btn.isOn);

        btn.onValueChange.add((value: number) => {
            const muted = value === 1; // toggled ON = muted
            ctrl.setMuted(muted);
            this.updateIcons(muted);
            this.log(`Toggle → ${muted ? 'MUTED' : 'UNMUTED'}`);
        });

        // Sync initial state (button defaults to OFF = unmuted, which matches mic live)
        ctrl.setMuted(btn.isOn);
        print("[MuteButton] Wired: RoundButton ↔ mic mute (initial muted=" + btn.isOn + ")");
    }

    // ==================== Icon Visibility ====================

    private updateIcons(muted: boolean): void {
        if (this.unmutedIconObject) this.unmutedIconObject.enabled = !muted;
        if (this.mutedIconObject) this.mutedIconObject.enabled = muted;
    }

    // ==================== Utility ====================

    private log(message: string): void {
        if (this.debugLogging) {
            print(`[MuteButton] ${message}`);
        }
    }
}
