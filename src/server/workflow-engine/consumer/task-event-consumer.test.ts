import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaskEventConsumer, mapTerminalStatus } from "./task-event-consumer";
import type { SwitchUiWorkflowStore } from "../store/workflow-store";
import type { HermesKanbanStatus, HermesKanbanTaskDetail } from "../../../lib/hermes-kanban-types";

function stubStore(): SwitchUiWorkflowStore {
  return {
    heartbeatWorkflowRun: vi.fn().mockResolvedValue(1),
    updateNodeRun: vi.fn().mockResolvedValue(undefined),
    appendWorkflowEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as SwitchUiWorkflowStore;
}

function task(status: HermesKanbanStatus, body = "result text"): HermesKanbanTaskDetail {
  return {
    task: { id: "k-1", status, body },
    comments: [],
    events: [],
    links: { parents: [], children: [] },
    runs: [],
  } as unknown as HermesKanbanTaskDetail;
}

describe("TaskEventConsumer", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("track + size reflects in-flight dispatches", () => {
    const consumer = new TaskEventConsumer({ store: stubStore(), fetchTask: vi.fn() });
    consumer.track({ kanbanTaskId: "k-1", nodeRunId: "n-1", workflowRunId: "w-1" });
    consumer.track({ kanbanTaskId: "k-2", nodeRunId: "n-2", workflowRunId: "w-1" });
    expect(consumer.size()).toBe(2);
    consumer.untrack("k-1");
    expect(consumer.size()).toBe(1);
  });

  it("resolves a tracked task when Kanban status flips to 'done'", async () => {
    const store = stubStore();
    const onResolved = vi.fn();
    const fetchTask = vi.fn().mockResolvedValue(task("done", "the result"));
    const consumer = new TaskEventConsumer({ store, fetchTask, onResolved });

    consumer.track({ kanbanTaskId: "k-1", nodeRunId: "n-1", workflowRunId: "w-1" });
    await consumer.tick();

    expect(store.updateNodeRun).toHaveBeenCalledWith(
      "n-1",
      expect.objectContaining({ status: "completed", summary: "the result" }),
    );
    expect(store.appendWorkflowEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "node_completed", node_run_id: "n-1" }),
    );
    expect(onResolved).toHaveBeenCalledWith("n-1", "completed");
    expect(consumer.size()).toBe(0);
  });

  it("flips to 'paused' on blocked, keeps tracking", async () => {
    const store = stubStore();
    const fetchTask = vi.fn().mockResolvedValue(task("blocked"));
    const consumer = new TaskEventConsumer({ store, fetchTask });
    consumer.track({ kanbanTaskId: "k-1", nodeRunId: "n-1", workflowRunId: "w-1" });
    await consumer.tick();
    expect(store.updateNodeRun).toHaveBeenCalledWith("n-1", expect.objectContaining({ status: "paused" }));
    expect(consumer.size()).toBe(0); // paused is terminal-for-tracking
  });

  it("leaves in-flight statuses (running/ready/etc.) untouched", async () => {
    const store = stubStore();
    const fetchTask = vi.fn().mockResolvedValue(task("running"));
    const consumer = new TaskEventConsumer({ store, fetchTask });
    consumer.track({ kanbanTaskId: "k-1", nodeRunId: "n-1", workflowRunId: "w-1" });
    await consumer.tick();
    expect(store.updateNodeRun).not.toHaveBeenCalled();
    expect(consumer.size()).toBe(1);
  });

  it("transient fetch failures don't drop the entry", async () => {
    const store = stubStore();
    const fetchTask = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(task("done"));
    const consumer = new TaskEventConsumer({ store, fetchTask });
    consumer.track({ kanbanTaskId: "k-1", nodeRunId: "n-1", workflowRunId: "w-1" });
    await consumer.tick();
    expect(consumer.size()).toBe(1); // still tracked after error
    await consumer.tick();
    expect(consumer.size()).toBe(0); // resolved on retry
  });

  it("start/stop wire setInterval", () => {
    const consumer = new TaskEventConsumer({ store: stubStore(), fetchTask: vi.fn() });
    consumer.start();
    consumer.start(); // idempotent
    consumer.stop();
    consumer.stop(); // idempotent
  });
});

describe("mapTerminalStatus", () => {
  it("maps Kanban terminal statuses correctly", () => {
    expect(mapTerminalStatus("done")).toBe("completed");
    expect(mapTerminalStatus("blocked")).toBe("paused");
    expect(mapTerminalStatus("archived")).toBe("cancelled");
    expect(mapTerminalStatus("running")).toBeNull();
    expect(mapTerminalStatus("ready")).toBeNull();
    expect(mapTerminalStatus("todo")).toBeNull();
    expect(mapTerminalStatus("triage")).toBeNull();
  });
});
