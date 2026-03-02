import type { User, CreateUserInput } from "./user-types.js";
import { log } from "../utils/logger.js";

const users: Map<string, User> = new Map();

export function getUserById(id: string): User | undefined {
  log("repository", `Getting user ${id}`);
  return users.get(id);
}

export function getAllUsers(): User[] {
  log("repository", "Getting all users");
  return Array.from(users.values());
}

export function createUser(input: CreateUserInput): User {
  const user: User = {
    id: crypto.randomUUID(),
    email: input.email,
    name: input.name,
    role: input.role ?? "user",
  };
  users.set(user.id, user);
  log("repository", `Created user ${user.id}`);
  return user;
}

export function deleteUser(id: string): boolean {
  log("repository", `Deleting user ${id}`);
  return users.delete(id);
}
