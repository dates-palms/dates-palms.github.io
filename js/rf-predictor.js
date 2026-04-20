class RFPredictor {
    constructor() {
        this.model = null;
        this.featureNames = [];
        this.trees = [];
        this.loaded = false;
    }

    async loadModel(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const text = await response.text();
            const match = text.match(/const\s+RF_MODEL\s*=\s*([\s\S]*?);\s*$/);
            if (!match) {
                throw new Error('RF_MODEL payload not found');
            }

            const model = Function(`return (${match[1]});`)();
            if (!model || !Array.isArray(model.feature_names) || !Array.isArray(model.trees)) {
                throw new Error('RF model structure is invalid');
            }

            this.model = model;
            this.featureNames = [...model.feature_names];
            this.trees = [...model.trees];
            this.loaded = true;
            console.log(`✅ RF model loaded: ${this.trees.length} trees, ${this.featureNames.length} features`);
            return true;
        } catch (error) {
            console.error('❌ Failed to load RF model:', error);
            this.loaded = false;
            return false;
        }
    }

    _traverseTree(node, featureVector) {
        let current = node;

        while (current && !current.leaf) {
            const featureIndex = current.feature;
            const threshold = current.threshold;
            const value = featureVector[featureIndex];

            if (value === null || value === undefined || Number.isNaN(value)) {
                current = current.left;
            } else if (value <= threshold) {
                current = current.left;
            } else {
                current = current.right;
            }
        }

        if (!current || typeof current.value !== 'number') {
            throw new Error('Invalid RF tree structure');
        }

        return current.value;
    }

    predict(featureVector) {
        if (!this.loaded) {
            throw new Error('Model not loaded. Call loadModel() first.');
        }
        if (!Array.isArray(featureVector)) {
            throw new Error('featureVector must be an array');
        }
        if (featureVector.length !== this.featureNames.length) {
            throw new Error(`Expected ${this.featureNames.length} features, got ${featureVector.length}`);
        }

        let sum = 0;
        for (const tree of this.trees) {
            sum += this._traverseTree(tree, featureVector);
        }
        return sum / this.trees.length;
    }

    predictFromObject(featureObj) {
        const vector = this.featureNames.map(name => {
            const numeric = Number(featureObj?.[name]);
            return Number.isFinite(numeric) ? numeric : 0;
        });
        return this.predict(vector);
    }
}

window.RFPredictor = RFPredictor;
