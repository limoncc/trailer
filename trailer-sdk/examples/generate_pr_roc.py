"""Generate PR/ROC demo data — log curves to an existing run."""
import json, urllib.request
import numpy as np
from sklearn.metrics import precision_recall_curve, roc_curve, auc

HOST = "http://127.0.0.1:5120"

# Get a demo run
runs = json.loads(urllib.request.urlopen(f"{HOST}/api/v1/runs?project=demo").read())
rid = runs[0]["run_id"]
print(f"Run: {rid[:16]}...")

# Generate synthetic predictions (3 models for overlay)
np.random.seed(42)
n = 200
y_true = np.random.randint(0, 2, n).astype(float)

models = [
    ("Model A (strong)", y_true * 0.9 + np.random.rand(n) * 0.1),
    ("Model B (medium)", y_true * 0.7 + np.random.rand(n) * 0.3),
    ("Model C (weak)",   y_true * 0.5 + np.random.rand(n) * 0.5),
]

for name, y_score in models:
    # PR curve
    precision, recall, _ = precision_recall_curve(y_true, y_score)
    pr_auc = auc(recall, precision)
    pr_data = [{"x": float(r), "y": float(p)} for r, p in zip(recall, precision)]
    pr_spec = {
        "type": "line",
        "data": pr_data,
        "encode": {"x": "x", "y": "y"},
        "style": {"stroke": "#2a78d6"},
        "axis": {"x": {"title": "Recall"}, "y": {"title": "Precision"}},
    }
    payload = {"name": f"PR Curve - {name}", "kind": "g2",
               "body": json.dumps(pr_spec), "step": 0}
    req = urllib.request.Request(f"{HOST}/api/v1/runs/{rid}/figures",
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json"}, method="POST")
    urllib.request.urlopen(req)
    print(f"  PR {name}: AUC={pr_auc:.3f}")

    # ROC curve
    fpr, tpr, _ = roc_curve(y_true, y_score)
    roc_auc_val = auc(fpr, tpr)
    roc_data = [{"x": float(f), "y": float(t)} for f, t in zip(fpr, tpr)]
    roc_spec = {
        "type": "line",
        "data": roc_data,
        "encode": {"x": "x", "y": "y"},
        "style": {"stroke": "#eb6834"},
        "axis": {"x": {"title": "FPR"}, "y": {"title": "TPR"}},
    }
    payload = {"name": f"ROC Curve - {name}", "kind": "g2",
               "body": json.dumps(roc_spec), "step": 0}
    req = urllib.request.Request(f"{HOST}/api/v1/runs/{rid}/figures",
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json"}, method="POST")
    urllib.request.urlopen(req)
    print(f"  ROC {name}: AUC={roc_auc_val:.3f}")

print(f"\n✅ Done! Check Figures tab: {HOST}/run/{rid}")
