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
    },

    // Form2 Assistant - evaalo v1
    evaaloV1: {
        name: 'evaalo v1',
        apiKey: '7c4dacd3-c0fe-4a6c-bf4f-d9601585f155',
        assistantId: '9b7dec71-1e4a-49e4-a738-5cedd49e36f5',
        prompt: 'YOUR_FORM2_PROMPT_HERE', // Update with the specific prompt when provided
        config: {
            position: 'bottom-right',
            theme: 'default',
            greeting: 'Hello! I am evaalo v1. Need help filling out the form? I can assist you!',
        }
    },

    // Form Assistant - evaalo v2
    evaaloV2: {
        name: 'evaalo v2',
        apiKey: '7c4dacd3-c0fe-4a6c-bf4f-d9601585f155',
        assistantId: '4a3c5f28-e1d9-4fa9-80a2-f57c7c1fd415',
        prompt: 'YOUR_FORM_PROMPT_HERE', // Update with the specific prompt when provided
        config: {
            position: 'bottom-right',
            theme: 'default',
            greeting: 'Hello! I am evaalo v2. Need help filling out the form? I can assist you!',
        }
    },

    // Form3 Assistant - evaalo v3
    evaaloV3: {
        name: 'evaalo v3',
        apiKey: 'YOUR_FORM3_API_KEY_HERE',
        assistantId: 'YOUR_FORM3_ASSISTANT_ID_HERE',
        prompt: 'YOUR_FORM3_PROMPT_HERE',
        config: {
            position: 'bottom-right',
            theme: 'default',
            greeting: 'Hello! I am evaalo v3. Need help filling out the form? I can assist you!',
        }
    },

    // Voice Interview Assistant - for voice interviews (used in Interview page)
    voiceInterview: {
        name: 'voiceInterview',
        apiKey: '7c4dacd3-c0fe-4a6c-bf4f-d9601585f155',
        assistantId: '9b7dec71-1e4a-49e4-a738-5cedd49e36f5',
        prompt: 'You are conducting a voice interview. Guide the candidate through the interview process.',
        config: {
            position: 'bottom-right',
            theme: 'default',
            greeting: 'Welcome to your voice interview. Let\'s get started!',
            voice: {
                provider: 'playht',
                voiceId: 'jennifer',
            },
        }
    }
};

