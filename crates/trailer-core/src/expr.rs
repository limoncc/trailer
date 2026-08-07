/// Expression parser for the Trailer query language.
///
/// Grammar:
///   expr     = comparison (("and"|"or") comparison)*
///   comparison = identifier op literal
///   identifier = id ("." id)*           # e.g. config.lr, metric.loss, state
///   op        = "==" | "!=" | ">" | ">=" | "<" | "<="
///   literal   = NUMBER | STRING
///
/// AST nodes are used both for SQL generation (on PG) and in-memory filtering (on SQLite).
use std::collections::HashMap;
use std::fmt;

use crate::domain::RunMeta;

#[derive(Debug, Clone, PartialEq)]
pub enum Op {
    Eq,
    Neq,
    Gt,
    Gte,
    Lt,
    Lte,
}

impl fmt::Display for Op {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            Op::Eq => "==",
            Op::Neq => "!=",
            Op::Gt => ">",
            Op::Gte => ">=",
            Op::Lt => "<",
            Op::Lte => "<=",
        };
        write!(f, "{}", s)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Number(f64),
    String(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Comparison {
    pub identifier: Vec<String>, // e.g. ["config", "lr"]
    pub op: Op,
    pub value: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Logic {
    And,
    Or,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Expr {
    pub comparisons: Vec<Comparison>,
    pub logics: Vec<Logic>,
}

/// Parse a query expression string into an AST.
pub fn parse_expr(input: &str) -> Result<Expr, String> {
    let mut parser = Parser::new(input.trim());
    parser.parse()
}

struct Parser<'a> {
    input: &'a str,
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(input: &'a str) -> Self {
        Self { input, pos: 0 }
    }

    fn remaining(&self) -> &str {
        &self.input[self.pos..]
    }

    fn peek(&self) -> Option<char> {
        self.remaining().chars().next()
    }

    fn skip_ws(&mut self) {
        while let Some(c) = self.peek() {
            if c.is_whitespace() {
                self.pos += c.len_utf8();
            } else {
                break;
            }
        }
    }

    fn parse(&mut self) -> Result<Expr, String> {
        let mut comparisons = Vec::new();
        let mut logics = Vec::new();

        let first = self.parse_comparison()?;
        comparisons.push(first);

        loop {
            self.skip_ws();
            if self.remaining().is_empty() {
                break;
            }

            let logic = self.parse_logic()?;
            logics.push(logic);
            self.skip_ws();

            let comp = self.parse_comparison()?;
            comparisons.push(comp);
        }

        Ok(Expr {
            comparisons,
            logics,
        })
    }

    fn parse_logic(&mut self) -> Result<Logic, String> {
        let rem = self.remaining();
        if rem.starts_with("and")
            && (rem.len() == 3 || !rem[3..].starts_with(|c: char| c.is_alphanumeric()))
        {
            self.pos += 3;
            Ok(Logic::And)
        } else if rem.starts_with("or")
            && (rem.len() == 2 || !rem[2..].starts_with(|c: char| c.is_alphanumeric()))
        {
            self.pos += 2;
            Ok(Logic::Or)
        } else {
            Err(format!("Expected 'and' or 'or' at position {}", self.pos))
        }
    }

    fn parse_comparison(&mut self) -> Result<Comparison, String> {
        self.skip_ws();
        let identifier = self.parse_identifier()?;
        self.skip_ws();
        let op = self.parse_op()?;
        self.skip_ws();
        let value = self.parse_literal()?;

        Ok(Comparison {
            identifier,
            op,
            value,
        })
    }

    fn parse_identifier(&mut self) -> Result<Vec<String>, String> {
        let mut parts = Vec::new();
        let first = self.parse_id_part()?;
        parts.push(first);

        while self.remaining().starts_with('.') {
            self.pos += 1; // skip '.'
            let part = self.parse_id_part()?;
            parts.push(part);
        }
        Ok(parts)
    }

    fn parse_id_part(&mut self) -> Result<String, String> {
        let rem = self.remaining();
        if rem.is_empty() || !rem.starts_with(|c: char| c.is_alphabetic() || c == '_') {
            return Err(format!("Expected identifier at position {}", self.pos));
        }
        let end = rem
            .find(|c: char| !c.is_alphanumeric() && c != '_')
            .unwrap_or(rem.len());
        let ident = rem[..end].to_string();
        self.pos += end;
        Ok(ident)
    }

    fn parse_op(&mut self) -> Result<Op, String> {
        let rem = self.remaining();
        if rem.starts_with("==") {
            self.pos += 2;
            return Ok(Op::Eq);
        }
        if rem.starts_with("!=") {
            self.pos += 2;
            return Ok(Op::Neq);
        }
        if rem.starts_with(">=") {
            self.pos += 2;
            return Ok(Op::Gte);
        }
        if rem.starts_with("<=") {
            self.pos += 2;
            return Ok(Op::Lte);
        }
        if rem.starts_with('>') {
            self.pos += 1;
            return Ok(Op::Gt);
        }
        if rem.starts_with('<') {
            self.pos += 1;
            return Ok(Op::Lt);
        }
        Err(format!(
            "Expected comparison operator at position {}",
            self.pos
        ))
    }

    fn parse_literal(&mut self) -> Result<Value, String> {
        let rem = self.remaining();
        if rem.is_empty() {
            return Err("Unexpected end of input".into());
        }

        // String literal
        if rem.starts_with('"') {
            let end = rem[1..]
                .find('"')
                .map(|i| i + 2)
                .ok_or("Unclosed string literal")?;
            let val = rem[1..end - 1].to_string();
            self.pos += end;
            return Ok(Value::String(val));
        }

        // Number literal
        if rem.starts_with(|c: char| c.is_ascii_digit() || c == '-') {
            let end = rem[1..]
                .find(|c: char| !c.is_ascii_digit() && c != '.' && c != 'e' && c != 'E' && c != '-')
                .map(|i| i + 1)
                .unwrap_or(rem.len());
            let num_str = &rem[..end];
            match num_str.parse::<f64>() {
                Ok(n) => {
                    self.pos += end;
                    return Ok(Value::Number(n));
                }
                Err(_) => return Err(format!("Invalid number: {}", num_str)),
            }
        }

        Err(format!(
            "Expected literal at position {}: '{}'",
            self.pos,
            &rem[..rem.len().min(20)]
        ))
    }
}

/// Evaluate a query expression against a RunMeta. Returns true if the run matches.
/// Prefix rules: `config.X` → config JSON, `state` → run.state, `name` → run.name
pub fn eval_run_filter(run: &RunMeta, expr_str: &str) -> bool {
    eval_run_filter_with_summary(run, expr_str, &HashMap::new())
}

/// Like [`eval_run_filter`], additionally supporting `metric.<key>[.<context>]`
/// via a summary map keyed by summary key (e.g. "loss/" or "loss/train") → last value.
pub fn eval_run_filter_with_summary(
    run: &RunMeta,
    expr_str: &str,
    summary: &HashMap<String, f64>,
) -> bool {
    let parsed = match parse_expr(expr_str) {
        Ok(e) => e,
        Err(_) => return true, // if parsing fails, include the run (graceful fallback)
    };

    if parsed.comparisons.is_empty() {
        return true;
    }

    // Evaluate each comparison
    let mut results = Vec::new();
    for comp in &parsed.comparisons {
        let matched = eval_comparison(run, comp, summary);
        results.push(matched);
    }

    // Combine with AND/OR logic
    let mut final_result = results[0];
    for (i, logic) in parsed.logics.iter().enumerate() {
        if i + 1 < results.len() {
            match logic {
                Logic::And => final_result = final_result && results[i + 1],
                Logic::Or => final_result = final_result || results[i + 1],
            }
        }
    }
    final_result
}

fn eval_comparison(run: &RunMeta, comp: &Comparison, summary: &HashMap<String, f64>) -> bool {
    // Resolve the value from the run based on the identifier path
    let actual = resolve_value(run, &comp.identifier, summary);
    match actual {
        Some(actual_val) => compare_values(&actual_val, &comp.op, &comp.value),
        None => false, // field not found → no match
    }
}

fn resolve_value(run: &RunMeta, ident: &[String], summary: &HashMap<String, f64>) -> Option<Value> {
    if ident.is_empty() {
        return None;
    }

    match ident[0].as_str() {
        "state" => Some(Value::String(run.state.clone())),
        "name" => run.name.clone().map(Value::String),
        "project" => Some(Value::String(run.project.clone())),
        "config" => {
            // config.lr → run.config["lr"], config.model.depth → run.config["model"]["depth"]
            if ident.len() < 2 {
                return None;
            }
            let mut current = &run.config;
            for key in &ident[1..] {
                match current.get(key) {
                    Some(v) => current = v,
                    None => return None,
                }
            }
            value_from_json(current)
        }
        "metric" => {
            // metric.loss → summary["loss/"], metric.loss.train → summary["loss/train"]
            if ident.len() < 2 {
                return None;
            }
            let key = ident[1].clone();
            let context = if ident.len() >= 3 {
                ident[2].clone()
            } else {
                String::new()
            };
            let summary_key = format!("{}/{}", key, context);
            summary.get(&summary_key).copied().map(Value::Number)
        }
        _ => None,
    }
}

fn value_from_json(v: &serde_json::Value) -> Option<Value> {
    match v {
        serde_json::Value::Number(n) => n.as_f64().map(Value::Number),
        serde_json::Value::String(s) => Some(Value::String(s.clone())),
        serde_json::Value::Bool(b) => Some(Value::String(b.to_string())),
        _ => None,
    }
}

fn compare_values(actual: &Value, op: &Op, expected: &Value) -> bool {
    match (actual, expected) {
        (Value::Number(a), Value::Number(e)) => match op {
            Op::Eq => (a - e).abs() < 1e-9,
            Op::Neq => (a - e).abs() >= 1e-9,
            Op::Gt => a > e,
            Op::Gte => a >= e,
            Op::Lt => a < e,
            Op::Lte => a <= e,
        },
        (Value::String(a), Value::String(e)) => match op {
            Op::Eq => a == e,
            Op::Neq => a != e,
            _ => false, // string ordering not available
        },
        _ => false,
    }
}

// ─── Tests ───
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_comparison() {
        let expr = parse_expr("config.lr > 0.001").unwrap();
        assert_eq!(expr.comparisons.len(), 1);
        assert_eq!(expr.comparisons[0].identifier, vec!["config", "lr"]);
        assert_eq!(expr.comparisons[0].op, Op::Gt);
        assert_eq!(expr.comparisons[0].value, Value::Number(0.001));
    }

    #[test]
    fn parse_string_comparison() {
        let expr = parse_expr("state == \"running\"").unwrap();
        assert_eq!(expr.comparisons[0].identifier, vec!["state"]);
        assert_eq!(expr.comparisons[0].value, Value::String("running".into()));
    }

    #[test]
    fn parse_and_expression() {
        let expr = parse_expr("config.lr > 0.001 and metric.loss < 0.5").unwrap();
        assert_eq!(expr.comparisons.len(), 2);
        assert_eq!(expr.logics.len(), 1);
        assert_eq!(expr.logics[0], Logic::And);
    }

    #[test]
    fn metric_filter_with_summary() {
        let run = RunMeta {
            run_id: "r1".into(),
            project: "p".into(),
            group_name: None,
            name: Some("test".into()),
            state: "finished".into(),
            config: serde_json::json!({}),
            env: serde_json::json!({}),
            git_commit: None,
            sweep_id: None,
            created_at: 0.0,
            heartbeat_at: None,
            tags: None,
            owner_id: None,
        };
        let mut summary = HashMap::new();
        summary.insert("loss/".to_string(), 0.3);
        assert!(eval_run_filter_with_summary(
            &run,
            "metric.loss < 0.5",
            &summary
        ));
        assert!(!eval_run_filter_with_summary(
            &run,
            "metric.loss > 1.0",
            &summary
        ));
        // 无 summary 时不匹配
        assert!(!eval_run_filter_with_summary(
            &run,
            "metric.loss < 0.5",
            &HashMap::new()
        ));
        // 带 context:metric.loss.train → summary["loss/train"]
        let mut summary2 = HashMap::new();
        summary2.insert("loss/train".to_string(), 0.2);
        assert!(eval_run_filter_with_summary(
            &run,
            "metric.loss.train < 0.3",
            &summary2
        ));
        // 与 config 组合
        let mut summary3 = HashMap::new();
        summary3.insert("loss/".to_string(), 0.4);
        let run_cfg = RunMeta {
            config: serde_json::json!({"lr": 0.01}),
            ..run.clone()
        };
        assert!(eval_run_filter_with_summary(
            &run_cfg,
            "config.lr > 0.001 and metric.loss < 0.5",
            &summary3
        ));
    }

    #[test]
    fn parse_or_expression() {
        let expr = parse_expr("state == \"crashed\" or state == \"killed\"").unwrap();
        assert_eq!(expr.comparisons.len(), 2);
        assert_eq!(expr.logics[0], Logic::Or);
    }

    #[test]
    fn parse_all_operators() {
        for (input, expected_op) in [
            ("a == 1", Op::Eq),
            ("a != 1", Op::Neq),
            ("a > 1", Op::Gt),
            ("a >= 1", Op::Gte),
            ("a < 1", Op::Lt),
            ("a <= 1", Op::Lte),
        ] {
            let expr = parse_expr(input).unwrap();
            assert_eq!(expr.comparisons[0].op, expected_op);
        }
    }

    #[test]
    fn parse_deep_identifier() {
        let expr = parse_expr("config.model.encoder.depth == 12").unwrap();
        assert_eq!(
            expr.comparisons[0].identifier,
            vec!["config", "model", "encoder", "depth"]
        );
    }

    #[test]
    fn parse_syntax_error() {
        let result = parse_expr("abc @@@ 123");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Expected"));
    }

    #[test]
    fn eval_state_running() {
        let run = RunMeta {
            run_id: "r1".into(),
            project: "test".into(),
            group_name: None,
            name: None,
            state: "running".into(),
            config: serde_json::json!({"lr": 0.001}),
            env: serde_json::json!({}),
            git_commit: None,
            sweep_id: None,
            created_at: 0.0,
            heartbeat_at: None,
            tags: None,
            owner_id: None,
        };
        assert!(eval_run_filter(&run, "state == \"running\""));
        assert!(!eval_run_filter(&run, "state == \"finished\""));
    }

    #[test]
    fn eval_config_lr() {
        let run = RunMeta {
            run_id: "r1".into(),
            project: "test".into(),
            group_name: None,
            name: None,
            state: "running".into(),
            config: serde_json::json!({"lr": 0.001}),
            env: serde_json::json!({}),
            git_commit: None,
            sweep_id: None,
            created_at: 0.0,
            heartbeat_at: None,
            tags: None,
            owner_id: None,
        };
        assert!(eval_run_filter(&run, "config.lr > 0.0005"));
        assert!(!eval_run_filter(&run, "config.lr < 0.0005"));
        assert!(eval_run_filter(&run, "config.lr == 0.001"));
    }

    #[test]
    fn eval_and_expression() {
        let run = RunMeta {
            run_id: "r1".into(),
            project: "test".into(),
            group_name: None,
            name: None,
            state: "running".into(),
            config: serde_json::json!({"lr": 0.001, "epochs": 100}),
            env: serde_json::json!({}),
            git_commit: None,
            sweep_id: None,
            created_at: 0.0,
            heartbeat_at: None,
            tags: None,
            owner_id: None,
        };
        assert!(eval_run_filter(
            &run,
            "config.lr > 0.0005 and config.epochs >= 50"
        ));
        assert!(!eval_run_filter(
            &run,
            "config.lr > 0.0005 and config.epochs > 200"
        ));
    }

    #[test]
    fn eval_or_expression() {
        let run = RunMeta {
            run_id: "r1".into(),
            project: "test".into(),
            group_name: None,
            name: None,
            state: "running".into(),
            config: serde_json::json!({}),
            env: serde_json::json!({}),
            git_commit: None,
            sweep_id: None,
            created_at: 0.0,
            heartbeat_at: None,
            tags: None,
            owner_id: None,
        };
        assert!(eval_run_filter(
            &run,
            "state == \"running\" or state == \"finished\""
        ));
        assert!(!eval_run_filter(
            &run,
            "state == \"crashed\" or state == \"killed\""
        ));
    }
}
