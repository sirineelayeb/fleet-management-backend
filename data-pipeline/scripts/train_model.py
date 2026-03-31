"""
scripts/03_train_model.py
Train WiFi fingerprint positioning models
"""

import pandas as pd
import numpy as np
import pickle
import json
import sys
from pathlib import Path

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.neighbors import KNeighborsRegressor
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error
from xgboost import XGBRegressor

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import Config


# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────
def sep(msg):
    print(f"\n{'─'*60}")
    print(f"  {msg}")
    print(f"{'─'*60}")


def rmse_m(y_true, y_pred):
    return np.sqrt(((y_true - y_pred) ** 2).sum(axis=1)).mean()


def evaluate(name, model, X_test, y_test, results):
    pred = model.predict(X_test)

    error = rmse_m(y_test.values, pred)

    results.append({
        "model": name,
        "rmse_m": round(float(error), 2)
    })

    print(f"{name:30s} → RMSE = {error:.2f} meters")


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────
def main():
    Config.ensure_dirs()

    sep("Load ML dataset")

    if not Config.ML_READY_CSV.exists():
        print("❌ Run prepare_ml_dataset first")
        sys.exit(1)

    df = pd.read_csv(Config.ML_READY_CSV)

    with open(Config.MAC_LIST_JSON) as f:
        feature_cols = json.load(f)

    feature_cols = [c for c in feature_cols if c in df.columns]

    X = df[feature_cols].values.astype(np.float32)
    y = df[["x_m", "y_m"]]

    print("Samples:", len(df))
    print("Features:", len(feature_cols))


    # ─────────────────────────────────────────
    sep("Train/Test split")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y,
        test_size=Config.TEST_SIZE,
        random_state=Config.RANDOM_STATE
    )


    # ─────────────────────────────────────────
    sep("Scale features")

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)


    # ─────────────────────────────────────────
    sep("Train models")

    results = []

    # 1️⃣ KNN baseline
    knn = KNeighborsRegressor(n_neighbors=5, weights="distance", n_jobs=-1)
    knn.fit(X_train_s, y_train)
    evaluate("KNN", knn, X_test_s, y_test, results)


    # 2️⃣ Random Forest
    rf = RandomForestRegressor(
        n_estimators=300,
        min_samples_leaf=2,
        n_jobs=-1,
        random_state=Config.RANDOM_STATE
    )
    rf.fit(X_train_s, y_train)
    evaluate("Random Forest", rf, X_test_s, y_test, results)


    # 3️⃣ XGBoost (BEST MODEL)
    xgb = XGBRegressor(
        n_estimators=500,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        tree_method="hist",
        random_state=Config.RANDOM_STATE,
        n_jobs=-1
    )

    xgb.fit(X_train_s, y_train)
    evaluate("XGBoost", xgb, X_test_s, y_test, results)


    # ─────────────────────────────────────────
    sep("Best model")

    results_df = pd.DataFrame(results).sort_values("rmse_m")
    best_name = results_df.iloc[0]["model"]

    model_map = {
        "KNN": knn,
        "Random Forest": rf,
        "XGBoost": xgb
    }

    best_model = model_map[best_name]

    print(results_df.to_string(index=False))
    print(f"\nBest model → {best_name}")


    # ─────────────────────────────────────────
    sep("Save model")

    with open(Config.MODEL_FILE, "wb") as f:
        pickle.dump({
            "model": best_model,
            "features": feature_cols
        }, f)

    with open(Config.SCALER_FILE, "wb") as f:
        pickle.dump(scaler, f)

    results_df.to_csv(Config.OUTPUTS / "model_comparison.csv", index=False)

    print("Saved ✔")


    # ─────────────────────────────────────────
    sep("DONE")

if __name__ == "__main__":
    main()