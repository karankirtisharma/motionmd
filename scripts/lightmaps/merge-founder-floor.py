"""Merge the targeted floor bake without changing any other atlas receiver.

Run after denoise.py, before convert.py encode. Inputs live outside the website.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from scipy import ndimage as ndi


def coverage(path, width, height):
    mask = np.zeros((height, width), bool)
    for tri in np.fromfile(path, np.float32).reshape(-1, 3, 2):
        t = tri * [width, height] - .5
        lo = np.maximum(np.floor(t.min(axis=0)).astype(int), [0, 0])
        hi = np.minimum(np.ceil(t.max(axis=0)).astype(int), [width - 1, height - 1])
        if (hi < lo).any():
            continue
        ab, ac = t[1] - t[0], t[2] - t[0]
        det = ab[0] * ac[1] - ab[1] * ac[0]
        if abs(det) < 1e-8:
            continue
        x, y = np.meshgrid(np.arange(lo[0], hi[0] + 1), np.arange(lo[1], hi[1] + 1))
        dx, dy = x - t[0, 0], y - t[0, 1]
        a = (dx * (t[2, 1] - t[0, 1]) - dy * (t[2, 0] - t[0, 0])) / det
        b = ((t[1, 0] - t[0, 0]) * dy - (t[1, 1] - t[0, 1]) * dx) / det
        mask[lo[1]:hi[1] + 1, lo[0]:hi[0] + 1] |= (a >= -1e-4) & (b >= -1e-4) & (a + b <= 1.0001)
    return mask


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--arrays', type=Path, required=True)
args = parser.parse_args()
data = args.arrays.resolve()
old = np.load(data / 'founder-floor-old.npy')
clean = np.load(data / 'founder-floor-clean.npy')
mask = np.load(data / 'founder-floor-coverage.npy')
h, w = mask.shape
protected = coverage(data / 'protected-uv.bin', w, h)
assert not (mask & protected).any(), 'Receiver overlaps another atlas chart'
distance = ndi.distance_transform_edt(~mask)
protected_distance = ndi.distance_transform_edt(~protected)
# Keep neighboring chart texels and their existing 4px filtering border intact.
replace = mask | ((distance <= 4) & (protected_distance > 4))
merged = old.copy()
merged[replace] = clean[replace]
assert np.array_equal(merged[~replace], old[~replace])
assert np.array_equal(merged[protected], old[protected])
np.save(data / 'founder-floor-isolated-clean.npy', clean)
np.save(data / 'founder-floor-clean.npy', merged)
report_path = data / 'founder-floor-report.json'
report = json.loads(report_path.read_text())
report['atlasMerge'] = {
    'receiverPixels': int(mask.sum()),
    'replacedPixelsIncludingPadding': int(replace.sum()),
    'protectedChartPixels': int(protected.sum()),
    'preservedPixels': int((~replace).sum()),
    'maxDifferenceOutsideReplacement': 0,
    'maxDifferenceOnProtectedCharts': 0,
}
report_path.write_text(json.dumps(report, indent=2))
print(json.dumps(report['atlasMerge'], indent=2))
