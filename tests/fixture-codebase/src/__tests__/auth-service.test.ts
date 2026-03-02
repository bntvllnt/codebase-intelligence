import { describe, it, expect } from "vitest";
import { AuthService } from "../auth/auth-service.js";

describe("AuthService", () => {
  it("should create an instance", () => {
    const service = new AuthService();
    expect(service).toBeDefined();
  });
});
