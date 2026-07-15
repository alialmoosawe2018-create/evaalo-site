/**
 * Connection Retry Utility
 * يوفر retry logic للاتصال بـ LiveKit
 */

const DEFAULT_RETRY_CONFIG = {
    maxRetries: 3,
    initialDelay: 1000, // 1 second
    maxDelay: 10000, // 10 seconds
    backoffMultiplier: 2,
    retryableErrors: [
        'NetworkError',
        'TimeoutError',
        'ConnectionError',
        'Failed to fetch',
        'could not establish',
        'pc connection',
        'Peer connection',
        'ICE',
        'signal closed',
    ]
};

/**
 * Check if error is retryable
 */
const isRetryableError = (error, retryableErrors = DEFAULT_RETRY_CONFIG.retryableErrors) => {
    if (!error) return false;
    
    const errorMessage = error.message || error.toString();
    return retryableErrors.some(retryableError => 
        errorMessage.includes(retryableError)
    );
};

/**
 * Calculate delay for next retry (exponential backoff)
 */
const calculateDelay = (attempt, config = DEFAULT_RETRY_CONFIG) => {
    const delay = config.initialDelay * Math.pow(config.backoffMultiplier, attempt);
    return Math.min(delay, config.maxDelay);
};

/**
 * Retry a function with exponential backoff
 */
export const retryWithBackoff = async (
    fn,
    config = DEFAULT_RETRY_CONFIG,
    onRetry = null
) => {
    let lastError;
    
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            const result = await fn();
            return { success: true, result, attempts: attempt + 1 };
        } catch (error) {
            lastError = error;
            
            // Don't retry if error is not retryable
            if (!isRetryableError(error, config.retryableErrors)) {
                return { 
                    success: false, 
                    error, 
                    attempts: attempt + 1,
                    retryable: false
                };
            }
            
            // Don't retry if max retries reached
            if (attempt >= config.maxRetries) {
                return { 
                    success: false, 
                    error, 
                    attempts: attempt + 1,
                    retryable: true
                };
            }
            
            // Calculate delay and wait
            const delay = calculateDelay(attempt, config);
            
            if (onRetry) {
                onRetry(attempt + 1, delay, error);
            }
            
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    return { 
        success: false, 
        error: lastError, 
        attempts: config.maxRetries + 1,
        retryable: true
    };
};

/**
 * Connect to LiveKit Room with retry
 */
export const connectWithRetry = async (
    room,
    url,
    token,
    config = DEFAULT_RETRY_CONFIG,
    onRetry = null
) => {
    return retryWithBackoff(
        async () => {
            await room.connect(url, token, {
                autoSubscribe: true,
                dynacast: false
            });
            return room;
        },
        config,
        onRetry
    );
};

/**
 * Get user-friendly error message
 */
export const getErrorMessage = (error) => {
    if (!error) return 'Unknown error occurred';
    
    const errorMessage = error.message || error.toString();
    
    // Network errors
    if (errorMessage.includes('NetworkError') || errorMessage.includes('Failed to fetch')) {
        return 'Network connection failed. Please check your internet connection and try again.';
    }
    
    // Timeout errors
    if (errorMessage.includes('TimeoutError') || errorMessage.includes('timeout')) {
        return 'Connection timeout. The server is taking too long to respond. Please try again.';
    }
    
    // Authentication errors
    if (errorMessage.includes('Unauthorized') || errorMessage.includes('Invalid token')) {
        return 'Authentication failed. Please refresh the page and try again.';
    }
    
    // Room errors
    if (errorMessage.includes('Room') || errorMessage.includes('room')) {
        return 'Failed to connect to the interview room. Please try again.';
    }
    
    // Generic error
    return `Connection error: ${errorMessage}. Please try again.`;
};

/**
 * Error handler with user notification
 */
export const handleConnectionError = (error, onError = null) => {
    const message = getErrorMessage(error);
    
    console.error('Connection error:', error);
    
    if (onError) {
        onError(message, error);
    } else {
        // Default: show alert (can be replaced with toast notification)
        alert(message);
    }
    
    return message;
};

export default {
    retryWithBackoff,
    connectWithRetry,
    getErrorMessage,
    handleConnectionError,
    isRetryableError
};
