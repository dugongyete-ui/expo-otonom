import { z } from "zod";
import { randomUUID } from "crypto";

export interface User {
  id: string;
  username: string;
  password: string;
}

export type InsertUser = Omit<User, "id">;

export const insertUserSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
