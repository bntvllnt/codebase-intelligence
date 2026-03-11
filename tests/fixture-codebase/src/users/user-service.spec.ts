import { describe, it, expect } from "vitest";
import { UserService } from "./user-service.js";

describe("UserService", () => {
  it("should create an instance", () => {
    const service = new UserService();
    expect(service).toBeDefined();
  });
});
