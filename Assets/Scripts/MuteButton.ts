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
 *   Button OFF (default) = ALWAYS-ON mode (mic live, streaming continuously)
 *   Button ON  (toggled) = PUSH-TO-TALK mode (mic muted; pinch right hand to stream)
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
    @hint("(Optional) SceneObject for index-finger PTT effect (e.g. small sphere with glow material)")
    pttEffectObject: SceneObject;

    @input
    @hint("Enable debug logging")
    debugLogging: boolean = false;

    // ==================== State ====================

    private _hand: BaseHand;
    private _muteController: MuteController | null = null;
    private _toggleButton: ToggleButton | null = null;
    private _connected: boolean = false;
    private _pttMode: boolean = false;
    private _pttActive: boolean = false;
    private _pttMuteAt: number = 0;  // getTime() deadline for delayed mute; 0 = no pending mute

    // ==================== Lifecycle ====================

    onAwake() {
        print("[MuteButton] onAwake() started");

        // Attach to right hand palm
        this._hand = HandInputData.getInstance().getHand("right");
        const sceneObj = this.getSceneObject();

        // Hide until hand is found
        sceneObj.enabled = false;
        if (this.pttEffectObject) this.pttEffectObject.enabled = false;

        this._hand.onHandFound.add(() => {
            print("[MuteButton] Hand found — attaching mute button");
            this.attachToHand(sceneObj);
            if (this.pttEffectObject) {
                this.pttEffectObject.setParent(this._hand.indexTip.getAttachmentPoint());
                this.pttEffectObject.enabled = false;
            }
        });

        this._hand.onHandLost.add(() => {
            this.log("Hand lost — hiding mute button");
            this._pttMuteAt = 0;  // cancel any pending delay
            if (this._pttActive) {
                this._pttActive = false;
                if (this._muteController) {
                    this._muteController.setMuted(true);
                    this.log("Hand lost during PTT stream — fail-safe muted");
                }
                this.updateIcons(true);
            }
            if (this.pttEffectObject) {
                this.pttEffectObject.enabled = false;
            }
            sceneObj.enabled = false;
        });

        // Global pinch events for push-to-talk
        this._hand.onPinchDown.add(() => this.onPttPinchDown());
        this._hand.onPinchUp.add(() => this.onPttPinchUp());
        this._hand.onPinchCancel.add(() => this.onPttPinchCancel());

        // If hand is already tracked, attach immediately
        if (this._hand.isTracked()) {
            this.attachToHand(sceneObj);
            if (this.pttEffectObject) {
                this.pttEffectObject.setParent(this._hand.indexTip.getAttachmentPoint());
                this.pttEffectObject.enabled = false;
            }
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
        // Check for pending PTT mute delay
        if (this._pttMuteAt > 0 && getTime() >= this._pttMuteAt) {
            this._pttMuteAt = 0;
            this._pttActive = false;
            if (this._muteController) this._muteController.setMuted(true);
            this.updateIcons(true);
            if (this.pttEffectObject) this.pttEffectObject.enabled = false;
            this.log("PTT delay expired → muted");
        }

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
            const enteringPtt = value === 1; // toggle ON = PTT mode
            this._pttMode = enteringPtt;
            this._pttActive = false;
            this._pttMuteAt = 0;

            if (enteringPtt) {
                ctrl.setMuted(true);
                this.updateIcons(true);
                print("[MuteButton] Mode → PUSH-TO-TALK (pinch to stream)");
            } else {
                ctrl.setMuted(false);
                this.updateIcons(false);
                print("[MuteButton] Mode → ALWAYS-ON MIC");
            }
        });

        // Sync initial state (button defaults to OFF = always-on, which matches mic live)
        this._pttMode = btn.isOn;
        ctrl.setMuted(btn.isOn);
        print("[MuteButton] Wired: RoundButton ↔ mic mute (initial pttMode=" + btn.isOn + ")");
    }

    // ==================== Push-to-Talk Handlers ====================

    private onPttPinchDown(): void {
        if (!this._pttMode || !this._muteController) return;
        if (this._pttMuteAt > 0) {
            this._pttMuteAt = 0;
            this.log("PTT re-pinch — cancelled pending mute");
        }
        this._pttActive = true;
        this._muteController.setMuted(false);
        this.updateIcons(false);
        if (this.pttEffectObject) this.pttEffectObject.enabled = true;
        this.log("PTT pinch → streaming");
    }

    private onPttPinchUp(): void {
        if (!this._pttMode || !this._pttActive) return;
        this._pttMuteAt = getTime() + 1.0;
        this.log("PTT release → muting in 1000ms");
    }

    private onPttPinchCancel(): void {
        if (!this._pttMode || !this._pttActive) return;
        this._pttMuteAt = getTime() + 1.0;
        this.log("PTT cancel → muting in 1000ms");
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
