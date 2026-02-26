/**
 * AetherFS – Yandex Disk OAuth2 Authentication
 * Uses the Implicit flow since Yandex doesn't support PKCE well for SPA yet,
 * or Authorization Code flow if a server/proxy is used. We'll use Token Flow (Implicit)
 * where the token is returned in the URL hash.
 */

const YANDEX_CLIENT_ID = import.meta.env?.VITE_YANDEX_CLIENT_ID || 'a774e92233274ef5a75f291885f8bcc6'; // Fallback to provided or specific ID
const AUTH_URL = 'https://oauth.yandex.ru/authorize';

const DEBUG_AUTH = import.meta.env?.DEV === true;

const STORAGE_KEYS = {
    ACCESS_TOKEN: 'ya_access_token',
    EXPIRES_AT: 'ya_expires_at',
};

export const YandexAuth = {
    isLoggedIn() {
        return !!sessionStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
    },

    getAccessToken() {
        const token = sessionStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
        const expiresAt = parseInt(sessionStorage.getItem(STORAGE_KEYS.EXPIRES_AT) || '0', 10);

        // If token is still valid (with 5 min buffer), return it
        if (token && Date.now() < expiresAt - 300000) {
            return token;
        }

        if (token) return token; // Might still work
        return null;
    },

    login() {
        this.logout();

        // Use the manual verification code flow since the redirect URI is locked
        const params = new URLSearchParams({
            response_type: 'token',
            client_id: YANDEX_CLIENT_ID,
            force_confirm: 'yes',
            redirect_uri: 'https://oauth.yandex.ru/verification_code',
        });

        if (DEBUG_AUTH) {
            console.log('[YandexAuth] Redirecting to Yandex OAuth (Manual Flow)...');
        }
        window.location.href = `${AUTH_URL}?${params.toString()}`;
    },

    logout() {
        Object.values(STORAGE_KEYS).forEach(k => sessionStorage.removeItem(k));
    },

    /**
     * Checks the URL hash for Yandex OAuth response (access_token)
     * Yandex returns it as #access_token=...&expires_in=...
     */
    handleCallback() {
        const hash = window.location.hash.substring(1);
        if (!hash) return false;

        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');
        const expiresIn = params.get('expires_in'); // in seconds

        if (accessToken) {
            if (DEBUG_AUTH) console.log('[YandexAuth] Token received successfully. Expires in:', expiresIn, 'seconds');

            this._storeTokens({
                access_token: accessToken,
                expires_in: parseInt(expiresIn || '31536000', 10) // default 1 year if not provided
            });

            // Clean up URL hash
            window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
            return true;
        }

        return false;
    },

    /**
     * Manually set the access token from user input
     * @param {string} token 
     */
    manuallySetToken(token) {
        if (!token) return false;

        // Strip out the #access_token=... if the user copied the whole hash
        let parsedToken = token;
        if (token.includes('access_token=')) {
            const params = new URLSearchParams(token.startsWith('#') ? token.substring(1) : token);
            parsedToken = params.get('access_token');
        }

        if (parsedToken) {
            this._storeTokens({
                access_token: parsedToken,
                expires_in: 31536000 // default 1 year
            });
            return true;
        }
        return false;
    },

    _storeTokens(data) {
        sessionStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, data.access_token);
        const expiresAt = Date.now() + (data.expires_in) * 1000;
        sessionStorage.setItem(STORAGE_KEYS.EXPIRES_AT, String(expiresAt));
    },

    getClientId() { return YANDEX_CLIENT_ID; },
};
