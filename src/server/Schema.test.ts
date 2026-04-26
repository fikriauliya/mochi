import { describe, expect, test } from "bun:test";
import { Either, Schema as S } from "effect";
import {
  App,
  AppStatus,
  BuildEvent,
  CreateAppRequest,
  Manifest,
} from "./Schema";

const isOk = <A>(e: Either.Either<A, unknown>) => Either.isRight(e);
const isErr = <A>(e: Either.Either<A, unknown>) => Either.isLeft(e);

describe("AppStatus", () => {
  const decode = S.decodeUnknownEither(AppStatus);
  test.each(["building", "ready", "error"])("accepts %s", (s) => {
    expect(isOk(decode(s))).toBe(true);
  });
  test("rejects unknown literal", () => {
    expect(isErr(decode("running"))).toBe(true);
  });
});

describe("App", () => {
  const decode = S.decodeUnknownEither(App);
  const valid = {
    id: "x-1234",
    sessionId: "session-uuid",
    kind: "app",
    name: "X",
    emoji: "🍡",
    description: "hi",
    prompt: "make x",
    status: "ready",
    createdAt: 1,
    updatedAt: 2,
  };
  test("decodes without lastError", () => {
    expect(isOk(decode(valid))).toBe(true);
  });
  test("decodes with lastError", () => {
    expect(isOk(decode({ ...valid, lastError: "oops" }))).toBe(true);
  });
  test("rejects bad status", () => {
    expect(isErr(decode({ ...valid, status: "wat" }))).toBe(true);
  });
  test("rejects missing required field", () => {
    const { id: _omitted, ...rest } = valid;
    void _omitted;
    expect(isErr(decode(rest))).toBe(true);
  });
});

describe("CreateAppRequest", () => {
  const decode = S.decodeUnknownEither(CreateAppRequest);
  test("accepts a sensible prompt", () => {
    expect(isOk(decode({ prompt: "hi" }))).toBe(true);
  });
  test("rejects empty prompt", () => {
    expect(isErr(decode({ prompt: "" }))).toBe(true);
  });
  test("rejects >2000 chars", () => {
    expect(isErr(decode({ prompt: "x".repeat(2001) }))).toBe(true);
  });
  test("accepts exactly 2000 chars", () => {
    expect(isOk(decode({ prompt: "x".repeat(2000) }))).toBe(true);
  });
});

describe("Manifest", () => {
  const decode = S.decodeUnknownEither(Manifest);
  const valid = { name: "Game", emoji: "🎮", description: "fun" };
  test("accepts valid", () => {
    expect(isOk(decode(valid))).toBe(true);
  });
  test("rejects empty name", () => {
    expect(isErr(decode({ ...valid, name: "" }))).toBe(true);
  });
  test("rejects empty emoji", () => {
    expect(isErr(decode({ ...valid, emoji: "" }))).toBe(true);
  });
  test("rejects too-long name", () => {
    expect(isErr(decode({ ...valid, name: "x".repeat(61) }))).toBe(true);
  });
  test("rejects too-long emoji", () => {
    expect(isErr(decode({ ...valid, emoji: "x".repeat(9) }))).toBe(true);
  });
  test("accepts empty description (under 280)", () => {
    expect(isOk(decode({ ...valid, description: "" }))).toBe(true);
  });
  test("rejects too-long description", () => {
    expect(isErr(decode({ ...valid, description: "x".repeat(281) }))).toBe(true);
  });
});

describe("BuildEvent", () => {
  const decode = S.decodeUnknownEither(BuildEvent);
  test("decodes status with t", () => {
    expect(isOk(decode({ type: "status", message: "hi", t: 5 }))).toBe(true);
  });
  test("decodes status without t (t is optional)", () => {
    expect(isOk(decode({ type: "status", message: "hi" }))).toBe(true);
  });
  test("decodes text", () => {
    expect(isOk(decode({ type: "text", text: "hi" }))).toBe(true);
  });
  test("decodes tool", () => {
    expect(isOk(decode({ type: "tool", tool: "Write", summary: "f.tsx" }))).toBe(true);
  });
  test("decodes tool_result", () => {
    expect(isOk(decode({ type: "tool_result", tool: "Write", ok: true, summary: "ok" }))).toBe(true);
  });
  test("decodes done bare", () => {
    expect(isOk(decode({ type: "done" }))).toBe(true);
  });
  test("decodes error", () => {
    expect(isOk(decode({ type: "error", message: "boom" }))).toBe(true);
  });
  test("decodes raw", () => {
    expect(isOk(decode({ type: "raw", json: '{"x":1}' }))).toBe(true);
  });
  test("rejects unknown type", () => {
    expect(isErr(decode({ type: "weird" }))).toBe(true);
  });
});
