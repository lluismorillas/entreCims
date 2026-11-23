"""Mètriques i partició de `eval/peaks.py`."""

import importlib.util
import math
from pathlib import Path

path = Path(__file__).parents[2] / "eval" / "peaks.py"
spec = importlib.util.spec_from_file_location("eval_peaks", path)
ev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ev)


def test_scores():
    assert ev.scores([1, 1, 0, 0], [True, False, True, False]) == (0.5, 0.5, 0.5)
    precision, recall, f1 = ev.scores([0, 0], [False, False])
    assert math.isnan(precision) and math.isnan(recall) and math.isnan(f1)


def test_split_is_by_peak_and_stable():
    assert ev.in_test("123") == ev.in_test("123")
    parts = {ev.in_test(str(i)) for i in range(50)}
    assert parts == {True, False}


def test_bootstrap_resamples_whole_peaks():
    # Un cim sempre encertat i un sempre fallat: cap rèplica pot barrejar-ne els parells.
    (p_lo, p_hi), _, _ = ev.bootstrap(
        ["a", "a", "b", "b"], [1, 1, 1, 1], [True, True, False, False]
    )
    assert (p_lo, p_hi) == (1.0, 1.0)
