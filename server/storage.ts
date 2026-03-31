/**
 * storage.ts — MongoDB-only user persistence layer.
 *
 * This module provides user CRUD operations backed exclusively by MongoDB.
 * There are NO in-memory Maps or in-process caches here. Every call hits MongoDB.
 *
 * Note: The `sharedSessions` Map in routes.ts is a separate write-through cache
 * for session share state — it is always persisted to MongoDB on write and loaded
 * from MongoDB on server startup. It is NOT part of this module.
 */
import { type User, type InsertUser } from "@shared/schema";
import { randomUUID } from "crypto";
import { getCollection } from "./db/mongo";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
}

export class MongoUserRepository implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const col = await getCollection<User>("users");
    if (!col) throw new Error("[MongoUserRepository] MongoDB not available — MONGODB_URI must be set");
    const doc = await (col as any).findOne({ id }, { projection: { _id: 0 } });
    return doc ?? undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const col = await getCollection<User>("users");
    if (!col) throw new Error("[MongoUserRepository] MongoDB not available — MONGODB_URI must be set");
    const doc = await (col as any).findOne({ username }, { projection: { _id: 0 } });
    return doc ?? undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const col = await getCollection<User>("users");
    if (!col) throw new Error("[MongoUserRepository] MongoDB not available — MONGODB_URI must be set");
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    await (col as any).insertOne({ ...user });
    return user;
  }
}

export const storage = new MongoUserRepository();
