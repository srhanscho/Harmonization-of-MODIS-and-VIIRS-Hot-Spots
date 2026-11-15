"""End-to-end smoke test of process.py on the TEST-ONLY fixtures, written to a temp folder."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import process  # noqa: E402
import regions  # noqa: E402

FIX = Path(__file__).parent / "fixtures"


@pytest.mark.skipif(not regions.ADMIN1_FILE.exists(), reason="run `python regions.py` first to fetch boundaries")
def test_process_end_to_end(tmp_path):
    rc = process.main(["--from-archive", str(FIX), "--no-raw", "--countries", "CO", "--out", str(tmp_path)])
    assert rc == 0
    regs = json.loads((tmp_path / "regions.json").read_text(encoding="utf-8"))
    ids = {r["id"] for r in regs}
    assert {"CO", "CO-VID", "DEMO-SNSM"} <= ids
    rows = json.loads((tmp_path / "monthly" / "CO-VID.json").read_text(encoding="utf-8"))
    keys = {(r["year"], r["month"]) for r in rows}
    assert len(keys) == len(rows)  # no duplicate months
    for field in ("raw_modis", "raw_viirs", "harmonized", "harmonized_p5", "harmonized_p95", "source", "factor", "regime",
                  "w", "partial", "z", "z_class", "frp_raw_modis", "frp_raw_viirs", "frp_harmonized"):
        assert field in rows[0]
    mar = next(r for r in rows if (r["year"], r["month"]) == (2014, 3))
    assert mar["raw_aqua"] == 2 and mar["harmonized"] is not None
    assert rows[0]["harmonized"] is None  # Nov 2000: no sensor in fixture -> null, not 0
    clim = json.loads((tmp_path / "climatology" / "CO-VID.json").read_text(encoding="utf-8"))
    assert [c["month"] for c in clim] == list(range(1, 13))
    assert (tmp_path / "validation.json").exists() and (tmp_path / "meta.json").exists()
    assert (tmp_path / "cells" / "CO" / "2014.json").exists()
    vid = json.loads((tmp_path / "cells" / "CO-VID" / "2014.json").read_text(encoding="utf-8"))
    assert vid["regions"] == ["CO-VID"] and len(vid["cells"]) == 2
    meta = json.loads((tmp_path / "meta.json").read_text(encoding="utf-8"))
    assert {"year", "month"} <= set(meta["last_month"])
    fc = json.loads((tmp_path / "forecast" / "CO-VID.json").read_text(encoding="utf-8"))
    assert fc["status"] == "insufficient_data"  # tiny fixture: no model is fitted
    val = json.loads((tmp_path / "validation.json").read_text(encoding="utf-8"))
    assert {"frp_calibration", "z_agreement", "loyo", "seam_2012"} <= set(val)
    assert not any("_" == k[0] for r in rows for k in r)  # private fields are not exported
