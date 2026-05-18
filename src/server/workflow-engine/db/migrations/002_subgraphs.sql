-- Subgraph primitive support (A.7-subgraphs).
--
-- 1. workflow_definitions.kind — discriminates 'workflow' (runnable) from
--    'subgraph' (referenceable via DagNode.subgraph). All existing rows
--    default to 'workflow' so the upgrade is non-breaking.
-- 2. node_runs.parent_subgraph_node_run_id — FK back to the placeholder
--    node_run row that represents a subgraph expansion. NULL for normal
--    nodes; set on every child node_run produced by expanding a subgraph
--    reference.

ALTER TABLE workflow_definitions ADD COLUMN kind TEXT NOT NULL DEFAULT 'workflow';
CREATE INDEX idx_wd_kind ON workflow_definitions(kind);

ALTER TABLE node_runs ADD COLUMN parent_subgraph_node_run_id TEXT
  REFERENCES node_runs(id) ON DELETE CASCADE;
CREATE INDEX idx_nr_subgraph ON node_runs(parent_subgraph_node_run_id);
