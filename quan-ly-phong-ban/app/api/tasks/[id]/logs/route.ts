import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function isValidWorkDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

// Thêm nhật ký công việc
export async function POST(request: Request, context: RouteContext) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return Response.json(
        { message: "Chưa đăng nhập" },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return Response.json(
        { message: "ID công việc không hợp lệ" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const taskId = new ObjectId(id);

    const task = await db.collection("tasks").findOne({
      _id: taskId,
    });

    if (!task) {
      return Response.json(
        { message: "Không tìm thấy công việc" },
        { status: 404 }
      );
    }

    const isAssignee =
      task.assigneeId instanceof ObjectId &&
      task.assigneeId.equals(currentUser._id);

    if (!isAssignee) {
      return Response.json(
        { message: "Bạn không phải người được giao công việc này" },
        { status: 403 }
      );
    }

    const body: unknown = await request.json().catch(() => null);

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json(
        { message: "Body phải là JSON hợp lệ" },
        { status: 400 }
      );
    }

    const input = body as Record<string, unknown>;

    const content =
      typeof input.content === "string" ? input.content.trim() : "";

    const workDate =
      typeof input.workDate === "string" ? input.workDate.trim() : "";

    const minutesSpent = input.minutesSpent;

    if (content.length === 0 || content.length > 2000) {
      return Response.json(
        { message: "Nội dung phải từ 1 đến 2000 ký tự" },
        { status: 400 }
      );
    }

    if (!isValidWorkDate(workDate)) {
      return Response.json(
        { message: "workDate phải là ngày hợp lệ dạng YYYY-MM-DD" },
        { status: 400 }
      );
    }

    if (
      typeof minutesSpent !== "number" ||
      !Number.isInteger(minutesSpent) ||
      minutesSpent < 1 ||
      minutesSpent > 1440
    ) {
      return Response.json(
        { message: "minutesSpent phải là số nguyên từ 1 đến 1440" },
        { status: 400 }
      );
    }

    const log = {
      taskId: task._id,
      projectId: task.projectId,
      userId: currentUser._id,
      content,
      workDate,
      minutesSpent,
      createdAt: new Date(),
    };

    const result = await db.collection("task_logs").insertOne(log);

    return Response.json(
      {
        message: "Thêm nhật ký thành công",
        log: {
          ...log,
          _id: result.insertedId,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST task log error:", error);

    return Response.json(
      { message: "Không thể thêm nhật ký" },
      { status: 500 }
    );
  }
}

// Xem nhật ký của một công việc
export async function GET(_request: Request, context: RouteContext) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return Response.json(
        { message: "Chưa đăng nhập" },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return Response.json(
        { message: "ID công việc không hợp lệ" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const taskId = new ObjectId(id);

    const task = await db.collection("tasks").findOne({
      _id: taskId,
    });

    if (!task) {
      return Response.json(
        { message: "Không tìm thấy công việc" },
        { status: 404 }
      );
    }

    const project = await db.collection("projects").findOne({
      _id: task.projectId,
    });

    const isAdmin = currentUser.role === "ADMIN";

    const isAssignee =
      task.assigneeId instanceof ObjectId &&
      task.assigneeId.equals(currentUser._id);

    const isManager =
      currentUser.role === "PM" &&
      project?.managerId instanceof ObjectId &&
      project.managerId.equals(currentUser._id);

    if (!isAdmin && !isAssignee && !isManager) {
      return Response.json(
        { message: "Bạn không có quyền xem nhật ký công việc này" },
        { status: 403 }
      );
    }

    const logs = await db
      .collection("task_logs")
      .find({ taskId })
      .sort({ workDate: -1, createdAt: -1 })
      .limit(100)
      .toArray();

    return Response.json(logs);
  } catch (error) {
    console.error("GET task logs error:", error);

    return Response.json(
      { message: "Không thể lấy nhật ký" },
      { status: 500 }
    );
  }
}