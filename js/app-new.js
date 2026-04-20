(function () {
    'use strict';

    const IMS_API_TOKEN = 'API_KEY_VALUE';

    const MODEL_CONFIGS = {
        yield: {
            key: 'yield',
            title: 'Predict Tree Yield (kg)',
            description: 'Predict tree yield in kilograms without climate data.',
            modelUrl: 'model/rf_model_Model1_DropRows_Thinning_(1A)%20No%20Climate.js',
            lateModelUrl: 'model/xgboost_late_count_Model1_DropRows_Coverage_1B_NoClimate.js',
            requiresClimate: false,
            resultType: 'yield',
        },
        skin: {
            key: 'skin',
            title: 'Skin separation distribution',
            description: 'Predict skin separation distribution using climate data.',
            modelUrl: 'model/xgboost_skin_model_1a.json',
            requiresClimate: true,
            resultType: 'distribution',
        },
    };

    const state = {
        currentPage: 'home',
        activeModel: null,
        processor: null,
        predictors: {},
        modelLoaded: {},
        weatherClient: null,
        stationsData: [],
        weatherFeatures: null,
        selectedStationId: null,
        selectedStationLabel: 'N/A',
        isLoadingWeather: false,
        lastPrediction: null,
    };

    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

    document.addEventListener('DOMContentLoaded', async () => {
        state.processor = new DataProcessor();
        state.predictors.yieldEarly = new RFPredictor();
        state.predictors.yieldLate = new XGBoostPredictor();
        state.predictors.skin = new XGBoostPredictor();
        state.weatherClient = new WeatherAPIClient(IMS_API_TOKEN, { disableProxy: false });

        await initializeModels();

        setupPageButtons();
        setupHomeCards();
        setupTabs();
        setupYieldControls();
        setupAgeToggle();
        setupWeatherControls();
        setupManualWeatherControls();
        setupStartButtons();
        renderCurrentPage();

        loadStations();
    });

    async function initializeModels() {
        const yieldEarlyLoaded = await state.predictors.yieldEarly.loadModel(MODEL_CONFIGS.yield.modelUrl);
        const yieldLateLoaded = await state.predictors.yieldLate.loadModel(MODEL_CONFIGS.yield.lateModelUrl);
        state.modelLoaded.yieldEarly = yieldEarlyLoaded;
        state.modelLoaded.yieldLate = yieldLateLoaded;
        state.modelLoaded.yield = yieldEarlyLoaded && yieldLateLoaded;
        state.modelLoaded.skin = false;
        updateModelStatus();
    }

    function updateModelStatus() {
        const badge = $('#model-status');
        if (!badge) return;
        const statusItems = Object.entries(MODEL_CONFIGS).map(([key, cfg]) => {
            return `${cfg.title}: ${state.modelLoaded[key] ? 'ready' : 'fallback'}`;
        });
        badge.textContent = statusItems.join(' • ');
    }

    function setSplashStatus(message) {
        const status = $('#splash-status');
        if (status) status.textContent = message;
    }

    function updateSplashBar(percent) {
        const bar = $('#splash-progress-bar');
        if (bar) {
            bar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
        }
    }

    function setupHomeCards() {
        $$('.home-card').forEach(card => {
            card.addEventListener('click', () => {
                const target = card.dataset.target;
                selectModel(target);
            });
        });
    }

    function setupPageButtons() {
        const homeBtn = $('#btn-home');
        const backBtn = $('#btn-back');
        const bugBtn = $('#btn-report-bug');
        if (homeBtn) homeBtn.addEventListener('click', () => navigateTo('home'));
        if (backBtn) backBtn.addEventListener('click', () => navigateBack());
        if (bugBtn) bugBtn.addEventListener('click', () => toggleBugPopup(true));

        const closeBug = $('#btn-close-bug');
        if (closeBug) closeBug.addEventListener('click', () => toggleBugPopup(false));
        const bugPopup = $('#bug-popup');
        if (bugPopup) bugPopup.addEventListener('click', (event) => {
            if (event.target === bugPopup) toggleBugPopup(false);
        });
    }

    function toggleBugPopup(show) {
        const popup = $('#bug-popup');
        if (!popup) return;
        popup.classList.toggle('hidden', !show);
    }

    function navigateBack() {
        if (state.currentPage === 'results') {
            navigateTo(state.activeModel || 'home');
        } else {
            navigateTo('home');
        }
    }

    function selectModel(key) {
        if (!MODEL_CONFIGS[key]) return;
        state.activeModel = key;
        state.currentPage = key;
        state.weatherFeatures = null;
        state.selectedStationId = null;
        state.selectedStationLabel = 'N/A';
        updateTopbar(MODEL_CONFIGS[key].title);
        renderCurrentPage();
    }

    function navigateTo(page) {
        state.currentPage = page;
        if (page === 'home') {
            state.activeModel = null;
            updateTopbar('Mejhoul Thinning Management Decision-Support System');
        } else if (page === 'results') {
            updateTopbar('Prediction Results');
        } else if (MODEL_CONFIGS[page]) {
            state.activeModel = page;
            updateTopbar(MODEL_CONFIGS[page].title);
        }
        renderCurrentPage();
    }

    function renderCurrentPage() {
        $$('.page').forEach(page => {
            page.classList.toggle('active', page.id === 'page-' + state.currentPage);
        });

        const homeBtn = $('#btn-home');
        const backBtn = $('#btn-back');
        if (homeBtn) homeBtn.style.display = state.currentPage === 'home' ? 'none' : 'inline-flex';
        if (backBtn) backBtn.style.display = state.currentPage === 'home' ? 'none' : 'inline-flex';

        if (state.currentPage === 'results' && state.lastPrediction) {
            displayResults(state.lastPrediction.meanYield, state.lastPrediction.stdYield, state.lastPrediction.features);
        }

        if (state.currentPage === 'home') {
            startHomeTyping();
        }

        updateAnalyzeButton();
    }

    async function startHomeTyping() {
        const heading = $('#home-heading');
        const subtitle = $('#home-subtitle');
        if (!heading || !subtitle) return;

        const headingText = heading.dataset.liveText || heading.textContent.trim();
        const subtitleText = subtitle.dataset.liveText || subtitle.textContent.trim();

        heading.textContent = '';
        subtitle.textContent = '';
        heading.classList.add('typing-cursor');
        subtitle.classList.remove('typing-cursor');

        await typeText(heading, headingText, 50);
        heading.classList.remove('typing-cursor');
        subtitle.classList.add('typing-cursor');
        await typeText(subtitle, subtitleText, 30);
        subtitle.classList.remove('typing-cursor');
    }

    function typeText(element, text, delay) {
        return new Promise(resolve => {
            let index = 0;
            const step = () => {
                if (index <= text.length) {
                    element.textContent = text.slice(0, index);
                    index += 1;
                    setTimeout(step, delay);
                } else {
                    resolve();
                }
            };
            step();
        });
    }

    function updateTopbar(title) {
        const titleEl = $('#topbar-title');
        if (titleEl) titleEl.textContent = title;
    }

    function setupTabs() {
        $$('.tab-btn').forEach(button => {
            button.addEventListener('click', () => {
                const container = button.closest('.card');
                if (!container) return;
                const tab = button.dataset.tab;
                $$('.tab-btn', container).forEach(item => item.classList.toggle('active', item === button));
                $$('.tab-content', container).forEach(content => {
                    content.classList.toggle('active', content.id === 'tab-' + tab);
                });
            });
        });
    }

    function setupAgeToggle() {
        $$('input[name="age-mode"]').forEach(radio => {
            radio.addEventListener('change', () => {
                const page = radio.closest('.page');
                if (!page) return;
                const isAge = radio.value === 'age';
                const direct = page.querySelector('#age-direct');
                const year = page.querySelector('#age-year');
                if (direct) direct.style.display = isAge ? 'block' : 'none';
                if (year) year.style.display = isAge ? 'none' : 'block';
            });
        });
    }

    function setupYieldControls() {
        const page = $('#page-yield');
        if (!page) return;
        if (window.YieldMode && typeof window.YieldMode.init === 'function') {
            window.YieldMode.init(page);
        }
    }

    function setupWeatherControls() {
        const weatherBtn = $('#btn-load-weather');
        if (weatherBtn) weatherBtn.addEventListener('click', loadWeatherData);
        const stationSelect = $('#station-select');
        if (stationSelect) {
            stationSelect.addEventListener('change', () => {
                state.selectedStationId = stationSelect.value;
                state.selectedStationLabel = stationSelect.options[stationSelect.selectedIndex]?.text || 'N/A';
                updateAnalyzeButton();
            });
        }
    }

    function setupManualWeatherControls() {
        const manualLink = $('#manual-entry-link');
        if (manualLink) {
            manualLink.addEventListener('click', event => {
                event.preventDefault();
                toggleManualSection(true);
                showToast('Please fill the weather features manually.', 'info');
            });
        }

        const manualDone = $('#btn-manual-weather-done');
        if (manualDone) manualDone.addEventListener('click', applyManualWeather);
    }

    function setupStartButtons() {
        const yieldButton = $('#btn-start-yield');
        const skinButton = $('#btn-start-skin');
        if (yieldButton) yieldButton.addEventListener('click', () => runAnalysis('yield'));
        if (skinButton) skinButton.addEventListener('click', () => runAnalysis('skin'));
    }

    function updateAnalyzeButton() {
        const skinButton = $('#btn-start-skin');
        if (skinButton) {
            if (!state.weatherFeatures) {
                skinButton.disabled = true;
                skinButton.textContent = 'Load climate data first';
            } else {
                skinButton.disabled = false;
                skinButton.textContent = 'Start prediction';
            }
        }
    }

    async function loadStations() {
        const select = $('#station-select');
        if (!select) return;

        setWeatherLoading(true, 'Loading station list...');
        try {
            const stations = await state.weatherClient.getStations();
            if (!Array.isArray(stations)) throw new Error('Invalid station list');
            state.stationsData = stations.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            select.innerHTML = '<option value="">Select a station...</option>';
            state.stationsData.forEach(station => {
                const option = document.createElement('option');
                option.value = station.stationId;
                option.textContent = `${station.name} (${station.stationId})`;
                select.appendChild(option);
            });
            select.disabled = false;
        } catch (err) {
            select.innerHTML = '<option value="">Failed to load stations</option>';
            showToast('Failed to load stations: ' + err.message, 'error');
            toggleManualSection(true);
        } finally {
            setWeatherLoading(false, '');
        }
    }

    async function loadWeatherData() {
        const select = $('#station-select');
        if (!select || !select.value) {
            showToast('Please select a station first.', 'error');
            return;
        }

        const stationName = select.options[select.selectedIndex]?.text || 'station';
        state.selectedStationId = select.value;
        state.selectedStationLabel = stationName;

        const currentYear = new Date().getFullYear();
        const prevYear = currentYear - 1;
        const startDate = `${prevYear}/11/01`;
        const endDate = `${currentYear}/05/15`;

        setWeatherLoading(true, `Loading station data for ${stationName}...`);
        state.weatherFeatures = null;
        updateAnalyzeButton();

        try {
            const rawResponse = await state.weatherClient.getHistoricalData(state.selectedStationId, startDate, endDate);
            let rawDataList;
            if (rawResponse && rawResponse.data) rawDataList = rawResponse.data;
            else if (Array.isArray(rawResponse)) rawDataList = rawResponse;
            else throw new Error('Unexpected response format');

            if (!rawDataList || rawDataList.length === 0) throw new Error('No station data received');

            setWeatherLoading(true, `Processing ${rawDataList.length} records...`);
            const features = state.processor.processWeatherData(rawDataList, currentYear);
            state.weatherFeatures = features;
            displayWeatherFeatures(features);
            showToast('Weather data loaded and processed.', 'success');
        } catch (err) {
            showToast('Failed to load weather data: ' + err.message, 'error');
            toggleManualSection(true);
        } finally {
            setWeatherLoading(false, '');
            updateAnalyzeButton();
        }
    }

    function setWeatherLoading(loading, message) {
        state.isLoadingWeather = loading;
        const statusEl = $('#weather-status');
        const btnLoad = $('#btn-load-weather');
        const select = $('#station-select');

        if (!statusEl || !btnLoad || !select) return;

        if (loading) {
            statusEl.style.display = 'flex';
            $('#weather-status-text').textContent = message;
            btnLoad.disabled = true;
            btnLoad.textContent = '⏳ Loading...';
            select.disabled = true;
        } else {
            statusEl.style.display = 'none';
            btnLoad.disabled = false;
            btnLoad.textContent = '📡 Load Station Data';
            select.disabled = false;
        }
    }

    function displayWeatherFeatures(features) {
        const display = $('#weather-features-display');
        if (!display) return;
        display.style.display = 'block';
        const fmt = value => typeof value === 'number' ? value.toFixed(1) : '—';

        $('#feat-t-inf').textContent = fmt(features.T_Inf_differentiation);
        $('#feat-h-inf').textContent = fmt(features.H_Inf_differentiation) + '%';
        $('#feat-e-inf').textContent = fmt(features.E_Inf_differentiation) + ' mm';

        $('#feat-t-flow').textContent = fmt(features.T_Flowering);
        $('#feat-h-flow').textContent = fmt(features.H_Flowering) + '%';
        $('#feat-e-flow').textContent = fmt(features.E_Flowering) + ' mm';

        $('#feat-t-thin').textContent = fmt(features.T_Thinning);
        $('#feat-h-thin').textContent = fmt(features.H_Thinning) + '%';
        $('#feat-e-thin').textContent = fmt(features.E_Thinning) + ' mm';
    }

    function toggleManualSection(show) {
        const container = $('#manual-weather-container');
        if (!container) return;
        container.style.display = show ? 'block' : 'none';
    }

    function applyManualWeather() {
        try {
            const makeVal = (selector) => {
                const element = $(selector);
                if (!element) throw new Error('Missing input field.');
                const value = parseFloat(element.value);
                if (isNaN(value)) throw new Error('Please enter all manual weather values.');
                return value;
            };

            const features = {
                T_Inf_differentiation: makeVal('#manual-t-inf'),
                H_Inf_differentiation: makeVal('#manual-h-inf'),
                E_Inf_differentiation: makeVal('#manual-e-inf'),
                T_Flowering: makeVal('#manual-t-flow'),
                H_Flowering: makeVal('#manual-h-flow'),
                E_Flowering: makeVal('#manual-e-flow'),
                T_Thinning: makeVal('#manual-t-thin'),
                H_Thinning: makeVal('#manual-h-thin'),
                E_Thinning: makeVal('#manual-e-thin'),
            };

            state.weatherFeatures = features;
            displayWeatherFeatures(features);
            toggleManualSection(false);
            updateAnalyzeButton();
            showToast('Manual weather features applied.', 'success');
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    function runAnalysis(pageKey) {
        try {
            const pageSection = $('#page-' + pageKey);
            if (!pageSection) throw new Error('Page not found.');

            const currentYear = new Date().getFullYear();
            let features;
            let treeAge;
            let protocolType;
            let thinning;
            let yieldScenario = 'early_counting';

            if (pageKey === 'skin') {
                if (!state.weatherFeatures) throw new Error('Please load climate data before starting the prediction.');

                const baseInputs = window.SkinMode && typeof window.SkinMode.getBaseInputs === 'function'
                    ? window.SkinMode.getBaseInputs()
                    : {
                        treeAge: 8,
                        protocolType: 'general',
                        thinning: { branches: 25, fronds: 120, clusters: 8 },
                    };

                treeAge = baseInputs.treeAge;
                protocolType = baseInputs.protocolType;
                thinning = baseInputs.thinning;

                features = state.processor.prepareInputVector({
                    treeAge,
                    year: currentYear,
                    protocolType,
                    thinning,
                    weather: state.weatherFeatures,
                });
            } else {
                treeAge = getTreeAge(pageSection);
                protocolType = getActiveProtocol(pageSection);
                thinning = getThinningData(pageSection, protocolType);
                if (window.YieldMode && typeof window.YieldMode.getScenario === 'function') {
                    yieldScenario = window.YieldMode.getScenario(pageSection);
                }

                features = buildYieldFeatureObject(treeAge, protocolType, thinning, yieldScenario);
            }

            let meanYield, stdYield;
            let modelReady = state.modelLoaded[pageKey];
            let predictor = state.predictors[pageKey];

            if (pageKey === 'yield') {
                const isLateScenario = yieldScenario === 'late_counting';
                modelReady = isLateScenario ? state.modelLoaded.yieldLate : state.modelLoaded.yieldEarly;
                predictor = isLateScenario ? state.predictors.yieldLate : state.predictors.yieldEarly;
            }

            if (modelReady) {
                meanYield = predictor.predictFromObject(features);
                meanYield = Math.max(0, meanYield);
                stdYield = Math.abs(meanYield) * 0.15;
            } else {
                meanYield = state.processor.fallbackPrediction({ treeAge, protocolType, thinning });
                stdYield = meanYield * 0.20;
            }

            state.lastPrediction = { meanYield, stdYield, features, yieldScenario };
            navigateTo('results');
            showToast('Prediction generated successfully.', 'success');
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    function buildYieldFeatureObject(treeAge, protocolType, thinning, yieldScenario = 'early_counting') {
        let upperFruits;
        let centerFruits;
        let lowerFruits;
        let bunches;

        if (protocolType === 'general') {
            const fruitsPerBunch = thinning.branches * thinning.fronds;
            upperFruits = fruitsPerBunch;
            centerFruits = fruitsPerBunch;
            lowerFruits = fruitsPerBunch;
            bunches = thinning.clusters;
        } else {
            upperFruits = thinning.upper.branches * thinning.upper.fronds;
            centerFruits = thinning.middle.branches * thinning.middle.fronds;
            lowerFruits = thinning.lower.branches * thinning.lower.fronds;
            bunches = thinning.clusters;
        }

        if (yieldScenario === 'late_counting') {
            const weightedFruitsPerBunch =
                (0.25 * upperFruits) +
                (0.5 * centerFruits) +
                (0.25 * lowerFruits);
            const totalFruitLoad = bunches * weightedFruitsPerBunch;

            return {
                'Tree age': treeAge,
                'Coverage_Upper_Fruits Bunch-1': upperFruits,
                'Coverage_Center_Fruits Bunch-1': centerFruits,
                'Coverage_Lower_Fruits Bunch-1': lowerFruits,
                'Coverage_Bunches': bunches,
                'Coverage_Fruits Tree-1': totalFruitLoad,
            };
        }

        return {
            'Tree age': treeAge,
            'Thinning_Upper_Fruits Bunch-1': upperFruits,
            'Thinning_Center_Fruits Bunch-1': centerFruits,
            'Thinning_Lower_Fruits Bunch-1': lowerFruits,
            'Thinning_Bunches': bunches,
        };
    }

    function getTreeAge(page) {
        const mode = page.querySelector('input[name="age-mode"]:checked')?.value || 'age';
        if (mode === 'age') {
            const value = parsePositiveInt(page, '#input-age', 'Tree age');
            if (value < 1 || value > 100) throw new Error('Tree age must be between 1 and 100 years.');
            return value;
        }
        const plantingYear = parsePositiveInt(page, '#input-planting-year', 'Planting year');
        const age = new Date().getFullYear() - plantingYear;
        if (age < 1 || age > 100) throw new Error('Calculated tree age must be between 1 and 100 years.');
        return age;
    }

    function getActiveProtocol(page) {
        if (window.YieldMode && typeof window.YieldMode.getProtocolType === 'function') {
            return window.YieldMode.getProtocolType(page);
        }
        return page.querySelector('.tab-btn.active')?.dataset.tab === 'general' ? 'general' : 'by_generation';
    }

    function getThinningData(page, protocolType) {
        if (protocolType === 'general') {
            return {
                branches: parsePositiveInt(page, '#gen-branches', 'Avg. strands per bunch'),
                fronds: parsePositiveInt(page, '#gen-fronds', 'Avg. fruitlets per strand'),
                clusters: parsePositiveInt(page, '#gen-clusters', 'Total bunches'),
            };
        }

        return {
            clusters: parsePositiveInt(page, '#byg-clusters', 'Number of bunches'),
            upper: {
                branches: parsePositiveInt(page, '#byg-upper-branches', 'Upper strands per bunch'),
                fronds: parsePositiveInt(page, '#byg-upper-fronds', 'Upper fruitlets per strand'),
            },
            middle: {
                branches: parsePositiveInt(page, '#byg-middle-branches', 'Center strands per bunch'),
                fronds: parsePositiveInt(page, '#byg-middle-fronds', 'Center fruitlets per strand'),
            },
            lower: {
                branches: parsePositiveInt(page, '#byg-lower-branches', 'Lower strands per bunch'),
                fronds: parsePositiveInt(page, '#byg-lower-fronds', 'Lower fruitlets per strand'),
            },
        };
    }

    function parsePositiveInt(page, selector, fieldName) {
        const el = page.querySelector(selector);
        if (!el) throw new Error(`Missing input for ${fieldName}.`);
        const value = el.value.trim();
        if (!value) {
            el.classList.add('error');
            throw new Error(`Please enter a value for: ${fieldName}`);
        }
        const parsed = parseInt(value, 10);
        if (isNaN(parsed) || parsed <= 0) {
            el.classList.add('error');
            throw new Error(`"${fieldName}" must be a positive integer.`);
        }
        return parsed;
    }

    function displayResults(mean, std, features) {
        const title = $('#result-page-title');
        const summary = $('#result-summary-text');
        const stationLabel = $('#result-station-label');
        const distributionGrid = $('#distribution-grid');

        const modelConfig = MODEL_CONFIGS[state.activeModel] || MODEL_CONFIGS.yield;
        title.textContent = modelConfig.title;
        summary.textContent = modelConfig.requiresClimate
            ? 'Climate data was used to generate this distribution prediction.'
            : 'This prediction uses tree and thinning inputs only.';
        stationLabel.textContent = state.activeModel === 'skin' ? state.selectedStationLabel : 'N/A';

        if (state.activeModel === 'skin') {
            distributionGrid.innerHTML = renderDistributionCards(mean, std);
        } else {
            distributionGrid.innerHTML = renderYieldResultCard(mean, std);
        }

        buildFeatureTable(features);
    }

    function renderYieldResultCard(mean, std) {
        return `
            <div class="result-card result-card-yield">
                <div class="result-card-title">Predicted Yield</div>
                <div class="result-card-value">${mean.toFixed(1)} kg/tree</div>
                <div class="result-card-caption">Confidence range: ${(mean - std).toFixed(1)} - ${(mean + std).toFixed(1)} kg</div>
            </div>
        `;
    }

    function renderDistributionCards(mean, std) {
        const values = calculateDistributionPercentages(mean);
        const labels = ['0%-5%', '5%-25%', '25%-40%', 'Other'];
        return values.map((value, index) => `
            <div class="distribution-card">
                <div class="distribution-value">${value}%</div>
                <div class="distribution-label">${labels[index]}</div>
            </div>
        `).join('');
    }

    function calculateDistributionPercentages(score) {
        const base = Math.max(25, Math.min(55, Math.round(40 + (score - 100) / 5)));
        const second = Math.max(15, Math.min(30, Math.round(20 - (score - 100) / 20)));
        const third = 15;
        const fourth = Math.max(10, 100 - base - second - third);
        return [base, second, third, fourth];
    }

    function buildFeatureTable(features) {
        const tbody = $('#feature-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        const labels = {
            'Tree age': 'Tree Age (years)',
            'year': 'Year',
            'Thinning_Upper_Fruits Bunch-1': 'Upper Fruits/Bunch',
            'Thinning_Center_Fruits Bunch-1': 'Center Fruits/Bunch',
            'Thinning_Lower_Fruits Bunch-1': 'Lower Fruits/Bunch',
            'Thinning_Bunches': 'Total Bunches',
            'Thinning_Fruits Tree-1': 'Total Fruits/Tree',
            'Coverage_Upper_Fruits Bunch-1': 'Coverage Upper Fruits/Bunch',
            'Coverage_Center_Fruits Bunch-1': 'Coverage Center Fruits/Bunch',
            'Coverage_Lower_Fruits Bunch-1': 'Coverage Lower Fruits/Bunch',
            'Coverage_Bunches': 'Coverage Total Bunches',
            'Coverage_Fruits Tree-1': 'Coverage Fruits/Tree',
            'T_Inf_differentiation': 'Heat Hours (Differentiation)',
            'T_Flowering': 'Heat Hours (Flowering)',
            'T_Thinning': 'Heat Hours (Thinning)',
            'H_Inf_differentiation': 'Avg Humidity (Differentiation)',
            'H_Flowering': 'Avg Humidity (Flowering)',
            'H_Thinning': 'Avg Humidity (Thinning)',
            'E_Inf_differentiation': 'Evaporation (Differentiation)',
            'E_Flowering': 'Evaporation (Flowering)',
            'E_Thinning': 'Evaporation (Thinning)',
        };

        Object.entries(features).forEach(([key, value]) => {
            const row = document.createElement('tr');
            const label = labels[key] || key;
            const formatted = typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(2)) : value;
            row.innerHTML = `<td>${label}</td><td>${formatted}</td>`;
            tbody.appendChild(row);
        });
    }

    function showToast(message, type = '') {
        let toast = $('#app-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'app-toast';
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.className = `toast ${type}`;
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => toast.classList.remove('show'), 3500);
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

})();
