use std::collections::{BTreeMap, VecDeque};

use super::types::{WorkflowDag, WorkflowValidationIssue, WorkflowValidationResult};

pub fn validate_dag(dag: &WorkflowDag) -> WorkflowValidationResult {
    let mut issues = Vec::new();
    validate_links(dag, &mut issues);
    let execution_order = topological_order(dag, &mut issues);
    validate_boundaries(dag, &mut issues);

    WorkflowValidationResult {
        valid: issues.is_empty(),
        issues,
        execution_order,
    }
}

fn validate_links(dag: &WorkflowDag, issues: &mut Vec<WorkflowValidationIssue>) {
    let nodes = dag
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<BTreeMap<_, _>>();

    for link in &dag.links {
        if !nodes.contains_key(link.from_node_id.as_str()) {
            issues.push(issue(
                "missingSourceNode",
                "连线来源节点不存在",
                Some(link.from_node_id.clone()),
                Some(link.id.clone()),
            ));
        }
        if !nodes.contains_key(link.to_node_id.as_str()) {
            issues.push(issue(
                "missingTargetNode",
                "连线目标节点不存在",
                Some(link.to_node_id.clone()),
                Some(link.id.clone()),
            ));
        }
        if !types_match(&link.from_type, &link.to_type) {
            issues.push(issue(
                "portTypeMismatch",
                format!("端口类型不匹配：{} -> {}", link.from_type, link.to_type),
                Some(link.to_node_id.clone()),
                Some(link.id.clone()),
            ));
        }
    }
}

fn topological_order(dag: &WorkflowDag, issues: &mut Vec<WorkflowValidationIssue>) -> Vec<String> {
    let mut indegree = dag
        .nodes
        .iter()
        .map(|node| (node.id.clone(), 0usize))
        .collect::<BTreeMap<_, _>>();
    let mut outgoing = BTreeMap::<String, Vec<String>>::new();

    for link in &dag.links {
        if !indegree.contains_key(&link.from_node_id) || !indegree.contains_key(&link.to_node_id) {
            continue;
        }
        *indegree.entry(link.to_node_id.clone()).or_insert(0) += 1;
        outgoing
            .entry(link.from_node_id.clone())
            .or_default()
            .push(link.to_node_id.clone());
    }

    let mut queue = indegree
        .iter()
        .filter(|(_, count)| **count == 0)
        .map(|(node_id, _)| node_id.clone())
        .collect::<VecDeque<_>>();
    let mut order = Vec::new();

    while let Some(node_id) = queue.pop_front() {
        order.push(node_id.clone());
        for target in outgoing.get(&node_id).into_iter().flatten() {
            if let Some(count) = indegree.get_mut(target) {
                *count -= 1;
                if *count == 0 {
                    queue.push_back(target.clone());
                }
            }
        }
    }

    if order.len() != indegree.len() {
        issues.push(issue("cycleDetected", "工作流存在循环依赖", None, None));
    }

    order
}

fn validate_boundaries(dag: &WorkflowDag, issues: &mut Vec<WorkflowValidationIssue>) {
    if dag.nodes.is_empty() {
        issues.push(issue("emptyWorkflow", "工作流至少需要一个节点", None, None));
        return;
    }

    let mut incoming = BTreeMap::<String, usize>::new();
    let mut outgoing = BTreeMap::<String, usize>::new();
    for node in &dag.nodes {
        incoming.insert(node.id.clone(), 0);
        outgoing.insert(node.id.clone(), 0);
    }
    for link in &dag.links {
        *incoming.entry(link.to_node_id.clone()).or_insert(0) += 1;
        *outgoing.entry(link.from_node_id.clone()).or_insert(0) += 1;
    }

    if !incoming.values().any(|count| *count == 0) {
        issues.push(issue("missingRoot", "工作流缺少根节点", None, None));
    }
    if !outgoing.values().any(|count| *count == 0) {
        issues.push(issue("missingTerminal", "工作流缺少终止节点", None, None));
    }
}

fn types_match(from_type: &str, to_type: &str) -> bool {
    from_type == "any" || to_type == "any" || from_type == to_type
}

fn issue(
    code: impl Into<String>,
    message: impl Into<String>,
    node_id: Option<String>,
    link_id: Option<String>,
) -> WorkflowValidationIssue {
    WorkflowValidationIssue {
        code: code.into(),
        message: message.into(),
        node_id,
        link_id,
    }
}
