export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export type UserRole = "admin" | "user" | "guest";

export interface CreateUserInput {
  email: string;
  name: string;
  role?: UserRole;
}
