(function () {
    'use strict';

    const IMS_API_TOKEN = 'API_KEY_VALUE';
    const DEFAULT_STATION_ID = 36;
    const SKIN_MODEL_CLOUD_URL = 'https://us-central1-rsc-date-palm-lzp.cloudfunctions.net/predict_skin_separation';

    const MODEL_CONFIGS = {
        yield: {
            key: 'yield',
            title: 'Yield per Tree Prediction',
            description: 'Predict tree yield in kilograms without climate data.',
            modelUrl: 'model/rf_model_Model1_DropRows_Thinning_(1A)%20No%20Climate.js',
            lateModelUrl: 'model/fixed_xgboost_late_count_Model1_DropRows_Coverage_1B_NoClimate.js',
            requiresClimate: false,
            resultType: 'yield',
        },
        skin: {
            key: 'skin',
            title: 'Skin Separation Distribution',
            description: 'Predict skin separation distribution using climate data.',
            requiresClimate: true,
            resultType: 'distribution',
            source: 'cloud',
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
        stationLoadPromise: null,
        weatherFeatures: null,
        selectedStationId: null,
        selectedStationLabel: 'N/A',
        isLoadingWeather: false,
        isSkinWorkflowRunning: false,
        lastPrediction: null,
    };

    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

    document.addEventListener('DOMContentLoaded', async () => {
        state.processor = new DataProcessor();
        state.predictors.yieldEarly = new RFPredictor();
        state.predictors.yieldLate = new XGBoostPredictor();
        state.weatherClient = new WeatherAPIClient(IMS_API_TOKEN, { disableProxy: false });

        await initializeModels();

        setupPageButtons();
        setupHomeCards();
        setupTabs();
        setupYieldControls();
        setupAgeToggle();
        setupWeatherControls();
        setupStartButtons();
        renderCurrentPage();

        state.stationLoadPromise = loadStations();
    });

    async function initializeModels() {
        const yieldEarlyLoaded = await state.predictors.yieldEarly.loadModel(MODEL_CONFIGS.yield.modelUrl);
        const yieldLateLoaded = await state.predictors.yieldLate.loadModel(MODEL_CONFIGS.yield.lateModelUrl);
        state.modelLoaded.yieldEarly = yieldEarlyLoaded;
        state.modelLoaded.yieldLate = yieldLateLoaded;
        state.modelLoaded.yield = yieldEarlyLoaded && yieldLateLoaded;
        state.modelLoaded.skin = true;
        updateModelStatus();
    }

    function updateModelStatus() {
        const badge = $('#model-status');
        if (!badge) return;
        const statusItems = Object.entries(MODEL_CONFIGS).map(([key, cfg]) => {
            const ready = state.modelLoaded[key];
            const label = cfg.source === 'cloud' ? 'cloud' : (ready ? 'ready' : 'fallback');
            return `${cfg.title}: <span class="model-status-text ${ready ? 'ready' : 'fallback'}">${label}</span>`;
        });
        badge.innerHTML = statusItems.join(' • ');
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

        const closeSkinWorkflow = $('#btn-close-skin-workflow');
        if (closeSkinWorkflow) closeSkinWorkflow.addEventListener('click', () => toggleSkinWorkflowPanel(false));
        const skinWorkflowPanel = $('#skin-workflow-panel');
        if (skinWorkflowPanel) skinWorkflowPanel.addEventListener('click', (event) => {
            if (event.target === skinWorkflowPanel) toggleSkinWorkflowPanel(false);
        });
    }

    function toggleBugPopup(show) {
        const popup = $('#bug-popup');
        if (!popup) return;
        popup.classList.toggle('hidden', !show);
    }

    function toggleSkinWorkflowPanel(show) {
        const panel = $('#skin-workflow-panel');
        if (!panel) return;
        panel.classList.toggle('hidden', !show);
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
            displayResults(state.lastPrediction);
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
        const weatherBtn = $('#btn-start-skin');
        if (weatherBtn) weatherBtn.addEventListener('click', startSkinPredictionWorkflow);
        const stationSelect = $('#station-select');
        if (stationSelect) {
            stationSelect.addEventListener('change', () => {
                state.selectedStationId = stationSelect.value;
                state.selectedStationLabel = stationSelect.options[stationSelect.selectedIndex]?.text || 'N/A';
                updateSkinWorkflowStep(0, stationSelect.value === String(DEFAULT_STATION_ID) ? 'done' : 'active');
                updateAnalyzeButton();
            });
        }
    }

    function setupStartButtons() {
        const yieldButton = $('#btn-start-yield');
        if (yieldButton) yieldButton.addEventListener('click', () => runAnalysis('yield'));
    }

    function updateAnalyzeButton() {
        const skinButton = $('#btn-start-skin');
        if (skinButton) {
            skinButton.disabled = state.isLoadingWeather || state.isSkinWorkflowRunning;
            skinButton.textContent = state.isLoadingWeather ? 'Loading...' : 'START';
        }
    }

    async function ensureStationsLoaded() {
        if (state.stationLoadPromise) {
            await state.stationLoadPromise;
        }
    }

    function getStationById(stationId) {
        return state.stationsData.find(station => String(station.stationId) === String(stationId));
    }

    function syncDefaultStationSelection() {
        const select = $('#station-select');
        if (!select) return null;

        const preferredStation = getStationById(DEFAULT_STATION_ID) || state.stationsData[0];
        if (!preferredStation) return null;

        const stationId = String(preferredStation.stationId);
        select.value = stationId;
        select.selectedIndex = Array.from(select.options).findIndex(option => option.value === stationId);
        state.selectedStationId = stationId;
        state.selectedStationLabel = select.options[select.selectedIndex]?.text || preferredStation.name || 'N/A';
        updateSkinWorkflowStep(0, 'done');
        return preferredStation;
    }

    function renderStationOptions(stations) {
        const select = $('#station-select');
        if (!select) return;

        const preferredStation = stations.find(station => String(station.stationId) === String(DEFAULT_STATION_ID));
        const otherStations = stations
            .filter(station => String(station.stationId) !== String(DEFAULT_STATION_ID))
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const orderedStations = preferredStation ? [preferredStation, ...otherStations] : otherStations;

        select.innerHTML = '';

        orderedStations.forEach((station, index) => {
            const option = document.createElement('option');
            option.value = station.stationId;
            option.textContent = `${station.name} (${station.stationId})`;
            if (String(station.stationId) !== String(DEFAULT_STATION_ID)) {
                option.disabled = true;
            }
            if (index === 0) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        if (!preferredStation && select.options.length > 0) {
            select.options[0].selected = true;
        }
    }

    function updateSkinWorkflowStep(stepIndex, status) {
        const step = document.querySelector(`.workflow-step[data-step="${stepIndex}"]`);
        if (!step) return;

        step.classList.remove('is-active', 'is-done', 'is-error');
        const stateEl = step.querySelector('.workflow-step-state');
        const badgeEl = step.querySelector('.workflow-step-badge');

        if (status === 'active') {
            step.classList.add('is-active');
            if (stateEl) stateEl.textContent = '•';
            if (badgeEl) badgeEl.textContent = String(stepIndex + 1);
        } else if (status === 'done') {
            step.classList.add('is-done');
            if (stateEl) stateEl.textContent = '✓';
            if (badgeEl) badgeEl.textContent = '✓';
        } else if (status === 'error') {
            step.classList.add('is-error');
            if (stateEl) stateEl.textContent = '!';
            if (badgeEl) badgeEl.textContent = '!';
        } else {
            if (stateEl) stateEl.textContent = '•';
            if (badgeEl) badgeEl.textContent = String(stepIndex + 1);
        }
    }

    function resetSkinWorkflowSteps() {
        [0, 1, 2].forEach(stepIndex => updateSkinWorkflowStep(stepIndex, ''));
    }

    async function startSkinPredictionWorkflow() {
        if (state.isSkinWorkflowRunning) return;

        state.isSkinWorkflowRunning = true;
        state.weatherFeatures = null;
        toggleSkinWorkflowPanel(true);
        updateAnalyzeButton();
        resetSkinWorkflowSteps();

        try {
            updateSkinWorkflowStep(0, 'active');
            await ensureStationsLoaded();
            const selectedStation = syncDefaultStationSelection();
            if (!selectedStation) {
                throw new Error('No stations available for prediction.');
            }

            updateSkinWorkflowStep(1, 'active');
            updateSkinWorkflowStep(2, 'active');
            await runAnalysis('skin', { suppressToast: true, rethrow: true });
            updateSkinWorkflowStep(1, 'done');
            updateSkinWorkflowStep(2, 'done');
            showToast('Prediction generated successfully.', 'success');
            setTimeout(() => toggleSkinWorkflowPanel(false), 700);
        } catch (err) {
            const failedStep = state.weatherFeatures ? 2 : 1;
            updateSkinWorkflowStep(failedStep, 'error');
            showToast(err.message, 'error');
        } finally {
            state.isSkinWorkflowRunning = false;
            updateAnalyzeButton();
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
            renderStationOptions(state.stationsData);
            syncDefaultStationSelection();
            select.disabled = false;
            updateSkinWorkflowStep(0, 'done');
        } catch (err) {
            select.innerHTML = '<option value="">Failed to load stations</option>';
            showToast('Failed to load stations: ' + err.message, 'error');
        } finally {
            setWeatherLoading(false, '');
        }
    }

    async function loadWeatherData(options = {}) {
        const { suppressToast = false } = options;
        const select = $('#station-select');
        if (!select) {
            if (!suppressToast) showToast('Station selector is unavailable.', 'error');
            return false;
        }

        if (!select.value) {
            const defaultStation = syncDefaultStationSelection();
            if (!defaultStation) {
                if (!suppressToast) showToast('Please select a station first.', 'error');
                return false;
            }
        }

        const stationName = select.options[select.selectedIndex]?.text || 'station';
        state.selectedStationId = select.value;
        state.selectedStationLabel = stationName;

        const currentYear = new Date().getFullYear();
        const prevYear = currentYear - 1;
        const startDate = `${prevYear}/11/01`;
        const endDate = `${currentYear}/05/15`;

        setWeatherLoading(true, `Loading meteorological data for ${stationName}...`);
        state.weatherFeatures = null;

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
            if (!suppressToast) showToast('Weather data loaded and processed.', 'success');
            return true;
        } catch (err) {
            if (!suppressToast) showToast('Failed to load weather data: ' + err.message, 'error');
            throw err;
        } finally {
            setWeatherLoading(false, '');
            updateAnalyzeButton();
        }
    }

    function setWeatherLoading(loading, message) {
        state.isLoadingWeather = loading;
        const statusEl = $('#weather-status');
        const btnLoad = $('#btn-start-skin');
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
            btnLoad.disabled = state.isSkinWorkflowRunning;
            btnLoad.textContent = 'START';
            select.disabled = false;
        }
    }

    function displayWeatherFeatures(features) {
        const display = $('#weather-features-display');
        if (!display) return;
        display.style.display = 'block';
        const fmt = value => typeof value === 'number' ? value.toFixed(1) : '—';

        $('#feat-t-inf').textContent = fmt(features.T_Inf_differentiation);
        $('#feat-e-inf').textContent = fmt(features.E_Inf_differentiation) + ' mm';

        $('#feat-e-growth').textContent = fmt(features.E_Growth) + ' mm';
        $('#feat-h-june').textContent = fmt(features.H_June_Drop) + '%';

        $('#feat-e-ripen').textContent = fmt(features.E_Ripening) + ' mm';
        $('#feat-h-ripen').textContent = fmt(features.H_Ripening) + '%';
    }

    function resolveSkinTargetYear() {
        const currentYear = new Date().getFullYear();
        const cutoff = new Date(currentYear, 7, 31, 23, 59, 59);
        if (new Date() < cutoff) {
            const usePrevious = window.confirm(
                `Data for ${currentYear} may be incomplete before Aug 31. Click OK to use ${currentYear - 1}, or Cancel to keep ${currentYear}.`
            );
            return usePrevious ? currentYear - 1 : currentYear;
        }
        return currentYear;
    }

    async function requestSkinPrediction(stationId, targetYear) {
        const response = await fetch(SKIN_MODEL_CLOUD_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stationId, targetYear }),
        });

        let payload = null;
        try {
            payload = await response.json();
        } catch (err) {
            throw new Error('Invalid response from prediction service.');
        }

        if (!response.ok || !payload || payload.status === 'error') {
            const message = payload && payload.message ? payload.message : 'Prediction service failed.';
            throw new Error(message);
        }

        return payload;
    }

    function normalizeSkinDistribution(prediction) {
        if (!prediction) return [];
        if (Array.isArray(prediction.distribution)) return prediction.distribution;
        if (Array.isArray(prediction)) return prediction;
        if (typeof prediction === 'object') {
            const labels = ['0%-5%', '5%-25%', '25%-40%', 'Other'];
            return labels.map(label => ({ label, value: Number(prediction[label]) || 0 }));
        }
        return [];
    }

    async function runAnalysis(pageKey, options = {}) {
        try {
            const pageSection = $('#page-' + pageKey);
            if (!pageSection) throw new Error('Page not found.');

            if (pageKey === 'skin') {
                const select = $('#station-select');
                if (!select || !select.value) {
                    const defaultStation = syncDefaultStationSelection();
                    if (!defaultStation) throw new Error('Please select a station first.');
                }

                state.selectedStationId = select.value;
                state.selectedStationLabel = select.options[select.selectedIndex]?.text || 'N/A';

                const targetYear = resolveSkinTargetYear();
                let response;
                setWeatherLoading(true, `Loading meteorological data for ${state.selectedStationLabel}...`);
                try {
                    response = await requestSkinPrediction(state.selectedStationId, targetYear);
                } finally {
                    setWeatherLoading(false, '');
                }

                const distribution = normalizeSkinDistribution(response.prediction);
                const features = response.features || {};
                const metadata = response.metadata || {};
                metadata.targetYear = metadata.targetYear || targetYear;

                state.weatherFeatures = features;
                displayWeatherFeatures(features);
                state.lastPrediction = { distribution, features, metadata };

                navigateTo('results');
                if (!options.suppressToast) showToast('Prediction generated successfully.', 'success');
                return true;
            }

            let features;
            let treeAge;
            let protocolType;
            let thinning;
            let yieldScenario = 'early_counting';

            treeAge = getTreeAge(pageSection);
            protocolType = getActiveProtocol(pageSection);
            thinning = getThinningData(pageSection, protocolType);
            if (window.YieldMode && typeof window.YieldMode.getScenario === 'function') {
                yieldScenario = window.YieldMode.getScenario(pageSection);
            }

            features = buildYieldFeatureObject(treeAge, protocolType, thinning, yieldScenario);

            let meanYield;
            let stdYield;
            const isLateScenario = yieldScenario === 'late_counting';
            const modelReady = isLateScenario ? state.modelLoaded.yieldLate : state.modelLoaded.yieldEarly;
            const predictor = isLateScenario ? state.predictors.yieldLate : state.predictors.yieldEarly;

            if (modelReady) {
                meanYield = predictor.predictFromObject(features);
                meanYield = Math.max(0, meanYield);
                stdYield = Math.abs(meanYield) * 0.15;
            } else {
                meanYield = state.processor.fallbackPrediction({ treeAge, protocolType, thinning });
                stdYield = meanYield * 0.20;
            }

            state.lastPrediction = { meanYield, stdYield, features, yieldScenario };
            renderInlineYieldResults(meanYield, stdYield, features);
            if (!options.suppressToast) showToast('Prediction generated (inline).', 'success');
            return true;
        } catch (err) {
            if (!options.suppressToast) showToast(err.message, 'error');
            if (options.rethrow) throw err;
            return false;
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

    function displayResults(result) {
        const title = $('#result-page-title');
        const summary = $('#result-summary-text');
        const stationLabel = $('#result-station-label');
        const distributionGrid = $('#distribution-grid');
        const yearLabel = $('#result-year-label');
        const windowLabel = $('#result-window-label');

        const mean = result.meanYield;
        const std = result.stdYield;
        const features = result.features || {};
        const metadata = result.metadata || {};

        const modelConfig = MODEL_CONFIGS[state.activeModel] || MODEL_CONFIGS.yield;
        title.textContent = modelConfig.title;
        summary.textContent = modelConfig.requiresClimate
            ? 'Climate data was used to generate this distribution prediction.'
            : 'This prediction uses tree and thinning inputs only.';
        stationLabel.textContent = state.activeModel === 'skin' ? state.selectedStationLabel : 'N/A';

        if (yearLabel) {
            yearLabel.textContent = state.activeModel === 'skin' ? (metadata.targetYear || '—') : '—';
        }
        if (windowLabel) {
            const startDate = metadata.startDate || '';
            const endDate = metadata.endDate || '';
            windowLabel.textContent = state.activeModel === 'skin' && startDate && endDate
                ? `${startDate} → ${endDate}`
                : '—';
        }

        if (state.activeModel === 'skin') {
            distributionGrid.innerHTML = renderDistributionCards(result.distribution);
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

    function renderDistributionCards(distribution) {
        if (!Array.isArray(distribution) || distribution.length === 0) {
            return '';
        }
        return distribution.map(item => {
            const label = item.label || item.range || '—';
            const value = typeof item.value === 'number' ? item.value : Number(item.value) || 0;
            return `
            <div class="distribution-card">
                <div class="distribution-value">${value.toFixed(1)}%</div>
                <div class="distribution-label">${label}</div>
            </div>
        `;
        }).join('');
    }

    function buildFeatureTable(features) {
        // Prefer yield inline table if present, otherwise use global results table
        const tbody = $('#yield-feature-tbody') || $('#feature-tbody');
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
            'E_Ripening': 'Evaporation (Ripening)',
            'H_June_Drop': 'Avg Humidity (June Drop)',
            'E_Growth': 'Evaporation (Growth)',
            'H_Ripening': 'Avg Humidity (Ripening)',
        };

        Object.entries(features).forEach(([key, value]) => {
            const row = document.createElement('tr');
            const label = labels[key] || key;
            const formatted = typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(2)) : value;
            row.innerHTML = `<td>${label}</td><td>${formatted}</td>`;
            tbody.appendChild(row);
        });
    }

    function renderInlineYieldResults(mean, std, features) {
        const pane = $('#yield-results-pane');
        const summary = $('#yield-result-summary');
        if (summary) {
            const valEl = summary.querySelector('.result-card-value');
            if (valEl) valEl.innerHTML = `${mean.toFixed(1)} <span style="font-size: 0.6em; font-weight: normal;">kg/tree</span>`;
            const capEl = summary.querySelector('.result-card-caption');
            if (capEl) capEl.textContent = `Confidence: ${(mean - std).toFixed(1)} - ${(mean + std).toFixed(1)} kg/tree`;
        }
        // populate feature table into yield pane
        buildFeatureTable(features);
        const inner = document.querySelector('#yield-results-inner');
        if (inner) inner.classList.remove('muted');
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
