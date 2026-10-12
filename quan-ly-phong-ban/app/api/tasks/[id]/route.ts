import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";

type UpdateTaskInput = {
  status?: string;
  progress?: number;
};

type RouteContext = {
  params: Promise<{ id: string }>;
};

const allowedStatuses = ["TODO", "IN_PROGRESS", "DONE"];

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return Response.json(
        { message: "Chưa đăng nhập" },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    if (!ObjectId.isValid(id)) {
      return Response.json(
        { message: "ID công việc không hợp lệ" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const collection = db.collection("tasks");
    const taskObjectId = new ObjectId(id);
    const task = await collection.findOne({ _id: taskObjectId });

    if (!task) {
      return Response.json(
        { message: "Không tìm thấy công việc" },
        { status: 404 }
      );
    }

    if (
      !(task.assigneeId instanceof ObjectId) ||
      !task.assigneeId.equals(currentUser._id)
    ) {
      return Response.json(
        { message: "Bạn không phải người được giao công việc này" },
        { status: 403 }
      );
    }

    const body = (await request.json()) as UpdateTaskInput;

    if (body.status === undefined && body.progress === undefined) {
      return Response.json(
        { message: "Cần nhập status hoặc progress" },
        { status: 400 }
      );
    }

    if (
      body.status !== undefined &&
      !allowedStatuses.includes(body.status)
    ) {
      return Response.json(
        { message: "status phải là TODO, IN_PROGRESS hoặc DONE" },
        { status: 400 }
      );
    }

    if (
      body.progress !== undefined &&
      (!Number.isInteger(body.progress) ||
        body.progress < 0 ||
        body.progress > 100)
    ) {
      return Response.json(
        { message: "progress phải là số nguyên từ 0 đến 100" },
        { status: 400 }
      );
    }

    const newStatus = body.status ?? task.status;
    const newProgress = body.progress ?? task.progress;

    if (
      (newStatus === "TODO" && newProgress !== 0) ||
      (newStatus === "IN_PROGRESS" &&
        (newProgress <= 0 || newProgress >= 100)) ||
      (newStatus === "DONE" && newProgress !== 100)
    ) {
      return Response.json(
        { message: "Trạng thái và phần trăm hoàn thành chưa khớp" },
        { status: 400 }
      );
    }

    const result = await collection.findOneAndUpdate(
      { _id: taskObjectId, assigneeId: currentUser._id },
      {
        $set: {
          status: newStatus,
          progress: newProgress,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );
    if (!result) {
  return Response.json(
    { message: "Không thể cập nhật công việc" },
    { status: 409 }
  );
}

try {
  await writeAuditLog({
    actorId: currentUser._id,
    action: "TASK_PROGRESS_UPDATED",
    entityType: "TASK",
    entityId: taskObjectId,
    before: {
      status: task.status,
      progress: task.progress,
    },
    after: {
      status: result.status,
      progress: result.progress,
    },
  });
} catch (error) {
  console.error("Không thể ghi Audit Log công việc:", error);
}

    return Response.json({
      message: "Cập nhật tiến độ thành công",
      task: result,
    });
  } catch (error) {
    console.error("PATCH task error:", error);

    return Response.json(
      { message: "Không thể cập nhật công việc" },
      { status: 500 }
    );
  }
}