[Tree_Yield_Prediction_Readme.md](https://github.com/user-attachments/files/27163878/Tree_Yield_Prediction_Readme.md)
# פרויקט חיזוי יבול עצי תמר 
(Mejhoul Thinning Management)

## 1. הקדמה (Introduction)
מסמך זה מסביר את לוגיקת האפליקציה במסך חיזוי היבול:
Tree yield (kg)
כיצד המערכת קוראת את נתוני המשתמש, מחשבת אותם, ואיזה מודל רץ בהתאם להחלטות המשתמש.

---

## 2. אפשרויות קלט - פרוטוקולי דילול 
(Thinning Protocol)
קיימות מספר אפשרויות לקביעת אופן הזנת הנתונים (נשלטות על ידי כפתורי רדיו):

**אופן הזנה ראשי (Input Mode):**
* פרוטוקול מתוכנן:
Protocol
* ספירות בפועל:
Counts

**תת-מצב עבור פרוטוקול (Protocol Options):**
* פרוטוקול אחיד לכל העץ:
General Protocol
* פרוטוקול המפורט לפי דורות/דורים:
Protocol by whorl

**תת-מצב עבור ספירות (Counting Options):**
* ספירות מוקדמות (דילול):
Early counts
* ספירות מאוחרות (כיסוי):
Late counts

---

## 3. בחירת המודל לפי כפתורי הרדיו 
לפי בחירת כפתורי הרדיו נקבע "התרחיש"
(Scenario)
ועל פיו המערכת בוחרת איזה מודל לטעון ולהפעיל:

### תרחיש מוקדם 
(Early Counting)
מופעל כאשר בוחרים ב:
Protocol
(לא משנה אם כללי או לפי דורות)
או כאשר בוחרים ב:
Counts -> Early counts

* **המודל שמופעל:** מודל יער אקראי
(Random Forest - RFPredictor)
* **שם קובץ המודל:**
`rf_model_Model1_DropRows_Thinning_(1A) No Climate.js`

### תרחיש מאוחר
(Late Counting)
מופעל כאשר בוחרים ב:
Counts -> Late counts

* **המודל שמופעל:** מודל אקסטרים גרדיאנט בוסטינג
(XGBoost - XGBoostPredictor)
* **שם קובץ המודל:**
`fixed_xgboost_late_count_Model1_DropRows_Coverage_1B_NoClimate.js`

---

## 4. קלטים, חישובים מאחורי הקלעים ומה שנשלח למודל

הקוד 
(בקובץ `app-new.js`) 
לוקח את הקלטים מהמשתמש ומבצע מספר חישובים פנימיים לפני שהוא שולח את הנתונים למודל.

### א. גיל העץ
(Tree Age)
ניתן להזין גיל ישירות או שנת נטיעה. אם הוזנה שנת נטיעה, הקוד מחשב את הגיל כך: השנה הנוכחית פחות שנת הנטיעה.

### ב. חישוב כמות הפירות לאשכול
(Fruits per Bunch)
* **אם נבחר פרוטוקול כללי (General Protocol):**
המשתמש מזין ממוצע שרביטים (Strands) ופרחים/פירות לשרביט (Fruitlets). 
הקוד מכפיל אותם כדי לקבל את סך הפירות לאשכול. מכיוון שמדובר בפרוטוקול כללי, המערכת מניחה שערך זה זהה עבור כל הדורות (העליון, המרכזי והתחתון) ומעתיקה אותו לשלושתם.

* **אם נבחר פרוטוקול לפי דורות (Protocol by whorl):**
המשתמש מזין שרביטים ופירות בנפרד לכל דור. 
הקוד מכפיל את השרביטים בפירות עבור כל דור בנפרד כדי לקבל את ערכי הפירות לאשכול העליון, המרכזי והתחתון.

### ג. רשימת הפיצ'רים (Features) שנשלחים למודלים:

**עבור התרחיש המוקדם (Random Forest):**
הקוד מעביר למודל חמישה משתנים (מבוסס על ערכי דילול - Thinning):
1. `Tree age`
(גיל העץ)
2. `Thinning_Upper_Fruits Bunch-1`
(מספר פירות באשכול עליון)
3. `Thinning_Center_Fruits Bunch-1`
(מספר פירות באשכול מרכזי)
4. `Thinning_Lower_Fruits Bunch-1`
(מספר פירות באשכול תחתון)
5. `Thinning_Bunches`
(סך הכל אשכולות)

**עבור התרחיש המאוחר (XGBoost):**
בתרחיש זה, הקוד מבצע **חישוב נוסף** של משקל הפירות הממוצע, תוך מתן משקל שונה לכל דור.
הנוסחה בקוד:
`weightedFruitsPerBunch = (0.25 * upperFruits) + (0.5 * centerFruits) + (0.25 * lowerFruits)`
לאחר מכן, סך הפירות לעץ מחושב על ידי הכפלת סך האשכולות במשקל הממוצע:
`totalFruitLoad = bunches * weightedFruitsPerBunch`

הקוד מעביר למודל ה-XGBoost שישה משתנים (מבוסס על ערכי כיסוי - Coverage):
1. `Tree age`
(גיל העץ)
2. `Coverage_Upper_Fruits Bunch-1`
(מספר פירות באשכול עליון)
3. `Coverage_Center_Fruits Bunch-1`
(מספר פירות באשכול מרכזי)
4. `Coverage_Lower_Fruits Bunch-1`
(מספר פירות באשכול תחתון)
5. `Coverage_Bunches`
(סך הכל אשכולות)
6. `Coverage_Fruits Tree-1`
(סך הכל פירות לעץ - החישוב הממושקל שבוצע לעיל)
