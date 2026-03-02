import type { User, CreateUserInput } from "./user-types.js";
import { getUserById, createUser, getAllUsers } from "./user-repository.js";
import { log } from "../utils/logger.js";
import { validateEmail, validateNotEmpty } from "../utils/validators.js";

export class UserService {
  getUserById(id: string): User | undefined {
    log("service", `UserService.getUserById(${id})`);
    return getUserById(id);
  }

  createUser(input: CreateUserInput): User {
    log("service", `UserService.createUser(${input.email})`);
    if (!validateEmail(input.email)) {
      throw new Error(`Invalid email: ${input.email}`);
    }
    return createUser(input);
  }

  listUsers(nameFilter?: string): User[] {
    log("service", "UserService.listUsers()");
    const users = getAllUsers();
    if (nameFilter) {
      return users.filter((u) => validateNotEmpty(u.name));
    }
    return users;
  }
}
