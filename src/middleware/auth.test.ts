import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { requireAuth } from "./auth";

describe("requireAuth middleware", () => {
  const token = "valid-token";
  const env = { IDEA_EXPLORER_API_TOKEN: token };

  beforeAll(() => {
    if (!global.crypto.subtle) {
      Object.defineProperty(global.crypto, "subtle", {
        value: {},
        writable: true,
      });
    }
    if (!global.crypto.subtle.timingSafeEqual) {
      global.crypto.subtle.timingSafeEqual = (
        a: BufferSource,
        b: BufferSource
      ) => {
        const bufA = new Uint8Array(a as ArrayBuffer);
        const bufB = new Uint8Array(b as ArrayBuffer);
        if (bufA.length !== bufB.length) return false;
        for (let i = 0; i < bufA.length; i++) {
          if (bufA[i] !== bufB[i]) return false;
        }
        return true;
      };
    }
  });

  it("should allow request with valid token", async () => {
    const app = new Hono<{ Bindings: typeof env }>();
    app.use("/protected", requireAuth());
    app.get("/protected", (c) => c.json({ message: "success" }));

    const res = await app.request(
      "/protected",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      env
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "success" });
  });

  it("should reject missing Authorization header", async () => {
    const app = new Hono<{ Bindings: typeof env }>();
    app.use("/protected", requireAuth());
    app.get("/protected", (c) => c.json({ message: "success" }));

    const res = await app.request("/protected", {}, env);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Unauthorized: Missing Authorization header",
    });
  });

  it("should reject invalid Authorization header format", async () => {
    const app = new Hono<{ Bindings: typeof env }>();
    app.use("/protected", requireAuth());
    app.get("/protected", (c) => c.json({ message: "success" }));

    const res = await app.request(
      "/protected",
      {
        headers: {
          Authorization: `Basic ${token}`,
        },
      },
      env
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Unauthorized: Invalid Authorization header format",
    });
  });

  it("should reject invalid token", async () => {
    const app = new Hono<{ Bindings: typeof env }>();
    app.use("/protected", requireAuth());
    app.get("/protected", (c) => c.json({ message: "success" }));

    const res = await app.request(
      "/protected",
      {
        headers: {
          Authorization: "Bearer invalid-token",
        },
      },
      env
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized: Invalid token" });
  });

  it("should reject token with different length", async () => {
    const app = new Hono<{ Bindings: typeof env }>();
    app.use("/protected", requireAuth());
    app.get("/protected", (c) => c.json({ message: "success" }));

    const res = await app.request(
      "/protected",
      {
        headers: {
          Authorization: "Bearer short",
        },
      },
      env
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized: Invalid token" });
  });
});
