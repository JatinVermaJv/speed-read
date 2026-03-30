import "hono";

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    userEmail: string;
    isAdmin: boolean;
  }
}

export {};
