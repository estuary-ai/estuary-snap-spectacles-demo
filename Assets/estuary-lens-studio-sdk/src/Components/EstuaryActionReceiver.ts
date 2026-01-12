/**
 * EstuaryActionReceiver - Lens Studio component for receiving action events.
 * 
 * This component can be attached to any SceneObject to listen for specific actions
 * from the AI character. When an action is received, it fires an event that other
 * scripts can subscribe to.
 * 
 * Setup in Lens Studio:
 * 1. Create a SceneObject (e.g., your character model)
 * 2. Add this script to the SceneObject
 * 3. In the Inspector, add actions to the "Actions" list:
 *    - Click the '+' button to add a new action
 *    - Enter the action name (e.g., "sit", "wave", "dance")
 *    - Repeat for all actions you want to listen for
 * 4. Connect to onActionReceived in other scripts or use Behavior triggers
 * 
 * Example actions list in Inspector:
 *   Actions:
 *     [0] sit
 *     [1] wave
 *     [2] dance
 *     [+] (click to add more)
 * 
 * This is similar to Unity's event system - actions are broadcast and receivers
 * pick up the ones they're interested in.
 */

import { EstuaryActionManager, EstuaryActionManagerComponent, ParsedAction } from './EstuaryActionManager';
import { EstuaryCredentials, IEstuaryCredentials, getCredentialsFromSceneObject } from './EstuaryCredentials';

/**
 * EstuaryActionReceiver - Receives and responds to action events.
 * 
 * Attach this to any SceneObject that should respond to character actions.
 * Configure which action(s) to listen for, and connect your response logic.
 */
@component
export class EstuaryActionReceiver extends BaseScriptComponent {
    
    // ==================== Configuration (set in Inspector) ====================
    
    /**
     * List of action names to listen for.
     * Add actions like "sit", "wave", "dance", etc.
     * Leave empty to receive ALL actions.
     * 
     * In Lens Studio Inspector, click '+' to add more actions.
     */
    @input
    @hint("Action names to listen for. Click '+' to add more. Empty = all actions")
    actions: string[] = [];
    
    /**
     * Whether to listen for ALL actions (ignore the actions list).
     * If true, this receiver will be notified of every action.
     */
    @input
    @hint("Listen for all actions (ignores the actions list)")
    listenToAllActions: boolean = false;
    
    /**
     * Reference to the EstuaryCredentials SceneObject (optional).
     * If not set, will use the singleton.
     */
    @input
    @hint("Optional: SceneObject with EstuaryCredentials")
    credentialsObject: SceneObject;
    
    /**
     * Reference to the EstuaryActionManager SceneObject (optional).
     * If not set, will try to find a shared manager.
     */
    @input
    @hint("Optional: SceneObject with EstuaryActionManager")
    actionManagerObject: SceneObject;
    
    /**
     * Enable debug logging for this receiver.
     */
    @input
    @hint("Enable debug logging")
    debugMode: boolean = false;
    
    // ==================== State ====================
    
    /** The action manager instance */
    private _actionManager: EstuaryActionManager | null = null;
    
    /** Unsubscribe functions for cleanup */
    private _unsubscribes: (() => void)[] = [];
    
    /** Credentials reference */
    private _credentials: IEstuaryCredentials | null = null;
    
    /** Last received action */
    private _lastAction: ParsedAction | null = null;
    
    /** Whether this receiver is active */
    private _isActive: boolean = false;
    
    // ==================== Singleton Manager ====================
    
    /** Shared action manager instance for all receivers */
    private static _sharedManager: EstuaryActionManager | null = null;
    
    /**
     * Get or create the shared action manager.
     */
    static getSharedManager(): EstuaryActionManager {
        if (!EstuaryActionReceiver._sharedManager) {
            EstuaryActionReceiver._sharedManager = new EstuaryActionManager();
        }
        return EstuaryActionReceiver._sharedManager;
    }
    
    /**
     * Set the shared action manager (call this from your main script).
     */
    static setSharedManager(manager: EstuaryActionManager): void {
        EstuaryActionReceiver._sharedManager = manager;
    }
    
    // ==================== Properties ====================
    
    /** Get the last received action */
    get lastAction(): ParsedAction | null {
        return this._lastAction;
    }
    
    /** Whether this receiver is currently active */
    get isActive(): boolean {
        return this._isActive;
    }
    
    /** Get the action manager */
    get actionManager(): EstuaryActionManager | null {
        return this._actionManager;
    }
    
    /** Get the credentials */
    get credentials(): IEstuaryCredentials | null {
        return this._credentials;
    }
    
    // ==================== Lifecycle ====================
    
    onAwake() {
        this.log("Initializing EstuaryActionReceiver...");
        
        // Get credentials
        this._credentials = this.getCredentials();
        
        // Get or create action manager
        this._actionManager = this.getActionManager();
        
        if (!this._actionManager) {
            print("[EstuaryActionReceiver] WARNING: No action manager available");
            print("[EstuaryActionReceiver] Actions won't be received until a manager is set");
            return;
        }
        
        // Subscribe to configured actions
        this.subscribeToActions();
        
        this._isActive = true;
        this.log("EstuaryActionReceiver initialized");
    }
    
    onDestroy() {
        this.unsubscribeAll();
        this._isActive = false;
    }
    
    // ==================== Public Methods ====================
    
    /**
     * Manually set the action manager.
     * @param manager The EstuaryActionManager instance
     */
    setActionManager(manager: EstuaryActionManager): void {
        // Unsubscribe from previous manager
        this.unsubscribeAll();
        
        this._actionManager = manager;
        
        // Resubscribe with new manager
        if (this._isActive) {
            this.subscribeToActions();
        }
    }
    
    /**
     * Add an action to listen for at runtime.
     * This subscribes to the action immediately if the manager is available.
     * @param actionName The action name to add
     */
    addAction(actionName: string): void {
        // Add to the internal list
        if (!this.actions.includes(actionName)) {
            this.actions.push(actionName);
        }
        
        // Subscribe immediately if manager is available
        if (this._actionManager) {
            const unsub = this._actionManager.onAction(actionName.toLowerCase(), (action) => {
                this.handleAction(action);
            });
            this._unsubscribes.push(unsub);
            this.log(`Added listener for action '${actionName}'`);
        }
    }
    
    /**
     * Remove an action from the listening list at runtime.
     * Note: This removes from the list but doesn't immediately unsubscribe
     * (will take effect on next restart or resubscribe).
     * @param actionName The action name to remove
     */
    removeAction(actionName: string): void {
        const index = this.actions.indexOf(actionName);
        if (index > -1) {
            this.actions.splice(index, 1);
            this.log(`Removed action '${actionName}' from list`);
        }
    }
    
    /**
     * Clear all actions and resubscribe.
     * If listenToAllActions is false and no actions are set, will listen to all.
     */
    clearActions(): void {
        this.actions = [];
        this.unsubscribeAll();
        if (this._actionManager) {
            this.subscribeToActions();
        }
        this.log("Cleared all actions");
    }
    
    /**
     * Get the list of actions this receiver is listening for.
     */
    getListeningActions(): string[] {
        // If listenToAllActions is true, return empty (will subscribe to all)
        if (this.listenToAllActions) {
            return [];
        }
        
        // Filter and normalize the actions array
        if (this.actions && this.actions.length > 0) {
            return this.actions
                .filter(a => a && a.trim().length > 0)
                .map(a => a.trim().toLowerCase());
        }
        
        return [];
    }
    
    /**
     * Get the number of actions configured.
     */
    getActionCount(): number {
        if (this.listenToAllActions) {
            return -1; // -1 indicates "all actions"
        }
        return this.getListeningActions().length;
    }
    
    /**
     * Check if this receiver is listening for a specific action.
     * @param actionName The action name to check
     */
    isListeningFor(actionName: string): boolean {
        if (this.listenToAllActions) {
            return true;
        }
        return this.getListeningActions().includes(actionName.toLowerCase());
    }
    
    // ==================== Private Methods ====================
    
    private getCredentials(): IEstuaryCredentials | null {
        // Try input SceneObject first
        if (this.credentialsObject) {
            const creds = getCredentialsFromSceneObject(this.credentialsObject);
            if (creds) {
                this.log("Using credentials from input");
                return creds;
            }
        }
        
        // Fall back to singleton
        if (EstuaryCredentials.hasInstance) {
            this.log("Using credentials from singleton");
            return EstuaryCredentials.instance;
        }
        
        return null;
    }
    
    private getActionManager(): EstuaryActionManager | null {
        // Try input SceneObject first
        if (this.actionManagerObject) {
            const manager = this.getManagerFromSceneObject(this.actionManagerObject);
            if (manager) {
                this.log("Using action manager from input SceneObject");
                return manager;
            }
        }
        
        // Try EstuaryActionManagerComponent singleton
        if (EstuaryActionManagerComponent.hasInstance && EstuaryActionManagerComponent.instance?.manager) {
            this.log("Using EstuaryActionManagerComponent singleton");
            return EstuaryActionManagerComponent.instance.manager;
        }
        
        // Fall back to shared manager
        return EstuaryActionReceiver.getSharedManager();
    }
    
    private getManagerFromSceneObject(sceneObject: SceneObject): EstuaryActionManager | null {
        const componentCount = sceneObject.getComponentCount("Component.ScriptComponent");
        for (let i = 0; i < componentCount; i++) {
            const scriptComp = sceneObject.getComponentByIndex("Component.ScriptComponent", i) as any;
            
            // Check for EstuaryActionManagerComponent (has .manager property)
            if (scriptComp && scriptComp.manager && typeof scriptComp.manager.onAction === 'function') {
                this.log("Found EstuaryActionManagerComponent, using its internal manager");
                return scriptComp.manager as EstuaryActionManager;
            }
            
            // Check for raw EstuaryActionManager (direct instance)
            if (scriptComp && 
                typeof scriptComp.onAction === 'function' &&
                typeof scriptComp.registerAction === 'function') {
                return scriptComp as EstuaryActionManager;
            }
        }
        return null;
    }
    
    private subscribeToActions(): void {
        if (!this._actionManager) return;
        
        // Check if we should listen to all actions
        if (this.listenToAllActions) {
            this.log("Listening for ALL actions (listenToAllActions=true)");
            const unsub = this._actionManager.onAnyAction((action) => {
                this.handleAction(action);
            });
            this._unsubscribes.push(unsub);
            return;
        }
        
        const actions = this.getListeningActions();
        
        if (actions.length === 0) {
            // No actions configured - listen to all as fallback
            this.log("No actions configured - listening for ALL actions");
            const unsub = this._actionManager.onAnyAction((action) => {
                this.handleAction(action);
            });
            this._unsubscribes.push(unsub);
        } else {
            // Listen for specific actions from the list
            this.log(`Listening for ${actions.length} action(s): ${actions.join(', ')}`);
            for (const actionName of actions) {
                const unsub = this._actionManager.onAction(actionName, (action) => {
                    this.handleAction(action);
                });
                this._unsubscribes.push(unsub);
            }
        }
    }
    
    private unsubscribeAll(): void {
        for (const unsub of this._unsubscribes) {
            unsub();
        }
        this._unsubscribes = [];
    }
    
    /**
     * Handle an incoming action.
     * This is where the magic happens - override in subclasses or connect externally.
     */
    protected handleAction(action: ParsedAction): void {
        this._lastAction = action;
        
        this.log(`Action received: '${action.name}'`);
        
        // Call the public callback if set
        if (this.onActionReceived) {
            this.onActionReceived(action);
        }
    } 
    
    // ==================== Public Callback ====================
    
    /**
     * Callback function called when an action is received.
     * Set this from external scripts to handle actions.
     * 
     * @example
     * const receiver = sceneObject.getComponent("EstuaryActionReceiver");
     * receiver.onActionReceived = (action) => {
     *     if (action.name === "sit") {
     *         playAnimation("sit");
     *     }
     * };
     */
    onActionReceived: ((action: ParsedAction) => void) | null = null;
    
    // ==================== Logging ====================
    
    private log(message: string): void {
        if (this.debugMode) {
            print(`[EstuaryActionReceiver] ${message}`);
        }
    }
}

/**
 * Helper function to find EstuaryActionReceiver on a SceneObject.
 */
export function getActionReceiverFromSceneObject(sceneObject: SceneObject | null): EstuaryActionReceiver | null {
    if (!sceneObject) return null;
    
    const componentCount = sceneObject.getComponentCount("Component.ScriptComponent");
    for (let i = 0; i < componentCount; i++) {
        const scriptComp = sceneObject.getComponentByIndex("Component.ScriptComponent", i) as any;
        if (scriptComp && 
            typeof scriptComp.addAction === 'function' &&
            typeof scriptComp.getListeningActions === 'function') {
            return scriptComp as EstuaryActionReceiver;
        }
    }
    return null;
}
