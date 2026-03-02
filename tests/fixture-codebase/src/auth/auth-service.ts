import { UserService } from "../users/user-service.js";
import { log, logError } from "../utils/logger.js";
import { validateNotEmpty } from "../utils/validators.js";
import type { User } from "../users/user-types.js";

export interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
}

export interface Session {
  userId: string;
  token: string;
  expiresAt: Date;
}

const sessions: Map<string, Session> = new Map();

export class AuthService {
  private userService: UserService;

  constructor() {
    this.userService = new UserService();
  }

  login(email: string, password: string): AuthResult {
    log("auth", `AuthService.login(${email})`);
    if (!validateNotEmpty(email) || !validateNotEmpty(password)) {
      return { success: false, error: "Email and password required" };
    }

    const users = this.userService.listUsers();
    const user = users.find((u) => u.email === email);

    if (!user) {
      logError("auth", new Error("User not found"));
      return { success: false, error: "Invalid credentials" };
    }

    const session = this.createSession(user.id);
    sessions.set(session.token, session);
    log("auth", `Login successful for ${user.id}`);
    return { success: true, user };
  }

  validate(token: string): User | undefined {
    log("auth", "AuthService.validate()");
    const session = sessions.get(token);
    if (!session || session.expiresAt < new Date()) {
      return undefined;
    }
    return this.userService.getUserById(session.userId);
  }

  logout(token: string): void {
    log("auth", "AuthService.logout()");
    sessions.delete(token);
  }

  private createSession(userId: string): Session {
    return {
      userId,
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 3600000),
    };
  }
}
