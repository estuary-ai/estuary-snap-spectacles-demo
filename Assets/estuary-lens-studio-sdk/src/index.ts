/**
 * Estuary SDK for Snapchat Lens Studio
 * 
 * This SDK enables voice and text conversations with Estuary AI characters
 * in Lens Studio projects for Snapchat and Spectacles.
 * 
 * @packageDocumentation
 */

// Core exports
export * from './Core/EstuaryClient';
export * from './Core/EstuaryConfig';
export * from './Core/EstuaryEvents';

// Component exports
export * from './Components/EstuaryManager';
export * from './Components/EstuaryCharacter';
export * from './Components/EstuaryAudioPlayer';
export * from './Components/EstuaryMicrophone';
export * from './Components/DynamicAudioOutput';

// Model exports
export * from './Models/SessionInfo';
export * from './Models/BotResponse';
export * from './Models/BotVoice';
export * from './Models/SttResponse';
export * from './Models/InterruptData';

// Utility exports
export * from './Utilities/AudioConverter';
// Note: Base64Helper is deprecated - use native Base64.encode/decode or encodeAudioToBase64/decodeBase64ToAudio from AudioConverter

// Version
export const VERSION = '1.0.0';





