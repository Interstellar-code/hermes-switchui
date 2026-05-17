import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_IS_BINARY,
  BUNDLED_VERSION,
  createLogger,
  getArchonHome,
  getHomeScriptsPath,
  getUnregisteredLogsPath,
  getUnregisteredRunArtifactsPath,
  parseOwnerRepo,
} from "./paths.js";

describe("paths stub", () => {
  it("getArchonHome() creates directory without throwing", () => {
    const home = getArchonHome();
    expect(typeof home).toBe("string");
    expect(home.length).toBeGreaterThan(0);
    expect(existsSync(home)).toBe(true);
  });

  it("getHomeScriptsPath() creates directory without throwing", () => {
    const p = getHomeScriptsPath();
    expect(typeof p).toBe("string");
    expect(existsSync(p)).toBe(true);
  });

  it("createLogger returns a logger with expected methods", () => {
    const log = createLogger("test");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
    expect(typeof log.debug).toBe("function");
  });

  it("BUNDLED_IS_BINARY is false in dev mode", () => {
    expect(BUNDLED_IS_BINARY).toBe(false);
  });

  it("BUNDLED_VERSION is a string", () => {
    expect(typeof BUNDLED_VERSION).toBe("string");
  });

  it("parseOwnerRepo splits owner/repo correctly", () => {
    expect(parseOwnerRepo("acme/my-repo")).toEqual({ owner: "acme", repo: "my-repo" });
    expect(parseOwnerRepo("bare-repo")).toEqual({ owner: "", repo: "bare-repo" });
  });

  it("uses app-owned storage for unregistered workflow runtime output", () => {
    expect(getUnregisteredRunArtifactsPath("run-1")).toContain("/.hermes/switchui/runs/unregistered/run-1/artifacts");
    expect(getUnregisteredLogsPath()).toContain("/.hermes/switchui/runs/unregistered/logs");
    expect(getUnregisteredRunArtifactsPath("run-1")).not.toContain("/.archon/");
    expect(getUnregisteredLogsPath()).not.toContain("/.archon/");
  });
});
