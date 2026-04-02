import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = (process.env.DATABASE_URL ?? "").trim();

if (!connectionString) {
	throw new Error("DATABASE_URL is required (see api/.env.example).");
}

const client = postgres(connectionString);
export const db = drizzle(client, { schema });
