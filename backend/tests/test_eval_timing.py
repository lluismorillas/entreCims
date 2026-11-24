"""Calibració de Naismith i comparació aparellada de `eval/timing.py`."""

import importlib.util
from pathlib import Path

path = Path(__file__).parents[2] / "eval" / "timing.py"
spec = importlib.util.spec_from_file_location("eval_timing", path)
ev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ev)


def test_paired_counts_wins_and_brackets_the_mean():
    mean, lo, hi, wins = ev.paired([0.1, 0.05, -0.02], [0.2, 0.1, 0.1])
    assert wins == 3 and lo <= mean <= hi < 0
