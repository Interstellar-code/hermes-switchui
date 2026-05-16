import { describe, it, expect } from "vitest";
import { execFileAsync, getDefaultBranch, toRepoPath } from "./git.js";

describe("git stub", () => {
  it("execFileAsync('git', ['--version']) returns non-empty stdout", async () => {
    const { stdout } = await execFileAsync("git", ["--version"]);
    expect(stdout.trim().length).toBeGreaterThan(0);
    expect(stdout).toContain("git");
  });

  it("getDefaultBranch returns 'main'", async () => {
    const branch = await getDefaultBranch("/tmp");
    expect(branch).toBe("main");
  });

  it("toRepoPath is identity", () => {
    expect(toRepoPath("/some/path")).toBe("/some/path");
  });
});
