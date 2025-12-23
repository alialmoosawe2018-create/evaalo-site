/**
 * Vapi Voice Assistants Configuration
 * 
 * This file contains the configuration for all voice assistants used in the application.
 * Update the values below with the actual API keys, Assistant IDs, and prompts when provided.
 */

export const vapiAssistants = {
    // Main Assistant - evaalo (used in Home page)
    evaalo: {
        name: 'evaalo',
        apiKey: '7c4dacd3-c0fe-4a6c-bf4f-d9601585f155',
        assistantId: 'fda09eb4-2275-47aa-a75c-8f2ac1976856',
        prompt: 'You are evaalo, the main assistant. Help users with general inquiries.',
        config: {
            position: 'bottom-right',
            theme: 'healthcare',
            greeting: 'Hello! I am evaalo. How can I help you today?',
            voice: {
                provider: 'playht',
                voiceId: 'jennifer',
            },
        }
    }
};

