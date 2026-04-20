/**
 * XGBoost JSON Model Predictor
 * Parses the XGBoost JSON model format and performs tree traversal for prediction.
 */
class XGBoostPredictor {
    constructor() {
        this.model = null;
        this.featureNames = [];
        this.baseScore = 0.5; // default
        this.trees = [];
        this.modelFormat = 'learner';
        this.boostLearningRate = 1;
        this.loaded = false;
    }

    /**
     * Load model from a JSON file URL
     */
    async loadModel(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const rawText = await response.text();
            let parsedModel = null;

            try {
                parsedModel = JSON.parse(rawText);
            } catch {
                const match = rawText.match(/const\s+XGB_MODEL\s*=\s*([\s\S]*?);\s*$/);
                if (!match) {
                    throw new Error('Unsupported XGBoost model format');
                }
                parsedModel = Function(`return (${match[1]});`)();
            }

            this.model = parsedModel;
            this._parseModel();
            this.loaded = true;
            console.log(`✅ XGBoost model loaded: ${this.trees.length} trees, ${this.featureNames.length} features`);
            return true;
        } catch (error) {
            console.error('❌ Failed to load XGBoost model:', error);
            return false;
        }
    }

    /**
     * Parse the model JSON structure
     */
    _parseModel() {
        if (this.model?.learner) {
            this._parseLearnerModel();
            return;
        }

        if (this.model?.type === 'xgboost' && Array.isArray(this.model?.trees)) {
            this._parseCompactModel();
            return;
        }

        throw new Error('Unknown XGBoost model structure');
    }

    _parseLearnerModel() {
        const learner = this.model.learner;
        this.modelFormat = 'learner';
        this.boostLearningRate = 1;

        // Extract feature names
        this.featureNames = learner.feature_names || [];

        // Extract base score (Fixed to prevent NaN)
        this.baseScore = 0.5; // Default for regression
        if (learner.learner_model_param && learner.learner_model_param.base_score !== undefined) {
            // base_score may be stored as a string, sometimes wrapped in brackets
            let raw = learner.learner_model_param.base_score;
            if (typeof raw === 'string') {
                // remove any surrounding [ ] or whitespace
                raw = raw.replace(/[\[\]\s]/g, '');
            }
            const parsedScore = Number(raw);
            if (!isNaN(parsedScore)) {
                this.baseScore = parsedScore;
            } else {
                console.warn('Unable to parse base_score from model:', learner.learner_model_param.base_score);
            }
        }

        // Extract trees
        const gbtree = learner.gradient_booster.model;
        this.trees = gbtree.trees || [];

        console.log(`Model info: base_score=${this.baseScore}, trees=${this.trees.length}, features=${this.featureNames.join(', ')}`);
    }

    _parseCompactModel() {
        this.modelFormat = 'compact';
        this.featureNames = Array.isArray(this.model.feature_names) ? [...this.model.feature_names] : [];
        this.baseScore = Number(this.model.base_score);
        if (!Number.isFinite(this.baseScore)) {
            this.baseScore = 0;
        }

        this.boostLearningRate = Number(this.model.learning_rate);
        if (!Number.isFinite(this.boostLearningRate)) {
            this.boostLearningRate = 1;
        }

        this.trees = Array.isArray(this.model.trees) ? [...this.model.trees] : [];
        console.log(`Compact model info: base_score=${this.baseScore}, lr=${this.boostLearningRate}, trees=${this.trees.length}`);
    }

    /**
     * Traverse a single tree and return the leaf value
     */
    _traverseTree(tree, features) {
        const leftChildren = tree.left_children;
        const rightChildren = tree.right_children;
        const splitIndices = tree.split_indices;
        const splitConditions = tree.split_conditions;
        const baseWeights = tree.base_weights;
        const defaultLeft = tree.default_left;

        let nodeIndex = 0; // start at root

        while (true) {
            const leftChild = leftChildren[nodeIndex];
            const rightChild = rightChildren[nodeIndex];

            // Leaf node: no children (indicated by -1)
            if (leftChild === -1) {
                return baseWeights[nodeIndex];
            }

            const featureIndex = splitIndices[nodeIndex];
            const threshold = splitConditions[nodeIndex];
            const featureValue = features[featureIndex];

            // Handle missing values
            if (featureValue === null || featureValue === undefined || isNaN(featureValue)) {
                nodeIndex = defaultLeft[nodeIndex] ? leftChild : rightChild;
            } else if (featureValue < threshold) {
                nodeIndex = leftChild;
            } else {
                nodeIndex = rightChild;
            }
        }
    }

    _traverseCompactTree(node, features) {
        let current = node;

        while (current && typeof current.v !== 'number') {
            const featureIndex = current.f;
            const threshold = current.t;
            const value = features[featureIndex];

            if (value === null || value === undefined || Number.isNaN(value)) {
                current = current.l;
            } else if (value < threshold) {
                current = current.l;
            } else {
                current = current.r;
            }
        }

        if (!current || typeof current.v !== 'number') {
            throw new Error('Invalid compact XGBoost tree structure');
        }

        return current.v;
    }

    /**
     * Predict yield from a feature vector (array of 16 numbers in model feature order)
     */
    predict(featureVector) {
        if (!this.loaded) {
            throw new Error('Model not loaded. Call loadModel() first.');
        }

        if (featureVector.length !== this.featureNames.length) {
            throw new Error(`Expected ${this.featureNames.length} features, got ${featureVector.length}`);
        }

        // Sum leaf values from all trees
        let treeSum = 0;
        for (const tree of this.trees) {
            treeSum += this.modelFormat === 'compact'
                ? this._traverseCompactTree(tree, featureVector)
                : this._traverseTree(tree, featureVector);
        }

        if (this.modelFormat === 'compact') {
            return this.baseScore + (this.boostLearningRate * treeSum);
        }

        return this.baseScore + treeSum;
    }

    /**
     * Predict from a named feature object (key-value pairs)
     */
    predictFromObject(featureObj) {
        const featureVector = this.featureNames.map(name => {
            const val = featureObj[name];
            if (val === undefined || val === null) {
                console.warn(`Missing feature: "${name}", using 0`);
                return 0;
            }
            return Number(val);
        });
        return this.predict(featureVector);
    }

    /**
     * Get the expected feature names in order
     */
    getFeatureNames() {
        return [...this.featureNames];
    }
}

// Export for use
window.XGBoostPredictor = XGBoostPredictor;