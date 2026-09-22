#!/usr/bin/env python3
"""Turns a downloaded query-log CSV into the numbers the plan-back's weekly review asks for (plan-back section 8):
active users, questions per user, the share rated helpful, the share not covered and its most repeated questions,
thumbs-down comments, and latency.

Download the CSV first, signed in as an admin (optionally ?since=YYYY-MM-DD to limit the range):
    /api/assistant/admin/log.csv?since=2026-09-15

Then:
    python -m tools.weekly_summary ~/Downloads/assistant-log.csv

This file cannot see sync health, skipped/failed documents, or whether a model server is reachable right now --
that is what the admin status page is for (/api/assistant/admin/status.html), not the log."""
from __future__ import annotations

import argparse
import csv
import math
from collections import Counter
from pathlib import Path


def load(path):
    with open(path, newline="", encoding="utf-8-sig") as handle:   # utf-8-sig: the export leads with a BOM
        return list(csv.DictReader(handle))


def _pct(n, of):
    return f"{100 * n / of:.0f}%" if of else "n/a"


def _percentile(sorted_values, p):
    if not sorted_values:
        return "n/a"
    index = max(0, math.ceil(len(sorted_values) * p) - 1)
    return f"{sorted_values[index]} ms"


def summarise(rows, top=10):
    if not rows:
        return "No questions in this file."

    users = Counter(r["user_id"] for r in rows)
    states = Counter(r["state"] for r in rows)
    rated = [r for r in rows if r["rating"]]
    ms = sorted(int(r["ms"]) for r in rows if r["ms"])
    busiest_id, busiest_n = users.most_common(1)[0]

    lines = [f"{len(rows)} questions from {len(users)} users, {min(r['at'] for r in rows)} to "
             f"{max(r['at'] for r in rows)}",
             f"  answered {states.get('answered', 0)} ({_pct(states.get('answered', 0), len(rows))}), "
             f"not covered {states.get('not_found', 0)} ({_pct(states.get('not_found', 0), len(rows))}), "
             f"unavailable {states.get('unavailable', 0)} ({_pct(states.get('unavailable', 0), len(rows))})"]
    if rated:
        up = sum(1 for r in rated if r["rating"] == "up")
        lines.append(f"  {len(rated)} rated ({_pct(len(rated), len(rows))} of all questions), "
                     f"{_pct(up, len(rated))} of those marked helpful")
    else:
        lines.append("  nobody has rated an answer yet")
    lines.append(f"  p50 {_percentile(ms, 0.50)}, p95 {_percentile(ms, 0.95)}")
    lines.append(f"  questions per active user: {len(rows) / len(users):.1f} average, "
                 f"busiest: {busiest_n} (user {busiest_id})")

    not_covered = Counter(r["question"] for r in rows if r["state"] == "not_found")
    if not_covered:
        lines.append(f"\nNot covered ({sum(not_covered.values())}), most repeated first "
                     "-- content gaps or naming problems, candidates for the golden set:")
        lines += [f"  {n}x  {q}" for q, n in not_covered.most_common(top)]

    commented = [r for r in rows if r["rating"] == "down" and r["comment"]]
    if commented:
        lines.append(f"\nThumbs-down with a comment ({len(commented)}):")
        lines += [f"  {r['question']!r} -> {r['comment']!r}" for r in commented[:top]]

    lines.append("\nNot in this file: sync health, documents skipped/failed, model availability -- see the admin "
                 "status page (/api/assistant/admin/status.html) for those.")
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("--top", type=int, default=10, help="how many not-covered questions / comments to list")
    args = parser.parse_args(argv)
    print(summarise(load(args.csv_path), args.top))


if __name__ == "__main__":
    main()
