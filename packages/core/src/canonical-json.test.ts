import { describe, it, expect } from "vitest";
import { canonicalJson } from "./canonical-json.js";

describe("canonicalJson", () => {
  it("serializes primitives", () => {
    expect(canonicalJson(1)).toBe("1");
    expect(canonicalJson("hello")).toBe('"hello"');
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
  });

  it("sorts object keys alphabetically", () => {
    const result = canonicalJson({ b: 2, a: 1 });
    expect(result).toBe('{"a":1,"b":2}');
  });

  it("sorts keys recursively in nested objects", () => {
    const result = canonicalJson({ z: { y: 1, x: 2 }, a: 3 });
    expect(result).toBe('{"a":3,"z":{"x":2,"y":1}}');
  });

  it("produces same output regardless of insertion order", () => {
    const obj1 = { type: "test", seq: 1, hash: "abc", prevHash: "000" };
    const obj2 = { hash: "abc", type: "test", prevHash: "000", seq: 1 };
    expect(canonicalJson(obj1)).toBe(canonicalJson(obj2));
  });

  it("handles arrays without reordering elements", () => {
    const result = canonicalJson([3, 1, 2]);
    expect(result).toBe("[3,1,2]");
  });

  it("handles arrays of objects with sorted keys", () => {
    const result = canonicalJson([{ b: 2, a: 1 }]);
    expect(result).toBe('[{"a":1,"b":2}]');
  });

  it("handles null values within objects", () => {
    const result = canonicalJson({ b: null, a: 1 });
    expect(result).toBe('{"a":1,"b":null}');
  });

  it("produces deterministic hashes for AuditEvent-shaped objects", () => {
    const event = {
      seq: 0,
      prevHash: "0".repeat(64),
      type: "session_start",
      timestamp: "2026-03-13T00:00:00.000Z",
      payload: { sessionId: "s1", sessionKey: "k1" },
    };
    // Shuffle field order
    const shuffled = {
      payload: event.payload,
      timestamp: event.timestamp,
      type: event.type,
      seq: event.seq,
      prevHash: event.prevHash,
    };
    expect(canonicalJson(event)).toBe(canonicalJson(shuffled));
  });
});
