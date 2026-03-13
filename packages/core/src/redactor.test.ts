import { describe, it, expect } from "vitest";
import { redact, contentHash } from "./redactor.js";

describe("redact", () => {
  it("returns object unchanged when no fields specified", () => {
    const obj = { payload: { content: "secret", length: 6 } };
    const result = redact(obj, { mode: "omit", fields: [] });
    expect(result).toEqual(obj);
  });

  it("omits top-level fields", () => {
    const obj = { a: "visible", b: "secret" };
    const result = redact(obj, { mode: "omit", fields: ["b"] });
    expect(result).not.toHaveProperty("b");
    expect(result.a).toBe("visible");
  });

  it("omits nested fields via dot-notation", () => {
    const obj = { payload: { content: "hello", length: 5 } };
    const result = redact(obj, { mode: "omit", fields: ["payload.content"] });
    expect((result.payload as Record<string, unknown>).content).toBeUndefined();
    expect((result.payload as Record<string, unknown>).length).toBe(5);
  });

  it("hashes nested fields", () => {
    const obj = { payload: { content: "secret" } };
    const result = redact(obj, { mode: "hash", fields: ["payload.content"] });
    const hashed = (result.payload as Record<string, unknown>).content as string;
    expect(hashed).toHaveLength(64); // SHA-256 hex
    expect(hashed).not.toBe("secret");
  });

  it("produces same hash for same value (deterministic)", () => {
    const obj1 = { payload: { content: "same" } };
    const obj2 = { payload: { content: "same" } };
    const r1 = redact(obj1, { mode: "hash", fields: ["payload.content"] });
    const r2 = redact(obj2, { mode: "hash", fields: ["payload.content"] });
    expect((r1.payload as Record<string, unknown>).content).toBe(
      (r2.payload as Record<string, unknown>).content,
    );
  });

  it("truncates long fields", () => {
    const obj = { payload: { content: "a".repeat(100) } };
    const result = redact(obj, { mode: "truncate", fields: ["payload.content"], truncateLength: 10 });
    const truncated = (result.payload as Record<string, unknown>).content as string;
    expect(truncated).toBe("aaaaaaaaaa…");
    expect(truncated.length).toBeLessThan(20);
  });

  it("does not truncate short fields below threshold", () => {
    const obj = { payload: { content: "short" } };
    const result = redact(obj, { mode: "truncate", fields: ["payload.content"], truncateLength: 10 });
    expect((result.payload as Record<string, unknown>).content).toBe("short");
  });

  it("does not mutate the original object", () => {
    const obj = { payload: { content: "original" } };
    redact(obj, { mode: "omit", fields: ["payload.content"] });
    expect(obj.payload.content).toBe("original");
  });

  it("ignores paths that do not exist in object", () => {
    const obj = { payload: { length: 5 } };
    // Should not throw
    const result = redact(obj, { mode: "omit", fields: ["payload.nonexistent"] });
    expect(result).toEqual(obj);
  });

  it("metadata_only pattern: preserves contentLength but hashes content", () => {
    const rawContent = "This is a user message";
    const obj = {
      payload: {
        content: rawContent,
        contentLength: rawContent.length,
      },
    };
    const result = redact(obj, { mode: "hash", fields: ["payload.content"] });
    const p = result.payload as Record<string, unknown>;
    expect(p.contentLength).toBe(rawContent.length);
    expect(p.content).toHaveLength(64);
  });
});

describe("contentHash", () => {
  it("returns a 64-char hex string", () => {
    expect(contentHash("test")).toHaveLength(64);
  });

  it("is deterministic", () => {
    expect(contentHash("hello")).toBe(contentHash("hello"));
  });

  it("differs for different inputs", () => {
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });
});
