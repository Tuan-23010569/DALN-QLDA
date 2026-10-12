import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";

type CreateNotificationInput = {
  userId: ObjectId;
  title: string;
  message: string;
  type: "TASK_ASSIGNED" | "LEAVE_REVIEWED" | "KPI_REVIEWED";
  referenceId: ObjectId;
};

export async function createNotification(input: CreateNotificationInput) {
  const db = await getDatabase();

  return db.collection("notifications").insertOne({
    ...input,
    isRead: false,
    createdAt: new Date(),
    readAt: null,
  });
}