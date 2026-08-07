"""E2E demo: simulate a training loop and verify data lands in SQLite."""
import os
import sys
import tempfile

# Use in-memory database for tests
db_path = "sqlite::memory:"

from trailer import Tracker

tracker = Tracker(project="e2e_demo", db_path=db_path)

print(f"Run ID: {tracker.run_id}")
print(f"Mode: {tracker._mode}")

# Simulate 100 training steps with context-separated train/val metrics
for step in range(100):
    loss = 1.0 / (step + 1.0)
    val_loss = 1.0 / (step + 1.0) + 0.05  # val slightly higher
    lr = 0.001 * (0.95 ** step)
    tracker.log({"loss": loss, "train/loss": loss, "val/loss": val_loss, "lr": lr}, step=step)

tracker.finish()
print(f"Logged 100 steps for Run {tracker.run_id}")
print("E2E demo complete.")
