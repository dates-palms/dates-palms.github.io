/**
 * IMS (Israeli Meteorological Service) Weather API Client
 * Uses a free CORS proxy to bypass browser CORS restrictions.
 */
class WeatherAPIClient {
    /**
     * @param {string} apiToken - IMS API token
     * @param {object} [options]
     * @param {boolean} [options.disableProxy=false] - when true, requests are made directly (may be blocked by CORS)
     * @param {string[]} [options.corsProxies] - list of proxy prefixes to try in order
     */
    constructor(apiToken, options = {}) {
        this.apiToken = apiToken;
        // allow caller to override the base URL (e.g. point at a local proxy)
        this.baseUrl = options.apiBase || 'https://api.ims.gov.il/v1/envista';
        // if user provided a custom base or explicitly disabled proxy, skip the
        // public proxy list entirely.  this avoids wrapping a local proxy URL
        // inside another proxy (which would not work and triggers CORS/404).
        this.disableProxy = !!options.disableProxy || !!options.apiBase;
        // default proxy list; additional proxies can be supplied via options
        this.corsProxies = options.corsProxies || [
            'https://corsproxy.io/?',
            'https://api.allorigins.win/raw?url=',
            'https://thingproxy.freeboard.io/fetch/'
        ];

        console.log('WeatherAPIClient initialized', { baseUrl: this.baseUrl, disableProxy: this.disableProxy });
    }

    /**
     * Internal fetch helper with authorization header and CORS proxy
     */
    /**
     * Internal fetch helper with optional CORS proxy fallback list
     */
    async _fetch(url, timeout = 15000) {
        // build list of prefixes to try; include direct URL as last fallback unless disabled
        const prefixes = this.disableProxy
            ? ['']
            : [...this.corsProxies, ''];

        let lastError;
        for (const prefix of prefixes) {
            // some proxies expect the target URL to be URI-encoded
            let candidate;
            if (!prefix) {
                candidate = url; // direct call
            } else if (prefix.endsWith('?') || prefix.endsWith('=')) {
                candidate = prefix + encodeURIComponent(url);
            } else {
                candidate = prefix + url;
            }
            try {
                return await this._doFetch(candidate, timeout);
            } catch (e) {
                const label = prefix || 'direct';
                console.warn(`fetch attempt failed (${label})`, e.message || e);
                lastError = e;
                // try next prefix
            }
        }
        // if we got here, all prefixes failed; throw last error
        throw lastError || new Error('All fetch attempts failed');
    }

    // helper to perform a single fetch call and check status
    async _doFetch(fullUrl, timeout) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(fullUrl, {
                headers: { 'Authorization': `ApiToken ${this.apiToken}` },
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

            // read as text first so we can detect non-JSON bodies returned by proxies
            const text = await response.text();
            if (!text) throw new Error('Empty response body');
            try {
                return JSON.parse(text);
            } catch (parseErr) {
                // invalid JSON; include a snippet for debugging
                const snippet = text.slice(0, 500);
                throw new Error(`Invalid JSON response: ${snippet}`);
            }
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') throw new Error('Request timed out');
            throw err;
        }
    }

    /**
     * Get list of all meteorological stations
     */
    async getStations() {
        // Attempt to load a locally cached copy of the station list first.  This
        // allows the application to work entirely client‑side (no CORS or proxy
        // required) if the file is shipped with the web assets.  If the local file
        // is missing or cannot be parsed, fall back to the network call with
        // potential proxy/CORS handling.
        try {
            const res = await fetch('js/stations.json', {cache: 'no-store'});
            if (res.ok) {
                const data = await res.json();
                // we expect an array, but let caller validate
                return data;
            }
        } catch (e) {
            // ignore failure and continue to network fetch
            console.warn('local stations.json load failed:', e.message || e);
        }

        // network fallback (may fail due to CORS/proxy issues)
        return this._fetch(`${this.baseUrl}/stations`);
    }

    /**
     * Get historical data from a station by date range
     */
    async getHistoricalData(stationId, startDate, endDate) {
        const url = `${this.baseUrl}/stations/${stationId}/data?from=${startDate}&to=${endDate}`;
        return this._fetch(url, 60000); // 60s timeout for large data
    }
}

window.WeatherAPIClient = WeatherAPIClient;