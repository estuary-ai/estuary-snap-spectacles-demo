/**
 * CloudyFollowController
 *
 * Scene wiring:
 * - Attach this script to the cloud SceneObject (or a parent).
 * - Assign the main camera SceneObject to followTarget.
 * - Ensure VoiceConnection.ts is in the scene (it sets EstuaryActions manager).
 * - Use actions in the Estuary prompt:
 *   <action name="follow_user" /> and <action name="stop_following_user" />
 *
 * Spectacles performance notes:
 * - Keep UpdateEvent light; this script skips work when not following.
 * - Use Lens Performance Overlay / Spectacles Monitor to verify LP <= 100.
 *
 * Plane data (future "what am I looking at"):
 * - Enable Device Tracking on the camera and set it to World mode.
 * - For plane detection: World Tracking Planes with
 *   nativePlaneTrackingType = NativePlaneTrackingType.Both.
 * - On Spectacles, prefer WorldQueryModule hit tests (lower cost) over World Mesh.
 */

import { EstuaryActions } from "../estuary-lens-studio-sdk/src/Components/EstuaryActionManager";

@component
export class CloudyFollowController extends BaseScriptComponent {
    // ==================== Configuration (set in Inspector) ====================

    @input
    @hint("Cloud SceneObject (optional; defaults to this SceneObject)")
    cloudObject: SceneObject;

    @input
    @hint("Target to follow (assign the main camera SceneObject)")
    followTarget: SceneObject;

    @input
    @hint("Distance in front of the camera (Spectacles units are cm)")
    followDistance: number = 60;

    @input
    @hint("Vertical offset from camera position")
    heightOffset: number = 10;

    @input
    @hint("Position smoothing speed (higher = snappier)")
    positionLerpSpeed: number = 6;

    @input
    @hint("Rotation smoothing speed (higher = snappier)")
    rotationLerpSpeed: number = 8;

    @input
    @hint("Rotate cloud to face the camera")
    enableLookAt: boolean = true;

    @input
    @hint("Enable debug logging")
    debugLogging: boolean = false;

    // ==================== State ====================

    private _cloudTransform: Transform | null = null;
    private _targetTransform: Transform | null = null;
    private _isFollowing: boolean = false;
    private _pendingRegistration: boolean = false;
    private _unsubscribes: Array<() => void> = [];

    onAwake() {
        const cloudObj = this.cloudObject || this.getSceneObject();
        if (!cloudObj) {
            print("[CloudyFollowController] ERROR: No cloud object available");
            return;
        }
        this._cloudTransform = cloudObj.getTransform();

        if (!this.followTarget) {
            print("[CloudyFollowController] ERROR: followTarget is not assigned");
            return;
        }
        this._targetTransform = this.followTarget.getTransform();

        this.subscribeToActions();
        this.tryRegisterActions();

        const updateEvent = this.createEvent("UpdateEvent");
        updateEvent.bind(() => this.onUpdate());
    }

    onDestroy() {
        for (const unsub of this._unsubscribes) {
            unsub();
        }
        this._unsubscribes = [];
    }

    private subscribeToActions(): void {
        const unsubFollow = EstuaryActions.on("follow_user", () => {
            this.setFollowing(true);
        });
        this._unsubscribes.push(unsubFollow);

        const unsubStop = EstuaryActions.on("stop_following_user", () => {
            this.setFollowing(false);
        });
        this._unsubscribes.push(unsubStop);
    }

    private setFollowing(shouldFollow: boolean): void {
        this._isFollowing = shouldFollow;
        if (this.debugLogging) {
            print(`[CloudyFollowController] Following: ${this._isFollowing}`);
        }
    }

    private tryRegisterActions(): void {
        const manager = EstuaryActions.getManager();
        if (!manager) {
            this._pendingRegistration = true;
            return;
        }

        if (manager.strictMode) {
            manager.registerActions("*", ["follow_user", "stop_following_user"]);
            if (this.debugLogging) {
                print("[CloudyFollowController] Registered actions for strict mode");
            }
        }

        this._pendingRegistration = false;
    }

    private onUpdate(): void {
        if (this._pendingRegistration) {
            this.tryRegisterActions();
        }

        if (!this._isFollowing || !this._cloudTransform || !this._targetTransform) {
            return;
        }

        const dt = getDeltaTime();
        const posT = this.getLerpT(this.positionLerpSpeed, dt);
        const rotT = this.getLerpT(this.rotationLerpSpeed, dt);

        const cameraPos = this._targetTransform.getWorldPosition();
        // Use back (camera look direction); forward points behind the user in Lens Studio.
        const cameraLookDir = this._targetTransform.back;
        const distance = Math.max(0, this.followDistance);

        let targetPos = cameraPos.add(cameraLookDir.uniformScale(distance));
        if (this.heightOffset !== 0) {
            targetPos = targetPos.add(vec3.up().uniformScale(this.heightOffset));
        }

        const currentPos = this._cloudTransform.getWorldPosition();
        const newPos = vec3.lerp(currentPos, targetPos, posT);
        this._cloudTransform.setWorldPosition(newPos);

        if (this.enableLookAt) {
            const distanceToCamera = cameraPos.distance(newPos);
            if (distanceToCamera > 0.001) {
                const lookDirection = cameraPos.sub(newPos).normalize();
                const targetRot = quat.lookAt(lookDirection, vec3.up());
                const currentRot = this._cloudTransform.getWorldRotation();
                const newRot = quat.slerp(currentRot, targetRot, rotT);
                this._cloudTransform.setWorldRotation(newRot);
            }
        }
    }

    private getLerpT(speed: number, dt: number): number {
        if (speed <= 0) {
            return 1;
        }
        const t = 1 - Math.exp(-speed * dt);
        return Math.min(1, Math.max(0, t));
    }
}
