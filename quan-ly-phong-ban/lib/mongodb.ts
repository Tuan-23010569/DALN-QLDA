import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

if (!uri) {
  throw new Error("Thiếu MONGODB_URI trong .env.local");
}

if (!dbName) {
  throw new Error("Thiếu MONGODB_DB trong .env.local");
}

const client = new MongoClient(uri);

export async function getDatabase() {
  await client.connect();
  return client.db(dbName);
}

export async function getMongoClient() {
  await client.connect();
  return client;
}