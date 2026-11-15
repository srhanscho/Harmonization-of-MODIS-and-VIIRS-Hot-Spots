"""Predictive lab (REPORT_ALIGNMENT 5): backtest and 3-month outlook on the harmonized series.

Model: Prophet (yearly seasonality) on log1p(harmonized monthly counts), 80 % interval.
Fallback per region: statsmodels SARIMA (1,0,1)(1,1,1,12) on log1p when Prophet fails.
Backtest: train 2001-2015, predict 2016 -> last complete month, compare with HARMONIZED observed values.
Outlook: refit on all complete months, forecast the next 3 months; probabilities of the
harmonized-baseline z exceeding 1 and 2 come from a normal predictive distribution on log1p.
Alerts (experimental): yellow if P(z > 1) > 0.60, red if P(z > 2) > 0.75.
"""

from __future__ import annotations

import logging
import warnings

import numpy as np
import pandas as pd
from scipy.stats import norm

import config as C

log = logging.getLogger(__name__)
logging.getLogger("cmdstanpy").setLevel(logging.WARNING)
logging.getLogger("prophet").setLevel(logging.WARNING)

TRAIN_YEARS = (2001, 2015)
Z80 = norm.ppf(0.9)  # half-width of an 80 % interval in standard deviations
ALERT_LABEL = "Experimental - statistical outlook, not an operational warning"
YELLOW_P1, RED_P2 = 0.60, 0.75


def _series(rows: list[dict]) -> pd.Series:
    """Monthly harmonized series indexed by month start; partial / null months are NaN."""
    idx, vals = [], []
    for r in rows:
        idx.append(pd.Timestamp(r["year"], r["month"], 1))
        v = r.get("harmonized")
        vals.append(np.nan if v is None or r.get("partial") else float(v))
    return pd.Series(vals, index=pd.DatetimeIndex(idx)).sort_index()


def _fit_predict_prophet(train: pd.Series, future_index: pd.DatetimeIndex) -> pd.DataFrame:
    from prophet import Prophet

    df = pd.DataFrame({"ds": train.index, "y": np.log1p(train.to_numpy())}).dropna()
    m = Prophet(yearly_seasonality=True, weekly_seasonality=False, daily_seasonality=False, interval_width=0.8)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        m.fit(df)
    fc = m.predict(pd.DataFrame({"ds": future_index}))
    return pd.DataFrame({"mean": fc["yhat"].to_numpy(), "lo": fc["yhat_lower"].to_numpy(), "hi": fc["yhat_upper"].to_numpy()}, index=future_index)


def _fit_predict_sarima(train: pd.Series, future_index: pd.DatetimeIndex) -> pd.DataFrame:
    from statsmodels.tsa.statespace.sarimax import SARIMAX

    y = np.log1p(train.asfreq("MS"))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        res = SARIMAX(y, order=(1, 0, 1), seasonal_order=(1, 1, 1, 12)).fit(disp=False)
    steps = (future_index[-1].year - y.index[-1].year) * 12 + future_index[-1].month - y.index[-1].month
    sf = res.get_forecast(steps).summary_frame(alpha=0.2)
    sf.index = pd.date_range(y.index[-1] + pd.offsets.MonthBegin(1), periods=steps, freq="MS")
    sf = sf.reindex(future_index)
    return pd.DataFrame({"mean": sf["mean"], "lo": sf["mean_ci_lower"], "hi": sf["mean_ci_upper"]}, index=future_index)


def fit_predict(train: pd.Series, future_index: pd.DatetimeIndex, prefer: str = "prophet") -> tuple[pd.DataFrame, str]:
    """Return (log1p-scale mean/lo/hi frame, model name)."""
    if prefer == "prophet":
        try:
            return _fit_predict_prophet(train, future_index), "prophet"
        except Exception as e:  # pragma: no cover - environment dependent
            log.warning("Prophet failed (%s); falling back to SARIMA", e)
    return _fit_predict_sarima(train, future_index), "sarima_101_111_12"


def _baseline_log(series: pd.Series, years=C.CLIMATOLOGY_YEARS) -> dict[int, tuple[float, float]]:
    s = series[(series.index.year >= years[0]) & (series.index.year <= years[1])].dropna()
    out = {}
    for m, g in s.groupby(s.index.month):
        v = np.log1p(g.to_numpy())
        if len(v) >= 2:
            out[int(m)] = (float(v.mean()), float(v.std()))
    return out


def forecast_region(region_id: str, rows: list[dict], prefer: str = "prophet") -> dict:
    s = _series(rows)
    s = s[s.index >= pd.Timestamp(TRAIN_YEARS[0], 1, 1)]
    base = {"region_id": region_id, "label": ALERT_LABEL, "train": list(TRAIN_YEARS), "units": "harmonized fire cell-days (VIIRS S-NPP equivalents)"}
    train = s[s.index.year <= TRAIN_YEARS[1]]
    complete = s.dropna()
    if train.notna().sum() < 36 or (train.fillna(0) > 0).sum() < 12 or complete.empty:
        return {**base, "status": "insufficient_data", "model": None, "backtest": [], "metrics": None, "outlook": []}
    last = complete.index.max()
    test_idx = pd.date_range(pd.Timestamp(TRAIN_YEARS[1] + 1, 1, 1), last, freq="MS")
    try:
        bt, model = fit_predict(train, test_idx, prefer)
    except Exception as e:
        log.warning("%s: backtest failed (%s)", region_id, e)
        return {**base, "status": "model_failed", "model": None, "backtest": [], "metrics": None, "outlook": []}

    backtest, ape, inside = [], [], []
    for ts, r in bt.iterrows():
        obs = s.get(ts, np.nan)
        pred, lo, hi = (max(0.0, float(np.expm1(r[k]))) for k in ("mean", "lo", "hi"))
        backtest.append({"month": f"{ts.year}-{ts.month:02d}", "observed": None if np.isnan(obs) else round(float(obs), 1),
                         "predicted": round(pred, 1), "lo": round(lo, 1), "hi": round(hi, 1)})
        if not np.isnan(obs):
            inside.append(lo <= obs <= hi)
            if obs >= 10:
                ape.append(abs(pred - obs) / obs)
    bdf = pd.DataFrame(backtest)
    bdf = bdf[bdf["observed"].notna()]
    bdf["year"] = bdf["month"].str[:4]
    annual = bdf.groupby("year").agg(o=("observed", "sum"), p=("predicted", "sum"), n=("month", "count"))
    annual = annual[(annual["n"] == 12) & (annual["o"] > 0)]
    metrics = {
        "mape": round(float(np.mean(ape)), 3) if ape else None,
        "mape_n": len(ape),
        "annual_mape": round(float(np.mean(np.abs(annual["p"] - annual["o"]) / annual["o"])), 3) if len(annual) else None,
        "coverage": round(float(np.mean(inside)), 3) if inside else None,
        "interval": 0.8,
        "n_test": len(inside),
        "train_end": f"{TRAIN_YEARS[1]}-12",
        "note": "MAPE (fraction) over months with observed >= 10; coverage = share of observed months inside the 80% interval",
    }

    zb = _baseline_log(s)
    out_idx = pd.date_range(last + pd.offsets.MonthBegin(1), periods=3, freq="MS")
    outlook = []
    try:
        ol, model_ol = fit_predict(complete.reindex(pd.date_range(complete.index.min(), last, freq="MS")), out_idx, prefer)
        for ts, r in ol.iterrows():
            se = max(1e-6, (r["hi"] - r["lo"]) / (2 * Z80))
            p1 = p2 = None
            if ts.month in zb:
                mu, sd = zb[ts.month]
                p1 = float(1 - norm.cdf((mu + 1 * (sd + 1e-5) - r["mean"]) / se))
                p2 = float(1 - norm.cdf((mu + 2 * (sd + 1e-5) - r["mean"]) / se))
            alert = "red" if (p2 is not None and p2 > RED_P2) else ("yellow" if (p1 is not None and p1 > YELLOW_P1) else None)
            outlook.append({"month": f"{ts.year}-{ts.month:02d}",
                            "predicted": round(max(0.0, float(np.expm1(r["mean"]))), 1),
                            "lo": round(max(0.0, float(np.expm1(r["lo"]))), 1), "hi": round(max(0.0, float(np.expm1(r["hi"]))), 1),
                            "p_above_z1": None if p1 is None else round(p1, 3), "p_above_z2": None if p2 is None else round(p2, 3),
                            "alert": alert})
    except Exception as e:
        log.warning("%s: outlook failed (%s)", region_id, e)
        model_ol = None
    return {**base, "status": "ok", "model": model, "outlook_model": model_ol, "backtest": backtest, "metrics": metrics, "outlook": outlook,
            "alert_rules": {"yellow": "P(z>1) > 0.60", "red": "P(z>2) > 0.75"}}
