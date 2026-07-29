use super::types::{slot_type_to_string, DagLink, DagNode, WorkflowDag, WorkflowDocument};

pub fn parse_workflow(workflow: &WorkflowDocument) -> WorkflowDag {
    let nodes = workflow
        .graph
        .nodes
        .iter()
        .map(|node| DagNode {
            id: node.id.as_key(),
            node_type: node.node_type.clone(),
            title: node.title.clone().unwrap_or_else(|| node.node_type.clone()),
            properties: node.properties.clone(),
        })
        .collect();

    let links = workflow
        .graph
        .links
        .iter()
        .map(|link| {
            let from_node_id = link.origin_id.as_key();
            let to_node_id = link.target_id.as_key();
            let from_type = workflow
                .graph
                .nodes
                .iter()
                .find(|node| node.id.as_key() == from_node_id)
                .and_then(|node| node.outputs.get(link.origin_slot))
                .map(|slot| slot_type_to_string(&slot.slot_type))
                .unwrap_or_else(|| slot_type_to_string(&link.link_type));
            let to_type = workflow
                .graph
                .nodes
                .iter()
                .find(|node| node.id.as_key() == to_node_id)
                .and_then(|node| node.inputs.get(link.target_slot))
                .map(|slot| slot_type_to_string(&slot.slot_type))
                .unwrap_or_else(|| slot_type_to_string(&link.link_type));

            DagLink {
                id: link.id.as_key(),
                from_node_id,
                from_slot: link.origin_slot,
                from_type,
                to_node_id,
                to_slot: link.target_slot,
                to_type,
            }
        })
        .collect();

    WorkflowDag {
        workflow_id: workflow.id.clone(),
        nodes,
        links,
    }
}
