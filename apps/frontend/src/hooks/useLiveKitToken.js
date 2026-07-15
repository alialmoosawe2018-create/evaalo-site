/**
 * Warm Token Hook
 * يدير LiveKit tokens مع caching و auto-refresh
 */
import { useState, useEffect, useRef, useCallback } from 'react';

const TOKEN_CACHE_KEY = 'livekit_warm_token';
const TOKEN_EXPIRY_BUFFER = 5 * 60 * 1000; // 5 minutes before expiry

const useLiveKitToken = (candidateId, sessionId) => {
    const [token, setToken] = useState(null);
    const [tokenUrl, setTokenUrl] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const refreshTimeoutRef = useRef(null);

    // Load token from cache
    const loadCachedToken = useCallback(() => {
        try {
            const cached = localStorage.getItem(TOKEN_CACHE_KEY);
            if (cached) {
                const { token: cachedToken, url: cachedUrl, expiresAt } = JSON.parse(cached);
                
                // Check if token is still valid
                if (expiresAt && Date.now() < expiresAt - TOKEN_EXPIRY_BUFFER) {
                    console.log('✅ Using cached LiveKit token');
                    setToken(cachedToken);
                    setTokenUrl(cachedUrl);
                    return { token: cachedToken, url: cachedUrl, expiresAt };
                } else {
                    // Token expired, remove from cache
                    localStorage.removeItem(TOKEN_CACHE_KEY);
                    console.log('⚠️ Cached token expired, fetching new one');
                }
            }
        } catch (e) {
            console.warn('Error loading cached token:', e);
            localStorage.removeItem(TOKEN_CACHE_KEY);
        }
        return null;
    }, []);

    // Save token to cache
    const saveTokenToCache = useCallback((tokenValue, url, expiresIn = 60 * 60 * 1000) => {
        try {
            const expiresAt = Date.now() + expiresIn;
            localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({
                token: tokenValue,
                url: url,
                expiresAt: expiresAt
            }));
            console.log('✅ Token saved to cache, expires at:', new Date(expiresAt).toLocaleTimeString());
        } catch (e) {
            console.warn('Error saving token to cache:', e);
        }
    }, []);

    // Fetch new token
    const fetchToken = useCallback(async (forceRefresh = false) => {
        if (!candidateId || !sessionId) {
            setError('Candidate ID and Session ID are required');
            return null;
        }

        // Check cache first (unless forcing refresh)
        if (!forceRefresh) {
            const cached = loadCachedToken();
            if (cached) {
                return cached;
            }
        }

        setIsLoading(true);
        setError(null);

        try {
            // Fetch token from backend
            const response = await fetch(`/api/video-interview/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    candidateId,
                    campaignId: sessionId,
                    interviewMode: 'video',
                }),
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch token: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data.livekit && data.livekit.token && data.livekit.roomName && data.livekit.url) {
                const tokenValue = data.livekit.token;
                const url = data.livekit.url;
                const roomName = data.livekit.roomName;

                // Save to cache (assume 1 hour expiry, adjust based on your token expiry)
                saveTokenToCache(tokenValue, url, 60 * 60 * 1000);

                setToken(tokenValue);
                setTokenUrl(url);

                // Schedule token refresh
                scheduleTokenRefresh(60 * 60 * 1000 - TOKEN_EXPIRY_BUFFER);

                return { token: tokenValue, url, roomName };
            } else {
                throw new Error('Invalid token response from server');
            }
        } catch (err) {
            console.error('Error fetching LiveKit token:', err);
            setError(err.message);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [candidateId, sessionId, loadCachedToken, saveTokenToCache]);

    // Schedule token refresh
    const scheduleTokenRefresh = useCallback((delay) => {
        if (refreshTimeoutRef.current) {
            clearTimeout(refreshTimeoutRef.current);
        }

        refreshTimeoutRef.current = setTimeout(() => {
            console.log('🔄 Refreshing LiveKit token...');
            fetchToken(true);
        }, delay);
    }, [fetchToken]);

    // Initialize: try to load from cache
    useEffect(() => {
        if (candidateId && sessionId) {
            loadCachedToken();
        }

        return () => {
            if (refreshTimeoutRef.current) {
                clearTimeout(refreshTimeoutRef.current);
            }
        };
    }, [candidateId, sessionId, loadCachedToken]);

    // Clear cache
    const clearCache = useCallback(() => {
        localStorage.removeItem(TOKEN_CACHE_KEY);
        setToken(null);
        setTokenUrl(null);
        if (refreshTimeoutRef.current) {
            clearTimeout(refreshTimeoutRef.current);
        }
    }, []);

    return {
        token,
        tokenUrl,
        isLoading,
        error,
        fetchToken,
        clearCache,
        refreshToken: () => fetchToken(true)
    };
};

export default useLiveKitToken;
