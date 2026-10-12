import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";

type AuditLogInput = {
  actorId: ObjectId;
  action: string;
  entityType: string;
  entityId: ObjectId;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

export async function writeAuditLog(input: AuditLogInput) {
  const db = await getDatabase();

  await db.collection("audit_logs").insertOne({
    ...input,
    createdAt: new Date(),
  });
}