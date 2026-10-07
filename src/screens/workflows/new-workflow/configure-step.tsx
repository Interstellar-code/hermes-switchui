import { nodeColor as colorFor } from '../node-colors'
import { NODE_TYPE_OPTIONS, slugify, splitCsv } from './wizard-draft'
import type { WizardHermesTaskDraft, WizardNodeDraft } from './wizard-draft'
import type { NodeType } from '../types'

export interface ConfigureStepProps {
  nodes: Array<WizardNodeDraft>
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  onUpdateNode: (nodeId: string, patch: Partial<WizardNodeDraft>) => void
  onUpdateHermesTask: (
    nodeId: string,
    patch: Partial<WizardHermesTaskDraft>,
  ) => void
  onAddNode: (type: NodeType) => void
  onRemoveNode: (nodeId: string) => void
}

export function ConfigureStep({
  nodes,
  selectedNodeId,
  onSelectNode,
  onUpdateNode,
  onUpdateHermesTask,
  onAddNode,
  onRemoveNode,
}: ConfigureStepProps) {
  const selectedNode =
    nodes.find((node) => node.id === selectedNodeId) ??
    (nodes.length > 0 ? nodes[0] : null)

  return (
    <div className="wz-config">
      <div className="wz-config-list">
        <div className="wz-config-toolbar">
          <div>
            <div className="pc-head">Nodes</div>
            <div className="route-note">
              Edit node type, order dependencies, phase, and Hermes task hints.
            </div>
          </div>
          <div className="wz-config-add">
            {NODE_TYPE_OPTIONS.map((type) => (
              <button
                key={type}
                className="btn-mini"
                type="button"
                onClick={() => onAddNode(type)}
              >
                + {type}
              </button>
            ))}
          </div>
        </div>

        <div className="wz-config-cards">
          {nodes.map((node) => {
            const selected = selectedNode?.id === node.id
            const nodeColor = colorFor(node.type)
            return (
              <button
                key={node.id}
                type="button"
                className={`wz-node-card ${selected ? 'sel' : ''}`}
                onClick={() => onSelectNode(node.id)}
              >
                <div className="wz-node-card-row">
                  <span className="wz-node-card-id">{node.id}</span>
                  <span
                    className="wz-node-card-type"
                    style={{ color: nodeColor, borderColor: `${nodeColor}55` }}
                  >
                    {node.type}
                  </span>
                </div>
                <div className="wz-node-card-meta">
                  <span>{node.phase.trim() || 'No phase'}</span>
                  <span>{node.depends_on.length} deps</span>
                  <span>
                    {node.hermes_task_enabled ? 'Hermes task' : 'Local node'}
                  </span>
                </div>
              </button>
            )
          })}
          {nodes.length === 0 && (
            <div className="wz-empty-config">
              No nodes yet. Add one from the toolbar or go back to Describe to
              scaffold a flow.
            </div>
          )}
        </div>
      </div>

      <div className="wz-config-editor">
        {selectedNode ? (
          <>
            <div className="wz-config-editor-head">
              <div>
                <div className="pc-head">Configure node</div>
                <div className="route-note">
                  Changes here regenerate the workflow YAML immediately.
                </div>
              </div>
              <button
                className="btn-mini"
                type="button"
                onClick={() => onRemoveNode(selectedNode.id)}
              >
                Remove node
              </button>
            </div>

            <div className="wz-config-grid">
              <label className="wz-field">
                <span>ID</span>
                <input
                  className="wfrd-input"
                  value={selectedNode.id}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, {
                      id: slugify(e.target.value) || selectedNode.id,
                    })
                  }
                />
              </label>
              <label className="wz-field">
                <span>Type</span>
                <select
                  className="wfrd-select"
                  value={selectedNode.type}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, {
                      type: e.target.value as NodeType,
                    })
                  }
                >
                  {NODE_TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wz-field">
                <span>Phase</span>
                <input
                  className="wfrd-input"
                  value={selectedNode.phase}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, { phase: e.target.value })
                  }
                  placeholder="Plan / Execute / Verify"
                />
              </label>
              <label className="wz-field">
                <span>Depends on</span>
                <input
                  className="wfrd-input"
                  value={selectedNode.depends_on.join(', ')}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, {
                      depends_on: splitCsv(e.target.value),
                    })
                  }
                  placeholder="analyze, plan"
                />
              </label>
              <label className="wz-field wz-field-full">
                <span>Node skills</span>
                <input
                  className="wfrd-input"
                  value={selectedNode.skills}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, { skills: e.target.value })
                  }
                  placeholder="planning, testing"
                />
              </label>
            </div>

            {selectedNode.type === 'prompt' && (
              <label className="wz-field wz-field-full">
                <span>Prompt</span>
                <textarea
                  className="wfrd-yaml"
                  rows={8}
                  value={selectedNode.prompt}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, { prompt: e.target.value })
                  }
                />
              </label>
            )}

            {selectedNode.type === 'command' && (
              <label className="wz-field wz-field-full">
                <span>Command</span>
                <input
                  className="wfrd-input"
                  value={selectedNode.command}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, { command: e.target.value })
                  }
                  placeholder="archon-smart-pr-review"
                />
              </label>
            )}

            {selectedNode.type === 'bash' && (
              <label className="wz-field wz-field-full">
                <span>Bash</span>
                <textarea
                  className="wfrd-yaml"
                  rows={8}
                  value={selectedNode.bash}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, { bash: e.target.value })
                  }
                />
              </label>
            )}

            {selectedNode.type === 'script' && (
              <>
                <label className="wz-field">
                  <span>Runtime</span>
                  <select
                    className="wfrd-select"
                    value={selectedNode.runtime}
                    onChange={(e) =>
                      onUpdateNode(selectedNode.id, { runtime: e.target.value })
                    }
                  >
                    <option value="bun">bun</option>
                    <option value="uv">uv</option>
                  </select>
                </label>
                <label className="wz-field wz-field-full">
                  <span>Script</span>
                  <textarea
                    className="wfrd-yaml"
                    rows={8}
                    value={selectedNode.script}
                    onChange={(e) =>
                      onUpdateNode(selectedNode.id, { script: e.target.value })
                    }
                  />
                </label>
              </>
            )}

            {selectedNode.type === 'approval' && (
              <>
                <label className="wz-field wz-field-full">
                  <span>Approval message</span>
                  <textarea
                    className="wfrd-yaml"
                    rows={5}
                    value={selectedNode.approval_message}
                    onChange={(e) =>
                      onUpdateNode(selectedNode.id, {
                        approval_message: e.target.value,
                      })
                    }
                  />
                </label>
                <label className="wz-check">
                  <input
                    type="checkbox"
                    checked={selectedNode.approval_capture_response}
                    onChange={(e) =>
                      onUpdateNode(selectedNode.id, {
                        approval_capture_response: e.target.checked,
                      })
                    }
                  />
                  Capture reviewer response
                </label>
              </>
            )}

            {selectedNode.type === 'loop' && (
              <>
                <label className="wz-field wz-field-full">
                  <span>Loop prompt</span>
                  <textarea
                    className="wfrd-yaml"
                    rows={6}
                    value={selectedNode.loop_prompt}
                    onChange={(e) =>
                      onUpdateNode(selectedNode.id, {
                        loop_prompt: e.target.value,
                      })
                    }
                  />
                </label>
                <div className="wz-config-grid">
                  <label className="wz-field">
                    <span>Until signal</span>
                    <input
                      className="wfrd-input"
                      value={selectedNode.loop_until}
                      onChange={(e) =>
                        onUpdateNode(selectedNode.id, {
                          loop_until: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="wz-field">
                    <span>Max iterations</span>
                    <input
                      className="wfrd-input"
                      type="number"
                      min={1}
                      value={selectedNode.loop_max_iterations}
                      onChange={(e) =>
                        onUpdateNode(selectedNode.id, {
                          loop_max_iterations: Number(e.target.value) || 1,
                        })
                      }
                    />
                  </label>
                </div>
              </>
            )}

            {selectedNode.type === 'cancel' && (
              <label className="wz-field wz-field-full">
                <span>Cancel reason</span>
                <input
                  className="wfrd-input"
                  value={selectedNode.cancel}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, { cancel: e.target.value })
                  }
                />
              </label>
            )}

            <div className="wz-hermes-box">
              <label className="wz-check">
                <input
                  type="checkbox"
                  checked={selectedNode.hermes_task_enabled}
                  onChange={(e) =>
                    onUpdateNode(selectedNode.id, {
                      hermes_task_enabled: e.target.checked,
                    })
                  }
                />
                Hermes task-backed node
              </label>

              {selectedNode.hermes_task_enabled && (
                <div className="wz-config-grid">
                  <label className="wz-field wz-field-full">
                    <span>Hermes task skills</span>
                    <input
                      className="wfrd-input"
                      value={selectedNode.hermes_task.skills}
                      onChange={(e) =>
                        onUpdateHermesTask(selectedNode.id, {
                          skills: e.target.value,
                        })
                      }
                      placeholder="testing, planning"
                    />
                  </label>
                  <label className="wz-field">
                    <span>Agent hint</span>
                    <input
                      className="wfrd-input"
                      value={selectedNode.hermes_task.agent_hint}
                      onChange={(e) =>
                        onUpdateHermesTask(selectedNode.id, {
                          agent_hint: e.target.value,
                        })
                      }
                      placeholder="trinity"
                    />
                  </label>
                  <label className="wz-field">
                    <span>Model hint</span>
                    <input
                      className="wfrd-input"
                      value={selectedNode.hermes_task.model_hint}
                      onChange={(e) =>
                        onUpdateHermesTask(selectedNode.id, {
                          model_hint: e.target.value,
                        })
                      }
                      placeholder="claude-sonnet-4"
                    />
                  </label>
                  {(typeof selectedNode.raw['provider'] === 'string' ||
                    typeof selectedNode.raw['model'] === 'string') && (
                    <div className="wz-field wz-field-full">
                      <span>Legacy contract</span>
                      <div className="text-xs text-[var(--theme-muted)]">
                        Deprecated YAML keys remain readable here but are no
                        longer authored by SwitchUI.
                        {typeof selectedNode.raw['provider'] === 'string' &&
                          ` provider=${selectedNode.raw['provider']}`}
                        {typeof selectedNode.raw['model'] === 'string' &&
                          ` model=${selectedNode.raw['model']}`}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="wz-empty-config">No configurable node selected.</div>
        )}
      </div>
    </div>
  )
}
