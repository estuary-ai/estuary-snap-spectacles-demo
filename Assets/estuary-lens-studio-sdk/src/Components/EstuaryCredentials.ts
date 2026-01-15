/**
 * EstuaryCredentials - Central configuration component for Estuary SDK credentials.
 * 
 * This component provides a single place to configure your Estuary API key and character ID.
 * Other components (SimpleAutoConnect, EstuaryActionManager, etc.) can reference this
 * component to access the credentials.
 * 
 * Setup in Lens Studio:
 * 1. Create a SceneObject (e.g., "Estuary Credentials")
 * 2. Add this script to the SceneObject
 * 3. Set your API key and Character ID in the Inspector
 * 4. Reference this SceneObject from other Estuary components
 * 
 * User ID Management:
 * - For testing: Enter a manual user ID in the "Manual User ID" field
 * - For production: Enable "Generate Persistent User ID" to auto-generate a unique ID
 *   that persists across app sessions (stored in device local storage)
 * - If both are set, manual user ID takes priority
 */

/** Storage key for persistent user ID */
const USER_ID_STORAGE_KEY = "estuary_persistent_user_id";

/**
 * Interface for accessing EstuaryCredentials from other scripts.
 * Use this when referencing the credentials component.
 */
export interface IEstuaryCredentials {
    /** The API key from your Estuary dashboard */
    apiKey: string;
    /** The character/agent ID from your Estuary dashboard */
    characterId: string;
    /** The Estuary server URL */
    serverUrl: string;
    /** Enable debug logging across all Estuary components */
    debugMode: boolean;
    /** The user ID for conversation persistence (manual or auto-generated) */
    userId: string;
}

/**
 * EstuaryCredentials - Lens Studio component for centralized credential management.
 * 
 * Add this to a SceneObject and configure your credentials once.
 * Other Estuary components can reference this object to access the credentials.
 */
@component
export class EstuaryCredentials extends BaseScriptComponent implements IEstuaryCredentials {
    
    // ==================== Configuration (set in Inspector) ====================
    
    /** 
     * Your Estuary API key.
     * Generate this from your Estuary dashboard.
     */
    @input
    @hint("Your API key from the Estuary dashboard")
    apiKey: string = "";
    
    /** 
     * The character/agent ID to connect to.
     * Get this from your Estuary dashboard.
     */
    @input
    @hint("Character/Agent ID from your Estuary dashboard")
    characterId: string = "";
    
    /** 
     * The Estuary server URL.
     * Default: wss://api.estuary-ai.com
     */
    @input
    @hint("Estuary server URL (default: wss://api.estuary-ai.com)")
    serverUrl: string = "wss://api.estuary-ai.com";
    
    /** 
     * Enable debug logging for all Estuary components.
     */
    @input
    @hint("Enable debug logging for all Estuary components")
    debugMode: boolean = true;
    
    // ==================== User ID Configuration ====================
    
    /**
     * Manual User ID for testing/development purposes.
     * When set, this takes priority over auto-generated IDs.
     * Leave empty to use auto-generated persistent ID.
     */
    @input
    @hint("Manual User ID for testing (leave empty to use auto-generated ID)")
    manualUserId: string = "";
    
    /**
     * Generate a persistent unique User ID automatically.
     * When enabled, a unique ID is generated on first run and stored
     * in device local storage. This ID persists across app sessions,
     * allowing users to resume conversations where they left off.
     */
    @input
    @hint("Auto-generate and persist a unique User ID (recommended for production)")
    generatePersistentUserId: boolean = true;
    
    /** The resolved user ID (either manual or auto-generated) */
    private _resolvedUserId: string = "";
    
    // ==================== Singleton Access ====================
    
    private static _instance: EstuaryCredentials | null = null;
    
    /**
     * Get the singleton instance of EstuaryCredentials.
     * Returns null if no instance has been created yet.
     */
    static get instance(): EstuaryCredentials | null {
        return EstuaryCredentials._instance;
    }
    
    /**
     * Check if an instance exists.
     */
    static get hasInstance(): boolean {
        return EstuaryCredentials._instance !== null;
    }
    
    // ==================== User ID Property ====================
    
    /**
     * Get the resolved user ID.
     * Priority: manualUserId > persistentUserId > generated fallback
     */
    get userId(): string {
        return this._resolvedUserId;
    }
    
    // ==================== Lifecycle ====================
    
    onAwake() {
        // Register as singleton
        if (EstuaryCredentials._instance === null) {
            EstuaryCredentials._instance = this;
            this.log("EstuaryCredentials initialized as singleton");
        } else {
            print("[EstuaryCredentials] WARNING: Multiple EstuaryCredentials instances detected. Using the first one.");
        }
        
        // Initialize user ID
        this.initializeUserId();
        
        // Validate credentials
        this.validateCredentials();
    }
    
    onDestroy() {
        if (EstuaryCredentials._instance === this) {
            EstuaryCredentials._instance = null;
        }
    }
    
    // ==================== User ID Management ====================
    
    /**
     * Initialize the user ID based on configuration.
     * Priority: manualUserId > persistentUserId > generated fallback
     */
    private initializeUserId(): void {
        // Priority 1: Manual user ID (for development/testing)
        if (this.manualUserId && this.manualUserId.length > 0) {
            this._resolvedUserId = this.manualUserId;
            this.log(`Using manual User ID: ${this._resolvedUserId}`);
            return;
        }
        
        // Priority 2: Auto-generate persistent user ID
        if (this.generatePersistentUserId) {
            this._resolvedUserId = this.getOrCreatePersistentUserId();
            this.log(`Using persistent User ID: ${this._resolvedUserId}`);
            return;
        }
        
        // Fallback: Generate a session-based ID (changes each session)
        this._resolvedUserId = this.generateSessionUserId();
        this.log(`Using session User ID: ${this._resolvedUserId} (not persisted)`);
    }
    
    /**
     * Get the persistent user ID from storage, or create one if it doesn't exist.
     * Uses Lens Studio's PersistentStorageSystem for device-local storage.
     */
    private getOrCreatePersistentUserId(): string {
        try {
            const store = global.persistentStorageSystem.store;
            
            // Try to get existing user ID
            if (store.has(USER_ID_STORAGE_KEY)) {
                const storedId = store.getString(USER_ID_STORAGE_KEY);
                if (storedId && storedId.length > 0) {
                    this.log(`Loaded existing persistent User ID from storage`);
                    return storedId;
                }
            }
            
            // Generate new user ID
            const newUserId = this.generatePersistentUserIdValue();
            
            // Store it for future sessions
            store.putString(USER_ID_STORAGE_KEY, newUserId);
            this.log(`Created and saved new persistent User ID`);
            
            return newUserId;
            
        } catch (e) {
            print(`[EstuaryCredentials] WARNING: Could not access persistent storage: ${e}`);
            print("[EstuaryCredentials] Falling back to session-based User ID");
            return this.generateSessionUserId();
        }
    }
    
    /**
     * Generate a new unique persistent user ID.
     * Format: "user_" + random alphanumeric string
     */
    private generatePersistentUserIdValue(): string {
        // Generate a unique ID using timestamp + random component
        const timestamp = Date.now().toString(36);
        const randomPart = Math.random().toString(36).substring(2, 10);
        return `user_${timestamp}_${randomPart}`;
    }
    
    /**
     * Generate a session-based user ID (changes each session).
     * Used as fallback when persistent storage is not available or not enabled.
     */
    private generateSessionUserId(): string {
        return `session_${Date.now().toString(36)}`;
    }
    
    /**
     * Clear the persistent user ID from storage.
     * Call this to reset a user's conversation history.
     */
    clearPersistentUserId(): void {
        try {
            const store = global.persistentStorageSystem.store;
            if (store.has(USER_ID_STORAGE_KEY)) {
                store.remove(USER_ID_STORAGE_KEY);
                this.log("Cleared persistent User ID from storage");
            }
            
            // Re-initialize user ID
            this.initializeUserId();
            
        } catch (e) {
            print(`[EstuaryCredentials] WARNING: Could not clear persistent storage: ${e}`);
        }
    }
    
    /**
     * Get the current persistent user ID from storage without modifying it.
     * Returns null if no persistent ID exists.
     */
    getPersistentUserIdFromStorage(): string | null {
        try {
            const store = global.persistentStorageSystem.store;
            if (store.has(USER_ID_STORAGE_KEY)) {
                return store.getString(USER_ID_STORAGE_KEY);
            }
        } catch (e) {
            // Ignore errors
        }
        return null;
    }
    
    // ==================== Validation ====================
    
    /**
     * Validate that credentials are configured.
     * @returns True if credentials are valid
     */
    validateCredentials(): boolean {
        let isValid = true;
        
        if (!this.apiKey || this.apiKey.length === 0 || this.apiKey === "[ESTUARY_API_KEY]") {
            print("[EstuaryCredentials] ⚠️ WARNING: API key is not configured!");
            isValid = false;
        }
        
        if (!this.characterId || this.characterId.length === 0 || this.characterId === "[ESTUARY_CHARACTER_ID]") {
            print("[EstuaryCredentials] ⚠️ WARNING: Character ID is not configured!");
            isValid = false;
        }
        
        if (!this._resolvedUserId || this._resolvedUserId.length === 0) {
            print("[EstuaryCredentials] ⚠️ WARNING: User ID could not be resolved!");
            isValid = false;
        }
        
        if (isValid) {
            this.log("✅ Credentials configured successfully");
            this.log(`   User ID: ${this._resolvedUserId}`);
            this.log(`   User ID source: ${this.manualUserId ? 'manual' : (this.generatePersistentUserId ? 'persistent' : 'session')}`);
        }
        
        return isValid;
    }
    
    // ==================== Utility ====================
    
    private log(message: string): void {
        if (this.debugMode) {
            print(`[EstuaryCredentials] ${message}`);
        }
    }
}

/**
 * Helper function to get credentials from a SceneObject.
 * @param sceneObject The SceneObject containing EstuaryCredentials
 * @returns The credentials interface or null if not found
 */
export function getCredentialsFromSceneObject(sceneObject: SceneObject | null): IEstuaryCredentials | null {
    if (!sceneObject) {
        return null;
    }
    
    const componentCount = sceneObject.getComponentCount("Component.ScriptComponent");
    for (let i = 0; i < componentCount; i++) {
        const scriptComp = sceneObject.getComponentByIndex("Component.ScriptComponent", i) as any;
        if (scriptComp && 
            typeof scriptComp.apiKey === 'string' && 
            typeof scriptComp.characterId === 'string' &&
            typeof scriptComp.serverUrl === 'string') {
            return scriptComp as IEstuaryCredentials;
        }
    }
    
    return null;
}
