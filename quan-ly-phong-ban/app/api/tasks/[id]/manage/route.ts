import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function parseDate(value: unknown): Date | null | undefined {
  if (value === null) return null;

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    return undefined;
  }

  return date;
}

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

    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return Response.json(
        { message: "ID công việc không hợp lệ" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const taskId = new ObjectId(id);
    const tasks = db.collection("tasks");
    const task = await tasks.findOne({ _id: taskId });

    if (!task) {
      return Response.json(
        { message: "Không tìm thấy công việc" },
        { status: 404 }
      );
    }

    if (!(task.projectId instanceof ObjectId)) {
      return Response.json(
        { message: "Công việc chưa có projectId hợp lệ" },
        { status: 409 }
      );
    }

    const project = await db.collection("projects").findOne({
      _id: task.projectId,
    });

    if (!project) {
      return Response.json(
        { message: "Không tìm thấy dự án của công việc" },
        { status: 404 }
      );
    }

    const isAdmin = currentUser.role === "ADMIN";
    const isManager =
      currentUser.role === "PM" &&
      project.managerId instanceof ObjectId &&
      project.managerId.equals(currentUser._id);

    if (!isAdmin && !isManager) {
      return Response.json(
        { message: "Bạn không có quyền sửa công việc này" },
        { status: 403 }
      );
    }

    if (project.status === "COMPLETED" || task.status === "DONE") {
      return Response.json(
        { message: "Dự án hoặc công việc đã hoàn thành" },
        { status: 409 }
      );
    }

    const rawBody: unknown = await request.json().catch(() => null);

    if (
      !rawBody ||
      typeof rawBody !== "object" ||
      Array.isArray(rawBody)
    ) {
      return Response.json(
        { message: "Cần gửi JSON hợp lệ" },
        { status: 400 }
      );
    }

    const body = rawBody as Record<string, unknown>;
    const allowedFields = [
      "title",
      "description",
      "dueDate",
      "assigneeId",
    ];

    if (
      Object.keys(body).length === 0 ||
      Object.keys(body).some((key) => !allowedFields.includes(key))
    ) {
      return Response.json(
        { message: "Chỉ được sửa title, description, dueDate, assigneeId" },
        { status: 400 }
      );
    }

    const changes: Record<string, string | Date | ObjectId | null> = {};

    if ("title" in body) {
      if (
        typeof body.title !== "string" ||
        body.title.trim().length === 0 ||
        body.title.trim().length > 200
      ) {
        return Response.json(
          { message: "Tiêu đề phải từ 1 đến 200 ký tự" },
          { status: 400 }
        );
      }

      changes.title = body.title.trim();
    }

    if ("description" in body) {
      if (
        typeof body.description !== "string" ||
        body.description.length > 2000
      ) {
        return Response.json(
          { message: "Mô tả phải là chuỗi tối đa 2000 ký tự" },
          { status: 400 }
        );
      }

      changes.description = body.description.trim();
    }

    if ("dueDate" in body) {
      const date = parseDate(body.dueDate);

      if (date === undefined) {
        return Response.json(
          { message: "dueDate phải có dạng YYYY-MM-DD hoặc null" },
          { status: 400 }
        );
      }

      changes.dueDate = date;
    }

    if ("assigneeId" in body) {
      if (
        typeof body.assigneeId !== "string" ||
        !/^[a-fA-F0-9]{24}$/.test(body.assigneeId)
      ) {
        return Response.json(
          { message: "assigneeId không hợp lệ" },
          { status: 400 }
        );
      }

      const newAssigneeId = new ObjectId(body.assigneeId);

      const assignee = await db.collection("users").findOne({
        _id: newAssigneeId,
        isActive: { $ne: false },
      });

      if (!assignee) {
        return Response.json(
          { message: "Không tìm thấy tài khoản đang hoạt động" },
          { status: 404 }
        );
      }

      const membership = await db.collection("project_members").findOne({
        projectId: task.projectId,
        userId: newAssigneeId,
        isActive: { $ne: false },
      });

      if (!membership) {
        return Response.json(
          { message: "Người được giao chưa tham gia dự án" },
          { status: 400 }
        );
      }

      changes.assigneeId = newAssigneeId;
    }

    const updatedTask = await tasks.findOneAndUpdate(
      {
        _id: taskId,
        updatedAt: task.updatedAt,
      },
      {
        $set: {
          ...changes,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );

    if (!updatedTask) {
      return Response.json(
        { message: "Công việc vừa thay đổi, hãy tải lại và thử lại" },
        { status: 409 }
      );
    }

    try {
      await writeAuditLog({
        actorId: currentUser._id,
        action: "TASK_UPDATED",
        entityType: "task",
        entityId: taskId,
        before: {
          title: task.title,
          description: task.description,
          dueDate: task.dueDate,
          assigneeId: task.assigneeId,
        },
        after: {
          title: updatedTask.title,
          description: updatedTask.description,
          dueDate: updatedTask.dueDate,
          assigneeId: updatedTask.assigneeId,
        },
      });
    } catch (auditError) {
      console.error("Task audit log error:", auditError);
    }

    return Response.json({
      message: "Cập nhật công việc thành công",
      task: updatedTask,
    });
  } catch (error) {
    console.error("PATCH manage task error:", error);

    return Response.json(
      { message: "Không thể cập nhật công việc" },
      { status: 500 }
    );
  }
}