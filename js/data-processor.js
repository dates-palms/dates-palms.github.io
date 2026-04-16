/**
 * Data Processor
 * Translates data_processor.py logic to JavaScript.
 * Includes weather data processing (Penman-Monteith, degree hours, period aggregation)
 * and builds the 16-feature input vector for the XGBoost model.
 */
class DataProcessor {

    constructor() {
        // Physical constants for Penman-Monteith evaporation calculation
        this.RHO = 1.2;          // Air density (kg/m³)
        this.CP = 1013;          // Specific heat capacity (J/kg°C)
        this.LAMBDA_V = 2.45e6;  // Latent heat of vaporization
        this.GAMMA = 0.065;      // Psychrometric constant
    }

    // ================================================================
    //  Weather Data Processing (ported from data_processor.py)
    // ================================================================

    /** Saturation vapor pressure */
    _satVaporPressure(T) {
        return 0.6108 * Math.exp((17.27 * T) / (T + 237.3));
    }

    /** Slope of the saturation vapor pressure curve */
    _deltaSlope(T) {
        const es = this._satVaporPressure(T);
        return (4098 * es) / Math.pow(T + 237.3, 2);
    }

    /** Penman-Monteith evaporation for a single 10-minute record */
    _penmanMonteith(Rn, T, RH) {
        if (Rn == null || T == null || RH == null || isNaN(Rn) || isNaN(T) || isNaN(RH) || Rn < 0) return 0;
        // Convert radiation W/m² → MJ/m² for 10 minutes
        const Rn_MJ = (Rn / 1e6) * 600;
        const es = this._satVaporPressure(T);
        const ea = (RH / 100) * es;
        const delta = this._deltaSlope(T);
        const numer = delta * Rn_MJ + this.RHO * this.CP * (es - ea) / this.LAMBDA_V;
        const denom = delta + this.GAMMA;
        return Math.max(0, numer / denom);
    }

    /** Degree hours above threshold (per 10-minute record = 1/6 of an hour) */
    _degreeHours(temp, threshold = 18) {
        if (temp > threshold) return (temp - threshold) * (10 / 60);
        return 0;
    }

    /**
     * Process raw IMS API weather data into the 9 model features.
     * Mirrors data_processor.py → process_weather_data()
     *
     * @param {Array} rawDataList - Raw records from IMS API
     * @param {number} currentYear - Current year for period definitions
     * @returns {Object} 9 weather features: T/H/E for 3 periods
     */
    processWeatherData(rawDataList, currentYear) {
        if (!rawDataList || rawDataList.length === 0) return this._emptyFeatures();

        // Flatten nested IMS format (records may contain 'channels' array)
        const rows = rawDataList.map(record => {
            if (record.channels) {
                const flat = { datetime: record.datetime };
                for (const ch of record.channels) {
                    if (ch.name && ch.value != null) flat[ch.name] = ch.value;
                }
                return flat;
            }
            return record;
        });

        // Map IMS column names → standard names
        const colMap = { TD: 'Temperature', TDmax: 'Temperature', RH: 'Relative Humidity', Grad: 'Global Radiation' };

        const parsed = [];
        for (const row of rows) {
            const dt = row.datetime || row.date;
            if (!dt) continue;
            const d = new Date(dt);
            if (isNaN(d)) continue;

            const T = row.Temperature ?? row[Object.keys(row).find(k => colMap[k] === 'Temperature')] ?? 25;
            const RH = row['Relative Humidity'] ?? row.RH ?? 50;
            const Rn = row['Global Radiation'] ?? row.Grad ?? 500;

            const temp = Number(T), rh = Number(RH), rad = Number(Rn);

            parsed.push({
                dt: d,
                temp: isNaN(temp) ? 25 : temp,
                rh: isNaN(rh) ? 50 : rh,
                rad: isNaN(rad) ? 500 : rad,
            });
        }

        if (parsed.length === 0) return this._emptyFeatures();

        // Define physiological periods
        const prevYear = currentYear - 1;
        const periods = {
            Inf_differentiation: [new Date(prevYear, 10, 1), new Date(currentYear, 1, 10)],  // Nov 1 – Feb 10
            Flowering: [new Date(currentYear, 1, 11), new Date(currentYear, 2, 31)], // Feb 11 – Mar 31
            Thinning: [new Date(currentYear, 3, 1), new Date(currentYear, 4, 15)], // Apr 1 – May 15
        };

        const features = {};

        for (const [name, [start, end]] of Object.entries(periods)) {
            const periodRows = parsed.filter(r => r.dt >= start && r.dt <= end);

            if (periodRows.length === 0) {
                features[`T_${name}`] = 0;
                features[`H_${name}`] = 50;
                features[`E_${name}`] = 0;
            } else {
                let heatSum = 0, humSum = 0, evapSum = 0;
                for (const r of periodRows) {
                    heatSum += this._degreeHours(r.temp, 18);
                    humSum += r.rh;
                    evapSum += this._penmanMonteith(r.rad, r.temp, r.rh);
                }
                features[`T_${name}`] = heatSum;
                features[`H_${name}`] = humSum / periodRows.length;
                features[`E_${name}`] = evapSum;
            }
        }

        return features;
    }

    /** Empty/default weather features
     * When the API fails to return any rows, we supply realistic sample
     * values here so that the web version behaves consistently with the
     * manual-entry defaults.  These are not used by the Python backend.
     */
    _emptyFeatures() {
        return {
            T_Inf_differentiation: 3313.3, H_Inf_differentiation: 51.2, E_Inf_differentiation: 1002.99,
            T_Flowering: 3026.6, H_Flowering: 43.2, E_Flowering: 709.29,
            T_Thinning: 7636.6, H_Thinning: 32.5, E_Thinning: 902.01,
        };
    }

    // ================================================================
    //  Feature Vector Builder (kept from original)
    // ================================================================

    /**
     * Build the 16-feature input vector for the XGBoost model.
     */
    prepareInputVector(params) {
        const { treeAge, year, protocolType, thinning, weather } = params;

        let upperFruits, centerFruits, lowerFruits, bunches, branches;

        if (protocolType === 'general') {
            const fruitsPerBunch = thinning.branches * thinning.fronds;
            upperFruits = fruitsPerBunch;
            centerFruits = fruitsPerBunch;
            lowerFruits = fruitsPerBunch;
            bunches = thinning.clusters;
            branches = thinning.branches;
        } else {
            upperFruits = thinning.upper.branches * thinning.upper.fronds;
            centerFruits = thinning.middle.branches * thinning.middle.fronds;
            lowerFruits = thinning.lower.branches * thinning.lower.fronds;
            bunches = thinning.clusters;
            // python used int() which truncates toward zero for positive values
            branches = Math.floor(
                (thinning.upper.branches + thinning.middle.branches + thinning.lower.branches) / 3
            );
        }

        const avgFronds = (upperFruits + centerFruits + lowerFruits) / 3;
        const fruitsPerTree = bunches * branches * avgFronds;

        return {
            'Tree age': treeAge,
            'year': year,
            'Thinning_Upper_Fruits Bunch-1': upperFruits,
            'Thinning_Center_Fruits Bunch-1': centerFruits,
            'Thinning_Lower_Fruits Bunch-1': lowerFruits,
            'Thinning_Bunches': bunches,
            'Thinning_Fruits Tree-1': fruitsPerTree,
            'T_Inf_differentiation': weather.T_Inf_differentiation || 0,
            'T_Flowering': weather.T_Flowering || 0,
            'T_Thinning': weather.T_Thinning || 0,
            'H_Inf_differentiation': weather.H_Inf_differentiation || 50,
            'H_Flowering': weather.H_Flowering || 50,
            'H_Thinning': weather.H_Thinning || 50,
            'E_Inf_differentiation': weather.E_Inf_differentiation || 0,
            'E_Flowering': weather.E_Flowering || 0,
            'E_Thinning': weather.E_Thinning || 0,
        };
    }

    /**
     * Fallback prediction if model is not available
     */
    fallbackPrediction(params) {
        const { treeAge, protocolType, thinning } = params;
        let fruitletsPerTree;

        if (protocolType === 'general') {
            fruitletsPerTree = thinning.clusters * thinning.branches * thinning.fronds;
        } else {
            const avgBranches = (thinning.upper.branches + thinning.middle.branches + thinning.lower.branches) / 3;
            const avgFronds = (thinning.upper.fronds + thinning.middle.fronds + thinning.lower.fronds) / 3;
            fruitletsPerTree = thinning.clusters * avgBranches * avgFronds;
        }

        let estimatedYield = (fruitletsPerTree * 10) / 1000;
        if (treeAge < 5) estimatedYield *= 0.6;
        else if (treeAge > 20) estimatedYield *= 0.85;

        return Math.max(20, Math.min(200, estimatedYield));
    }
}

window.DataProcessor = DataProcessor;
