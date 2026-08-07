/// Deep config diff: compares two JSON values and produces a structured diff.
/// Used for the Config Diff view in the UI (side-by-side comparison of runs).
use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub enum DiffOp {
    /// Key was added with this value
    Added(Value),
    /// Value changed from old to new
    Modified(Value, Value),
    /// Key was removed (old value shown)
    Removed(Value),
}

/// Result of diffing two JSON objects.
/// Keys present in `a` only appear as Removed.
/// Keys present in `b` only appear as Added.
/// Keys present in both appear as Modified (if different) or omitted (if same).
pub fn diff_configs(a: &Value, b: &Value) -> serde_json::Map<String, Value> {
    let mut result = serde_json::Map::new();

    match (a, b) {
        (Value::Object(a_map), Value::Object(b_map)) => {
            // Keys in A but not in B → removed
            for (k, v) in a_map {
                if !b_map.contains_key(k) {
                    result.insert(k.clone(), serde_json::json!({"op": "removed", "old": v}));
                }
            }
            // Keys in B
            for (k, v2) in b_map {
                match a_map.get(k) {
                    None => {
                        // New key → added
                        result.insert(k.clone(), serde_json::json!({"op": "added", "new": v2}));
                    }
                    Some(v1) => {
                        if v1 == v2 {
                            // Same — skip
                            continue;
                        }
                        if v1.is_object() && v2.is_object() {
                            // Recurse into nested objects
                            let nested = diff_configs(v1, v2);
                            if !nested.is_empty() {
                                result.insert(
                                    k.clone(),
                                    serde_json::json!({"op": "modified", "changes": nested}),
                                );
                            }
                        } else {
                            // Scalar change
                            result.insert(
                                k.clone(),
                                serde_json::json!({"op": "modified", "old": v1, "new": v2}),
                            );
                        }
                    }
                }
            }
        }
        _ => {
            // Top-level scalar diff
            if a != b {
                result.insert(
                    "_root".into(),
                    serde_json::json!({"op": "modified", "old": a, "new": b}),
                );
            }
        }
    }

    result
}

// ─── Tests ───
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_configs_produce_empty_diff() {
        let a = serde_json::json!({"lr": 0.01, "epochs": 10});
        let b = serde_json::json!({"lr": 0.01, "epochs": 10});
        let diff = diff_configs(&a, &b);
        assert!(diff.is_empty());
    }

    #[test]
    fn modified_scalar() {
        let a = serde_json::json!({"lr": 0.01});
        let b = serde_json::json!({"lr": 0.001});
        let diff = diff_configs(&a, &b);
        assert_eq!(diff["lr"]["op"], "modified");
        assert!((diff["lr"]["old"].as_f64().unwrap() - 0.01).abs() < 1e-9);
        assert!((diff["lr"]["new"].as_f64().unwrap() - 0.001).abs() < 1e-9);
    }

    #[test]
    fn added_key() {
        let a = serde_json::json!({"lr": 0.01});
        let b = serde_json::json!({"lr": 0.01, "batch_size": 32});
        let diff = diff_configs(&a, &b);
        assert_eq!(diff["batch_size"]["op"], "added");
    }

    #[test]
    fn removed_key() {
        let a = serde_json::json!({"lr": 0.01, "old_param": true});
        let b = serde_json::json!({"lr": 0.01});
        let diff = diff_configs(&a, &b);
        assert_eq!(diff["old_param"]["op"], "removed");
    }

    #[test]
    fn nested_diff() {
        let a = serde_json::json!({"model": {"depth": 50, "width": 256}});
        let b = serde_json::json!({"model": {"depth": 100, "width": 256}});
        let diff = diff_configs(&a, &b);
        assert_eq!(diff["model"]["op"], "modified");
        assert_eq!(
            diff["model"]["changes"]["depth"]["old"].as_i64().unwrap(),
            50
        );
        assert_eq!(
            diff["model"]["changes"]["depth"]["new"].as_i64().unwrap(),
            100
        );
        assert!(
            !diff["model"]["changes"]
                .as_object()
                .unwrap()
                .contains_key("width"),
            "unchanged width should be omitted"
        );
    }
}
