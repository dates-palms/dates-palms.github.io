# Tree Yield (kg) — Architecture Notes

# Tree Yield (kg) — הסבר מבנה והרצה

מסמך זה מתמקד רק בזרימת החיזוי של Tree Yield (kg).
This document focuses only on the Tree Yield (kg) prediction flow.

## 1) High-level flow

בלחיצה על Start prediction במסך Yield, הקוד קורא גיל עץ + פרטי Thinning, בוחר תרחיש (Early/Late), בונה אובייקט פיצ'רים, ואז מפעיל את המודל המתאים.
When Start prediction is clicked on the Yield page, the code reads tree age + thinning inputs, selects a scenario (Early/Late), builds a feature object, and runs the matching model.

מסלול הקוד המרכזי:
Main execution path:

- `js/yield-mode.js` — קובע protocol type + scenario (early_counting / late_counting).
- `js/yield-mode.js` — determines protocol type + scenario (early_counting / late_counting).
- `js/app-new.js` (`runAnalysis('yield')`) — אוסף קלט, בונה פיצ'רים, בוחר מודל, מחשב תוצאה.
- `js/app-new.js` (`runAnalysis('yield')`) — collects input, builds features, selects model, computes output.
- `js/rf-predictor.js` + `js/xgboost-predictor.js` — מנועי החיזוי בפועל בדפדפן.
- `js/rf-predictor.js` + `js/xgboost-predictor.js` — actual in-browser prediction engines.

## 2) Thinning Protocol list

### A. General Protocol

המשתמש מזין שלושה ערכים:
The user enters three values:

- `ממוצע קלים לאשכול`
- `Avg. strands per bunch` (`#gen-branches`)
- `ממוצע פריונים לקל`
- `Avg. fruitlets per strand` (`#gen-fronds`)
- `סך כל האשכולות`
- `Total bunches` (`#gen-clusters`)

המרה פנימית:
Internal conversion:

- `fruitsPerBunch = branches * fronds`
- Upper/Center/Lower מקבלים את אותו ערך Fruits/Bunch.
- Upper/Center/Lower all receive the same Fruits/Bunch value.

### B. Protocol by whorl

המשתמש מזין ערכים נפרדים ל־Upper / Center / Lower וכן מספר אשכולות.
The user enters separate values for Upper/Center/Lower and a number of bunches.

- `מספר אשכולות`
- `Number of bunches` (`#byg-clusters`)
- `Upper: מספר קלים לאשכול`
- `Upper: #byg-upper-branches` + `#byg-upper-fronds`
- `Center: מספר קלים לאשכול`
- `Center: #byg-middle-branches` + `#byg-middle-fronds`
- `Lower: מספר קלים לאשכול`
- `Lower: #byg-lower-branches` + `#byg-lower-fronds`

המרה פנימית:
Internal conversion:

- `upperFruits = upper.branches * upper.fronds`
- `centerFruits = middle.branches * middle.fronds`
- `lowerFruits = lower.branches * lower.fronds`

## 3) Ratio button / counting mode → איזה מודל רץ

הערה חשובה: בקוד הנוכחי אין שדה בשם Ratio מפורש; הבחירה המקבילה היא Counts עם Early/Late.
Important note: in the current code there is no explicit Ratio field; the equivalent switch is Counts with Early/Late.

מיפוי ההפעלה בפועל:
Actual runtime mapping:

1. Protocol (כולל General Protocol וגם Protocol by whorl)
   - תרחיש: `early_counting`
   - Scenario: `early_counting`
   - מודל: `model/rf_model_Model1_DropRows_Thinning_(1A)%20No%20Climate.js`
   - Model: `model/rf_model_Model1_DropRows_Thinning_(1A)%20No%20Climate.js`
   - מנוע: `RFPredictor`
   - Engine: `RFPredictor`

2. Counts + Early counts
   - תרחיש: `early_counting`
   - Scenario: `early_counting`
   - מודל: `model/rf_model_Model1_DropRows_Thinning_(1A)%20No%20Climate.js`
   - Model: `model/rf_model_Model1_DropRows_Thinning_(1A)%20No%20Climate.js`
   - מנוע: `RFPredictor`
   - Engine: `RFPredictor`

3. Counts + Late counts
   - תרחיש: `late_counting`
   - Scenario: `late_counting`
   - מודל: `model/fixed_xgboost_late_count_Model1_DropRows_Coverage_1B_NoClimate.js`
   - Model: `model/fixed_xgboost_late_count_Model1_DropRows_Coverage_1B_NoClimate.js`
   - מנוע: `XGBoostPredictor`
   - Engine: `XGBoostPredictor`

## 4) מה נשלח למודל (Feature contract)

### Early / Thinning model (RF, 1A)

ה־feature object שנבנה כולל:
The built feature object includes:

- `Tree age`
- `Thinning_Upper_Fruits Bunch-1`
- `Thinning_Center_Fruits Bunch-1`
- `Thinning_Lower_Fruits Bunch-1`
- `Thinning_Bunches`

ב־`RFPredictor.predictFromObject()`, הווקטור נבנה לפי `feature_names` של המודל עצמו (סדר המודל), וכל ערך חסר/לא מספרי נהיה `0`.
In `RFPredictor.predictFromObject()`, the vector is built by the model `feature_names` order, and missing/non-numeric values become `0`.

### Late / Coverage model (XGBoost, 1B)

ה־feature object שנבנה כולל:
The built feature object includes:

- `Tree age`
- `Coverage_Upper_Fruits Bunch-1`
- `Coverage_Center_Fruits Bunch-1`
- `Coverage_Lower_Fruits Bunch-1`
- `Coverage_Bunches`
- `Coverage_Fruits Tree-1`

כאשר:
Where:

- `weightedFruitsPerBunch = 0.25*upper + 0.5*center + 0.25*lower`
- `Coverage_Fruits Tree-1 = Coverage_Bunches * weightedFruitsPerBunch`

ב־`XGBoostPredictor.predictFromObject()`, הווקטור נבנה לפי `feature_names` של המודל. פיצ'ר חסר מקבל `0` (עם warning בקונסול).
In `XGBoostPredictor.predictFromObject()`, the vector is built by model `feature_names`. Missing features are set to `0` (with a console warning).

## 5) הנחות וחישובים מאחורי הקלעים

1. גיל עץ:
1. Tree age:
- אפשר להזין גיל ישיר או שנת נטיעה.
- User can enter direct age or planting year.
- אם נבחרת שנת נטיעה: `age = currentYear - plantingYear`.
- If planting year is selected: `age = currentYear - plantingYear`.
- ולידציה: גיל בטווח 1 עד 100.
- Validation: age must be in range 1..100.

2. אין שימוש בנתוני אקלים ל־Tree Yield במסלול הזה:
2. Climate features are not used for Tree Yield in this flow:
- פונקציית `buildYieldFeatureObject()` לא כוללת משתני מזג אוויר.
- `buildYieldFeatureObject()` does not include weather variables.

3. בחירת מודל לפי scenario:
3. Model selection by scenario:
- `early_counting` → `RFPredictor` with the Thinning 1A model.
- `late_counting` → `XGBoostPredictor` with the Coverage 1B model.

4. פוסט־פרוססינג לתוצאה:
4. Output post-processing:
- `meanYield = max(0, prediction)` (קלמפ למינימום 0).
- `meanYield = max(0, prediction)` (clamped to minimum 0).
- `stdYield = abs(meanYield) * 0.15` כאשר המודל נטען.
- `stdYield = abs(meanYield) * 0.15` when model is loaded.
- אם המודל לא נטען, יש fallback היוריסטי עם סטיית תקן 20%.
- If model is not loaded, a heuristic fallback is used with 20% std.

## 6) קבצים חשובים ל־Tree Yield

- `js/app-new.js` — לוגיקת Yield, בניית פיצ'רים, בחירת מודל והרצה.
- `js/app-new.js` — Yield logic, feature build, model selection and execution.
- `js/yield-mode.js` — מיפוי מצב UI לתרחיש early/late ול־protocol type.
- `js/yield-mode.js` — maps UI state to early/late scenario and protocol type.
- `js/rf-predictor.js` — טעינה והרצת Random Forest בדפדפן.
- `js/rf-predictor.js` — in-browser Random Forest loader/predictor.
- `js/xgboost-predictor.js` — טעינה והרצת XGBoost בדפדפן.
- `js/xgboost-predictor.js` — in-browser XGBoost loader/predictor.
- `index.html` — רכיבי הקלט (Protocol / Counts, Early / Late, ושדות thinning).
- `index.html` — input controls (Protocol / Counts, Early / Late, and thinning fields).
