/**
 * AetherFS – Dropbox OAuth2 PKCE Authentication
 * Secure client-side auth without exposing App Secret
 */

const DROPBOX_APP_KEY = import.meta.env?.VITE_DROPBOX_APP_KEY || 'wdia6zo086h1n2a';
const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';

const DEBUG_AUTH = import.meta.env?.DEV === true;

const STORAGE_KEYS = {
    ACCESS_TOKEN: 'dbx_access_token',
    REFRESH_TOKEN: 'dbx_refresh_token',
    EXPIRES_AT: 'dbx_expires_at',
    CODE_VERIFIER: 'dbx_code_verifier',
    REDIRECT_URI: 'dbx_redirect_uri',
};

// Compute redirect URI once and store it so it matches exactly on callback
function _getRedirectUri() {
    // Use stored URI from the login flow, or current origin
    const stored = sessionStorage.getItem(STORAGE_KEYS.REDIRECT_URI);
    if (stored) return stored;
    // Clean URL: just origin + pathname (no trailing junk)
    const url = new URL(window.location.href);
    return url.origin + url.pathname;
}

export const DropboxAuth = {
    // ── Crypto helpers ─────────────────────────────────────
    _generateCodeVerifier() {
        // RFC 7636: 43-128 characters from unreserved URI characters
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        const arr = new Uint8Array(64);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => charset[b % charset.length]).join('');
    },

    _generateState() {
        const arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    },

    async _sha256(plain) {
        const encoder = new TextEncoder();
        const data = encoder.encode(plain);
        return await crypto.subtle.digest('SHA-256', data);
    },

    _base64urlEncode(buffer) {
        let str = '';
        const bytes = new Uint8Array(buffer);
        for (const b of bytes) str += String.fromCharCode(b);
        return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },

    // ── Public API ─────────────────────────────────────────
    isLoggedIn() {
        return !!sessionStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
    },

    async getAccessToken() {
        const token = sessionStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
        const expiresAt = parseInt(sessionStorage.getItem(STORAGE_KEYS.EXPIRES_AT) || '0', 10);

        // If token is still valid (with 5 min buffer), return it
        if (token && Date.now() < expiresAt - 300000) {
            return token;
        }

        // Try to refresh
        const refreshToken = sessionStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
        if (refreshToken) {
            try {
                return await this._refreshAccessToken(refreshToken);
            } catch (e) {
                console.error('Token refresh failed:', e);
                this.logout();
                return null;
            }
        }

        // Token expired, no refresh token
        if (token) return token; // Return it anyway, might still work
        return null;
    },

    async login() {
        // Clear any previous tokens first
        this.logout();

        const codeVerifier = this._generateCodeVerifier();
        sessionStorage.setItem(STORAGE_KEYS.CODE_VERIFIER, codeVerifier);

        const challengeBuffer = await this._sha256(codeVerifier);
        const codeChallenge = this._base64urlEncode(challengeBuffer);

        // Store redirect URI so it matches exactly during callback
        const redirectUri = _getRedirectUri();
        sessionStorage.setItem(STORAGE_KEYS.REDIRECT_URI, redirectUri);

        const state = this._generateState();
        sessionStorage.setItem('dbx_oauth_state', state);

        const params = new URLSearchParams({
            client_id: DROPBOX_APP_KEY,
            response_type: 'code',
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            redirect_uri: redirectUri,
            token_access_type: 'offline',
            state: state,
        });

        if (DEBUG_AUTH) {
            console.log('[DropboxAuth] Redirecting to Dropbox OAuth...');
            console.log('[DropboxAuth] Redirect URI:', redirectUri);
        }
        window.location.href = `${AUTH_URL}?${params.toString()}`;
    },

    logout() {
        Object.values(STORAGE_KEYS).forEach(k => sessionStorage.removeItem(k));
        sessionStorage.removeItem('dbx_oauth_state');
    },

    async handleCallback() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');

        if (!code) return false;

        // CSRF check
        const savedState = sessionStorage.getItem('dbx_oauth_state');
        if (state !== savedState) {
            console.error('[DropboxAuth] OAuth state mismatch — possible CSRF attack');
            console.error('[DropboxAuth] Expected:', savedState, 'Got:', state);
            return false;
        }
        sessionStorage.removeItem('dbx_oauth_state');

        const codeVerifier = sessionStorage.getItem(STORAGE_KEYS.CODE_VERIFIER);
        if (!codeVerifier) {
            console.error('[DropboxAuth] Missing code_verifier — auth flow broken');
            return false;
        }

        const redirectUri = _getRedirectUri();
        if (DEBUG_AUTH) {
            console.log('[DropboxAuth] Exchanging code for token...');
            console.log('[DropboxAuth] Redirect URI for token exchange:', redirectUri);
        }
        try {
            const body = new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                client_id: DROPBOX_APP_KEY,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier,
            });

            const res = await fetch(TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body.toString(),
            });

            if (!res.ok) {
                const err = await res.text();
                console.error('[DropboxAuth] Token exchange failed:', res.status, err);
                throw new Error(`Token exchange failed: ${res.status} ${err}`);
            }

            const data = await res.json();
            if (DEBUG_AUTH) console.log('[DropboxAuth] Token received successfully. Expires in:', data.expires_in, 'seconds');
            this._storeTokens(data);

            // Clean up URL (remove ?code=... from address bar)
            window.history.replaceState({}, document.title, redirectUri);

            return true;
        } catch (e) {
            console.error('[DropboxAuth] OAuth token exchange error:', e);
            return false;
        }
    },

    // ── Internal ───────────────────────────────────────────
    _storeTokens(data) {
        sessionStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, data.access_token);
        if (data.refresh_token) {
            sessionStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, data.refresh_token);
        }
        const expiresAt = Date.now() + (data.expires_in || 14400) * 1000;
        sessionStorage.setItem(STORAGE_KEYS.EXPIRES_AT, String(expiresAt));
    },

    async _refreshAccessToken(refreshToken) {
        if (DEBUG_AUTH) console.log('[DropboxAuth] Refreshing access token...');
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: DROPBOX_APP_KEY,
        });

        const res = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error('[DropboxAuth] Refresh failed:', res.status, errText);
            throw new Error(`Refresh failed: ${res.status}`);
        }

        const data = await res.json();
        if (DEBUG_AUTH) console.log('[DropboxAuth] Token refreshed successfully.');
        this._storeTokens(data);
        return data.access_token;
    },

    getAppKey() { return DROPBOX_APP_KEY; },
};
