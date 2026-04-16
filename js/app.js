/**
 * Date Palm Yield Prediction - Main Application
 * Handles UI, navigation, form validation, and orchestrates prediction.
 * Integrates with IMS Weather API for automatic weather data fetching.
 */
(function () {
    'use strict';

    // ---- Constants ----
    const IMS_API_TOKEN = 'API_KEY_VALUE';
    const DEFAULT_STATION_ID = 36; // Yotvata

    // ---- State ----
    const state = {
        currentPage: 'home',
        modelLoaded: false,
        predictor: null,
        processor: null,
        weatherClient: null,
        lastPrediction: null,
        stationsData: [],
        weatherFeatures: null, // Computed weather features from API
        isLoadingWeather: false,
    };

    // ---- DOM References ----
    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => ctx.querySelectorAll(sel);

    // ---- Initialization ----
    document.addEventListener('DOMContentLoaded', async () => {
        state.processor = new DataProcessor();
        state.predictor = new XGBoostPredictor();
        // allow disabling proxy with query string ?noProxy=1 for debugging or deployment
        const urlParams = new URLSearchParams(window.location.search);
        const disableProxy = urlParams.get('noProxy') === '1';
        const apiBase = urlParams.get('apiBase') || undefined;
        state.weatherClient = new WeatherAPIClient(IMS_API_TOKEN, { disableProxy, apiBase });

        setupNavigation();
        setupMobileMenu();
        setupTabs();
        setupAgeToggle();
        setupAnalyzeButton();
        setupWeatherControls();
        setupManualWeatherControls();
        await initSplash();

        // Load stations in background after splash
        loadStations();
    });

    // ================================================================
    //  Splash Screen
    // ================================================================
    async function initSplash() {
        const overlay = $('#splash-overlay');
        const progressBar = $('.splash-progress-bar');
        const statusText = $('.splash-status');
        const canvas = $('#splash-canvas');

        if (canvas) startNeuralAnimation(canvas);

        updateSplash(progressBar, statusText, 20, 'Initializing application...');
        await delay(400);

        updateSplash(progressBar, statusText, 50, 'Loading XGBoost model (2000 trees)...');
        const success = await state.predictor.loadModel('model/xgboost_yield_model_1a.json');
        state.modelLoaded = success;

        updateSplash(progressBar, statusText, 100, success ? 'Model loaded successfully!' : 'Model failed to load — fallback mode');
        updateModelBadge(success);
        await delay(600);

        overlay.classList.add('hidden');
    }

    function updateSplash(bar, text, pct, msg) {
        bar.style.width = pct + '%';
        text.textContent = msg;
    }

    function updateModelBadge(loaded) {
        const badge = $('#model-badge');
        if (!badge) return;
        if (loaded) {
            badge.className = 'model-badge ready';
            badge.innerHTML = '<span class="dot"></span> Model ready (2000 trees)';
        } else {
            badge.className = 'model-badge error';
            badge.innerHTML = '<span class="dot"></span> Model failed — fallback mode';
        }
    }

    // ================================================================
    //  Neural Network Animation (Splash)
    // ================================================================
    function startNeuralAnimation(canvas) {
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const nodes = [];
        const nodeCount = 30;

        for (let i = 0; i < nodeCount; i++) {
            nodes.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                size: Math.random() * 4 + 2,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                pulse: Math.random() * Math.PI * 2,
            });
        }

        const connections = [];
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const dx = nodes[i].x - nodes[j].x;
                const dy = nodes[i].y - nodes[j].y;
                if (Math.sqrt(dx * dx + dy * dy) < 250) {
                    connections.push([i, j]);
                }
            }
        }

        let animId;
        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (const n of nodes) {
                n.x += n.vx; n.y += n.vy; n.pulse += 0.03;
                if (n.x < 0 || n.x > canvas.width) n.vx *= -1;
                if (n.y < 0 || n.y > canvas.height) n.vy *= -1;
                const alpha = 0.4 + 0.3 * Math.sin(n.pulse);
                ctx.beginPath();
                ctx.arc(n.x, n.y, n.size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(96, 165, 250, ${alpha})`;
                ctx.fill();
            }
            for (const [i, j] of connections) {
                const dx = nodes[i].x - nodes[j].x;
                const dy = nodes[i].y - nodes[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 250) {
                    const alpha = 0.12 * (1 - dist / 250);
                    ctx.beginPath();
                    ctx.moveTo(nodes[i].x, nodes[i].y);
                    ctx.lineTo(nodes[j].x, nodes[j].y);
                    ctx.strokeStyle = `rgba(96, 165, 250, ${alpha})`;
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
            animId = requestAnimationFrame(animate);
        }
        animate();
        setTimeout(() => cancelAnimationFrame(animId), 5000);
    }

    // ================================================================
    //  Navigation
    // ================================================================
    function setupNavigation() {
        $$('.sidebar-nav a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                navigateTo(link.dataset.page);
            });
        });
    }

    function setupMobileMenu() {
        const toggleBtn = $('#mobile-menu-toggle');
        const backdrop = $('#mobile-menu-backdrop');
        if (!toggleBtn || !backdrop) return;

        const closeMenu = () => {
            document.body.classList.remove('mobile-menu-open');
            toggleBtn.setAttribute('aria-expanded', 'false');
        };

        const openMenu = () => {
            document.body.classList.add('mobile-menu-open');
            toggleBtn.setAttribute('aria-expanded', 'true');
        };

        toggleBtn.addEventListener('click', () => {
            if (document.body.classList.contains('mobile-menu-open')) {
                closeMenu();
            } else {
                openMenu();
            }
        });

        backdrop.addEventListener('click', closeMenu);

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeMenu();
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 800) closeMenu();
        });
    }

    function navigateTo(page) {
        state.currentPage = page;
        $$('.sidebar-nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
        $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
        // close mobile menu after selecting a page
        document.body.classList.remove('mobile-menu-open');
        const toggleBtn = $('#mobile-menu-toggle');
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
    }

    // ================================================================
    //  Tabs (Protocol Type)
    // ================================================================
    function setupTabs() {
        $$('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                const container = btn.closest('.card');
                $$('.tab-btn', container).forEach(b => b.classList.toggle('active', b === btn));
                $$('.tab-content', container).forEach(c => c.classList.toggle('active', c.id === 'tab-' + tab));
            });
        });
    }

    // ================================================================
    //  Age Input Toggle
    // ================================================================
    function setupAgeToggle() {
        $$('input[name="age-mode"]').forEach(r => r.addEventListener('change', () => {
            $('#age-direct').style.display = r.value === 'age' ? 'block' : 'none';
            $('#age-year').style.display = r.value === 'year' ? 'block' : 'none';
        }));
    }

    // ================================================================
    //  Weather API Controls
    // ================================================================
    function setupWeatherControls() {
        $('#btn-load-weather').addEventListener('click', loadWeatherData);
    }

    // ---------------------------------------------------------------
    // Manual weather features entry (fallback for CORS/API failures)
    function setupManualWeatherControls() {
        // hook manual entry link that is always present in HTML
        const link = $('#manual-entry-link');
        if (link) {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                toggleManualSection(true);
                showToast('Please fill the weather features manually.', 'info');
            });
        }

        // special example-data link fills all fields with sample values
        const exLink = $('#example-data-link');
        if (exLink) {
            exLink.addEventListener('click', (e) => {
                e.preventDefault();
                fillExampleData();
            });
        }

        $('#btn-manual-weather-done').addEventListener('click', applyManualWeather);

        // add handler for example-data button if exists elsewhere
        const exBtn = $('#btn-example-data');
        if (exBtn) exBtn.addEventListener('click', fillExampleData);

    }

    function toggleManualSection(show) {
        const cont = $('#manual-weather-container');
        if (cont) cont.style.display = show ? 'block' : 'none';
    }

    function applyManualWeather() {
        try {
            const makeVal = (sel, def) => {
                const el = $(sel);
                const v = parseFloat(el.value);
                if (isNaN(v)) throw new Error('Please enter all manual weather values');
                return v;
            };
            const features = {
                // sample defaults from user request (useful for testing)
                T_Inf_differentiation: makeVal('#manual-t-inf', 3313.3),
                H_Inf_differentiation: makeVal('#manual-h-inf', 51.2),
                E_Inf_differentiation: makeVal('#manual-e-inf', 1002.99),
                T_Flowering: makeVal('#manual-t-flow', 3026.6),
                H_Flowering: makeVal('#manual-h-flow', 43.2),
                E_Flowering: makeVal('#manual-e-flow', 709.29),
                T_Thinning: makeVal('#manual-t-thin', 7636.6),
                H_Thinning: makeVal('#manual-h-thin', 32.5),
                E_Thinning: makeVal('#manual-e-thin', 902.01),
            };
            state.weatherFeatures = features;
            displayWeatherFeatures(features);
            updateAnalyzeButton();
            showToast('Manual weather features applied.', 'success');
            toggleManualSection(false);
        } catch (err) {
            showToast(err.message, 'error');
        }
    }


    /**
     * Fill the form with published example values.
     * This sets tree age, thinning parameters and weather features.
     * Afterwards it applies the weather data automatically and updates
     * the analyze button state.
     */
    function fillExampleData() {
        // tree age field (use age mode)
        const ageRadio = $('input[name="age-mode"][value="age"]');
        if (ageRadio) ageRadio.checked = true;
        const ageInput = $('#input-age');
        if (ageInput) ageInput.value = '8';
        const plantInput = $('#input-planting-year');
        if (plantInput) plantInput.value = '';

        // thinning general controls
        $('#gen-branches').value = '25';
        $('#gen-fronds').value = '120';
        $('#gen-clusters').value = '8';

        // open manual weather section and populate fields
        toggleManualSection(true);
        $('#manual-t-inf').value = '3313.3';
        $('#manual-h-inf').value = '51.2';
        $('#manual-e-inf').value = '1002.99';
        $('#manual-t-flow').value = '3026.6';
        $('#manual-h-flow').value = '43.2';
        $('#manual-e-flow').value = '709.29';
        $('#manual-t-thin').value = '7636.6';
        $('#manual-h-thin').value = '32.5';
        $('#manual-e-thin').value = '902.01';
        try {
            applyManualWeather();
        } catch (e) {
            // ignore any parse errors
        }
        showToast('Example data loaded.', 'info');
    }

    async function loadStations() {
        const select = $('#station-select');
        // show spinner using weather-status area so user knows something is happening
        setWeatherLoading(true, 'Loading station list...');
        try {
            const stations = await state.weatherClient.getStations();
            if (!Array.isArray(stations)) throw new Error('Invalid station data');

            state.stationsData = stations.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            select.innerHTML = '<option value="">Select a station...</option>';
            let defaultIndex = -1;

            for (let i = 0; i < state.stationsData.length; i++) {
                const s = state.stationsData[i];
                const opt = document.createElement('option');
                opt.value = s.stationId;
                opt.textContent = `${s.name} (${s.stationId})`;
                select.appendChild(opt);
                if (s.stationId === DEFAULT_STATION_ID) defaultIndex = i + 1; // +1 for placeholder
            }

            if (defaultIndex > 0) select.selectedIndex = defaultIndex;
            select.disabled = false;
            $('#btn-load-weather').disabled = false;
        } catch (err) {
            select.innerHTML = '<option value="">Failed to load stations</option>';
            showToast('Failed to load stations: ' + err.message, 'error');
            // let user manually enter features if stations cannot be obtained
            toggleManualSection(true);
        } finally {
            setWeatherLoading(false, '');
        }
    }

    async function loadWeatherData() {
        const select = $('#station-select');
        const stationId = parseInt(select.value);
        if (!stationId) {
            showToast('Please select a station first.', 'error');
            return;
        }

        const currentYear = new Date().getFullYear();
        const prevYear = currentYear - 1;
        const startDate = `${prevYear}/11/01`;
        const endDate = `${currentYear}/05/15`;

        // UI: show loading
        setWeatherLoading(true, `Loading data for ${select.options[select.selectedIndex].text}...`);
        state.weatherFeatures = null;
        updateAnalyzeButton();

        try {
            setWeatherLoading(true, `Fetching historical data (${prevYear}-11-01 to ${currentYear}-05-15)...`);
            const rawResponse = await state.weatherClient.getHistoricalData(stationId, startDate, endDate);

            // Extract data array from response
            let rawDataList;
            if (rawResponse && rawResponse.data) {
                rawDataList = rawResponse.data;
            } else if (Array.isArray(rawResponse)) {
                rawDataList = rawResponse;
            } else {
                throw new Error('Unexpected data format from API');
            }

            if (!rawDataList || rawDataList.length === 0) {
                throw new Error('No data received for the requested period');
            }

            setWeatherLoading(true, `Processing ${rawDataList.length} weather records...`);

            // Process weather data
            const features = state.processor.processWeatherData(rawDataList, currentYear);
            state.weatherFeatures = features;

            // Display computed features
            displayWeatherFeatures(features);
            setWeatherLoading(false, '');
            updateAnalyzeButton();
            showToast('Weather data loaded and processed!', 'success');

        } catch (err) {
            setWeatherLoading(false, '');
            showToast('Failed to load weather data: ' + err.message, 'error');
            // show manual entry controls so user can still proceed
            toggleManualSection(true);
        }
    }

    function setWeatherLoading(loading, message) {
        state.isLoadingWeather = loading;
        const statusEl = $('#weather-status');
        const btnLoad = $('#btn-load-weather');
        const selectEl = $('#station-select');

        if (loading) {
            statusEl.style.display = 'flex';
            $('#weather-status-text').textContent = message;
            btnLoad.disabled = true;
            btnLoad.textContent = '⏳ Loading...';
            selectEl.disabled = true;
        } else {
            statusEl.style.display = 'none';
            btnLoad.disabled = false;
            btnLoad.textContent = '📡 Load Weather Data';
            selectEl.disabled = false;
        }
    }

    function displayWeatherFeatures(features) {
        const display = $('#weather-features-display');
        display.style.display = 'block';

        const fmt = (v) => typeof v === 'number' ? v.toFixed(1) : '—';

        $('#feat-t-inf').textContent = fmt(features.T_Inf_differentiation);
        $('#feat-h-inf').textContent = fmt(features.H_Inf_differentiation) + '%';
        $('#feat-e-inf').textContent = fmt(features.E_Inf_differentiation) + ' mm';

        $('#feat-t-flow').textContent = fmt(features.T_Flowering);
        $('#feat-h-flow').textContent = fmt(features.H_Flowering) + '%';
        $('#feat-e-flow').textContent = fmt(features.E_Flowering) + ' mm';

        $('#feat-t-thin').textContent = fmt(features.T_Thinning);
        $('#feat-h-thin').textContent = fmt(features.H_Thinning) + '%';
        $('#feat-e-thin').textContent = fmt(features.E_Thinning) + ' mm';

        // if we previously opened the manual section, clear it and hide it
        ['#manual-t-inf','#manual-h-inf','#manual-e-inf','#manual-t-flow','#manual-h-flow','#manual-e-flow','#manual-t-thin','#manual-h-thin','#manual-e-thin'].forEach(sel => {
            const el = $(sel);
            if (el) el.value = '';
        });
        toggleManualSection(false);
    }

    // ================================================================
    //  Analyze Button
    // ================================================================
    function setupAnalyzeButton() {
        $('#btn-analyze').addEventListener('click', runAnalysis);
    }

    function updateAnalyzeButton() {
        const btn = $('#btn-analyze');
        if (state.isLoadingWeather) {
            btn.disabled = true;
            btn.innerHTML = '⏳ Processing weather data...';
        } else if (!state.weatherFeatures) {
            btn.disabled = true;
            btn.innerHTML = '⚠️ Load Weather Data First';
        } else {
            btn.disabled = false;
            btn.innerHTML = '🔬 Analyze & Generate Prediction';
        }
    }

    // ================================================================
    //  Run Analysis
    // ================================================================
    function runAnalysis() {
        try {
            $$('input.error').forEach(i => i.classList.remove('error'));

            const treeAge = getTreeAge();
            const activeTab = $('.tab-btn.active').dataset.tab;
            const protocolType = activeTab === 'general' ? 'general' : 'by_generation';
            const thinning = getThinningData(protocolType);

            // Use weather features from API
            if (!state.weatherFeatures) {
                throw new Error('Please load weather data first.');
            }
            const weather = state.weatherFeatures;

            const currentYear = new Date().getFullYear();
            const features = state.processor.prepareInputVector({
                treeAge, year: currentYear, protocolType, thinning, weather
            });

            let meanYield, stdYield;
            if (state.modelLoaded) {
                meanYield = state.predictor.predictFromObject(features);
                // model can occasionally produce slightly negative numbers; clamp to 0
                meanYield = Math.max(0, meanYield);
                stdYield = Math.abs(meanYield) * 0.15;
            } else {
                meanYield = state.processor.fallbackPrediction({ treeAge, protocolType, thinning });
                stdYield = meanYield * 0.20;
            }

            state.lastPrediction = { meanYield, stdYield, features };
            displayResults(meanYield, stdYield, features);
            navigateTo('results');
            showToast('Analysis completed successfully!', 'success');

        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    // ================================================================
    //  Input Parsing
    // ================================================================
    function getTreeAge() {
        const mode = $('input[name="age-mode"]:checked')?.value || 'age';
        if (mode === 'age') {
            const val = parsePositiveInt('#input-age', 'Tree age');
            if (val < 1 || val > 100) throw new Error('Tree age must be between 1 and 100.');
            return val;
        } else {
            const year = parsePositiveInt('#input-planting-year', 'Planting year');
            const currentYear = new Date().getFullYear();
            const age = currentYear - year;
            if (age < 1 || age > 100) throw new Error('Calculated age is not in a reasonable range (1-99).');
            return age;
        }
    }

    function getThinningData(protocolType) {
        if (protocolType === 'general') {
            return {
                branches: parsePositiveInt('#gen-branches', 'Avg. strands per bunch'),
                fronds: parsePositiveInt('#gen-fronds', 'Avg. fruitlets per strand'),
                clusters: parsePositiveInt('#gen-clusters', 'Total bunches'),
            };
        } else {
            return {
                clusters: parsePositiveInt('#byg-clusters', 'Number of bunches'),
                upper: {
                    branches: parsePositiveInt('#byg-upper-branches', 'Strands per bunch (upper)'),
                    fronds: parsePositiveInt('#byg-upper-fronds', 'Fruitlets per strand (upper)'),
                },
                middle: {
                    branches: parsePositiveInt('#byg-middle-branches', 'Strands per bunch (middle)'),
                    fronds: parsePositiveInt('#byg-middle-fronds', 'Fruitlets per strand (middle)'),
                },
                lower: {
                    branches: parsePositiveInt('#byg-lower-branches', 'Strands per bunch (lower)'),
                    fronds: parsePositiveInt('#byg-lower-fronds', 'Fruitlets per strand (lower)'),
                },
            };
        }
    }

    function parsePositiveInt(selector, fieldName) {
        const el = $(selector);
        const text = el.value.trim();
        if (!text) {
            el.classList.add('error');
            throw new Error(`Please enter a value for: ${fieldName}`);
        }
        const val = parseInt(text, 10);
        if (isNaN(val) || val <= 0) {
            el.classList.add('error');
            throw new Error(`"${fieldName}" must be a positive number.`);
        }
        return val;
    }

    // ================================================================
    //  Display Results
    // ================================================================
    function displayResults(mean, std, features) {
        $('.results-placeholder').style.display = 'none';
        $('.results-content').classList.add('visible');

        $('#prediction-value').textContent = `🌴 Predicted Yield: ${mean.toFixed(1)} kg/tree`;
        $('#confidence-text').innerHTML =
            `68% Confidence: ${(mean - std).toFixed(1)} – ${(mean + std).toFixed(1)} kg<br>` +
            `95% Confidence: ${(mean - 2 * std).toFixed(1)} – ${(mean + 2 * std).toFixed(1)} kg`;

        drawBellCurve(mean, std);
        buildFeatureTable(features);
    }

    // ================================================================
    //  Bell Curve Chart (Canvas)
    // ================================================================
    function drawBellCurve(mean, std) {
        const canvas = $('#chart-canvas');
        const ctx = canvas.getContext('2d');

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        const W = rect.width;
        const H = rect.height;

        ctx.clearRect(0, 0, W, H);

        const margin = { top: 40, right: 30, bottom: 50, left: 20 };
        const cw = W - margin.left - margin.right;
        const ch = H - margin.top - margin.bottom;

        const xMin = mean - 4 * std;
        const xMax = mean + 4 * std;

        function normalPdf(x, mu, sigma) {
            const z = (x - mu) / sigma;
            return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
        }

        const points = [];
        const steps = 300;
        let yMax = 0;
        for (let i = 0; i <= steps; i++) {
            const x = xMin + (xMax - xMin) * (i / steps);
            const y = normalPdf(x, mean, std);
            if (y > yMax) yMax = y;
            points.push({ x, y });
        }

        const sx = x => margin.left + ((x - xMin) / (xMax - xMin)) * cw;
        const sy = y => margin.top + (1 - y / (yMax * 1.1)) * ch;

        ctx.fillStyle = '#F8FAFC';
        ctx.fillRect(0, 0, W, H);

        ctx.strokeStyle = '#E5E7EB';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = margin.top + (ch / 4) * i;
            ctx.beginPath();
            ctx.moveTo(margin.left, y);
            ctx.lineTo(margin.left + cw, y);
            ctx.stroke();
        }

        // 95% fill
        ctx.beginPath();
        let started = false;
        for (const p of points) {
            if (p.x >= mean - 2 * std && p.x <= mean + 2 * std) {
                if (!started) { ctx.moveTo(sx(p.x), sy(0)); started = true; }
                ctx.lineTo(sx(p.x), sy(p.y));
            }
        }
        ctx.lineTo(sx(mean + 2 * std), sy(0));
        ctx.closePath();
        ctx.fillStyle = 'rgba(96, 165, 250, 0.15)';
        ctx.fill();

        // 68% fill
        ctx.beginPath();
        started = false;
        for (const p of points) {
            if (p.x >= mean - std && p.x <= mean + std) {
                if (!started) { ctx.moveTo(sx(p.x), sy(0)); started = true; }
                ctx.lineTo(sx(p.x), sy(p.y));
            }
        }
        ctx.lineTo(sx(mean + std), sy(0));
        ctx.closePath();
        ctx.fillStyle = 'rgba(96, 165, 250, 0.35)';
        ctx.fill();

        // Curve
        ctx.beginPath();
        ctx.moveTo(sx(points[0].x), sy(points[0].y));
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(sx(points[i].x), sy(points[i].y));
        }
        ctx.strokeStyle = '#3B82F6';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Mean line
        ctx.beginPath();
        ctx.moveTo(sx(mean), sy(0));
        ctx.lineTo(sx(mean), sy(normalPdf(mean, mean, std)));
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // X-axis labels
        ctx.fillStyle = '#6B7280';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        const tickValues = [
            mean - 3 * std, mean - 2 * std, mean - std, mean, mean + std, mean + 2 * std, mean + 3 * std
        ];
        for (const tv of tickValues) {
            if (tv >= xMin && tv <= xMax) {
                ctx.fillText(tv.toFixed(0), sx(tv), margin.top + ch + 20);
            }
        }
        ctx.fillText('Yield Prediction (kg/tree)', W / 2, H - 8);

        // Title
        ctx.fillStyle = '#1F2937';
        ctx.font = 'bold 15px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('XGBoost Model 1A — Yield Prediction Distribution', W / 2, 22);

        // Legend
        const legendX = W - margin.right - 200;
        const legendY = margin.top + 10;
        const legendItems = [
            { color: '#3B82F6', label: 'Yield Distribution' },
            { color: 'rgba(96,165,250,0.55)', label: '68% Confidence', fill: true },
            { color: 'rgba(96,165,250,0.25)', label: '95% Confidence', fill: true },
            { color: '#F59E0B', label: `Predicted: ${mean.toFixed(1)} kg` },
        ];
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'left';
        legendItems.forEach((item, i) => {
            const y = legendY + i * 18;
            if (item.fill) {
                ctx.fillStyle = item.color;
                ctx.fillRect(legendX, y - 6, 14, 12);
            } else {
                ctx.strokeStyle = item.color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(legendX, y);
                ctx.lineTo(legendX + 14, y);
                ctx.stroke();
            }
            ctx.fillStyle = '#374151';
            ctx.fillText(item.label, legendX + 20, y + 3);
        });
    }

    // ================================================================
    //  Feature Table
    // ================================================================
    function buildFeatureTable(features) {
        const tbody = $('#feature-tbody');
        tbody.innerHTML = '';
        const labels = {
            'Tree age': '🌴 Tree Age (years)',
            'year': '📅 Year',
            'Thinning_Upper_Fruits Bunch-1': '🔼 Upper Fruits/Bunch',
            'Thinning_Center_Fruits Bunch-1': '▶️ Center Fruits/Bunch',
            'Thinning_Lower_Fruits Bunch-1': '🔽 Lower Fruits/Bunch',
            'Thinning_Bunches': '🏷️ Total Bunches',
            'Thinning_Fruits Tree-1': '🌳 Total Fruits/Tree',
            'T_Inf_differentiation': '🌡️ Heat Hours (Differentiation)',
            'T_Flowering': '🌡️ Heat Hours (Flowering)',
            'T_Thinning': '🌡️ Heat Hours (Thinning)',
            'H_Inf_differentiation': '💧 Avg Humidity (Differentiation)',
            'H_Flowering': '💧 Avg Humidity (Flowering)',
            'H_Thinning': '💧 Avg Humidity (Thinning)',
            'E_Inf_differentiation': '☀️ Evaporation (Differentiation)',
            'E_Flowering': '☀️ Evaporation (Flowering)',
            'E_Thinning': '☀️ Evaporation (Thinning)',
        };
        for (const [key, val] of Object.entries(features)) {
            const tr = document.createElement('tr');
            const label = labels[key] || key;
            const formatted = typeof val === 'number' ? (Number.isInteger(val) ? val : val.toFixed(2)) : val;
            tr.innerHTML = `<td>${label}</td><td>${formatted}</td>`;
            tbody.appendChild(tr);
        }
    }

    // ================================================================
    //  Toast
    // ================================================================
    function showToast(msg, type = '') {
        let toast = $('#app-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'app-toast';
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.className = 'toast ' + type;
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => toast.classList.remove('show'), 3500);
    }

    // ================================================================
    //  Utility
    // ================================================================
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

})();
