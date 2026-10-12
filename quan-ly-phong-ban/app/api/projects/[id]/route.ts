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
      return Response.json({ message: "Chưa đăng nhập" }, { status: 401 });
    }

    const { id } = await context.params;

    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return Response.json(
        { message: "ID dự án không hợp lệ" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const projectId = new ObjectId(id);
    const projects = db.collection("projects");
    const project = await projects.findOne({ _id: projectId });

    if (!project) {
      return Response.json(
        { message: "Không tìm thấy dự án" },
        { status: 404 }
      );
    }

    const isAdmin = currentUser.role === "ADMIN";
    const isProjectManager =
      currentUser.role === "PM" &&
      project.managerId instanceof ObjectId &&
      project.managerId.equals(currentUser._id);

    if (!isAdmin && !isProjectManager) {
      return Response.json(
        { message: "Bạn không có quyền sửa dự án này" },
        { status: 403 }
      );
    }

    if (project.status === "COMPLETED") {
      return Response.json(
        { message: "Dự án đã đóng" },
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
      "name",
      "description",
      "startDate",
      "endDate",
      "status",
    ];

    if (
      Object.keys(body).length === 0 ||
      Object.keys(body).some((key) => !allowedFields.includes(key))
    ) {
      return Response.json(
        { message: "Không có trường hợp lệ để cập nhật" },
        { status: 400 }
      );
    }

    const changes: Record<string, string | Date | null> = {};

    if ("name" in body) {
      if (
        typeof body.name !== "string" ||
        body.name.trim().length === 0 ||
        body.name.trim().length > 200
      ) {
        return Response.json(
          { message: "Tên dự án phải từ 1 đến 200 ký tự" },
          { status: 400 }
        );
      }

      changes.name = body.name.trim();
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

    if ("startDate" in body) {
      const date = parseDate(body.startDate);

      if (date === undefined) {
        return Response.json(
          { message: "startDate phải có dạng YYYY-MM-DD hoặc null" },
          { status: 400 }
        );
      }

      changes.startDate = date;
    }

    if ("endDate" in body) {
      const date = parseDate(body.endDate);

      if (date === undefined) {
        return Response.json(
          { message: "endDate phải có dạng YYYY-MM-DD hoặc null" },
          { status: 400 }
        );
      }

      changes.endDate = date;
    }

    const nextStartDate =
      "startDate" in changes ? changes.startDate : project.startDate;
    const nextEndDate =
      "endDate" in changes ? changes.endDate : project.endDate;

    if (
      nextStartDate instanceof Date &&
      nextEndDate instanceof Date &&
      nextEndDate < nextStartDate
    ) {
      return Response.json(
        { message: "Ngày kết thúc phải từ ngày bắt đầu trở đi" },
        { status: 400 }
      );
    }

    if ("status" in body) {
      const nextStatus = body.status;

      const validTransition =
        (project.status === "PLANNING" && nextStatus === "ACTIVE") ||
        (project.status === "ACTIVE" && nextStatus === "COMPLETED");

      if (!validTransition) {
        return Response.json(
          {
            message:
              "Chỉ được chuyển PLANNING → ACTIVE hoặc ACTIVE → COMPLETED",
          },
          { status: 400 }
        );
      }

      if (nextStatus === "COMPLETED") {
        const unfinishedTasks = await db.collection("tasks").countDocuments({
          projectId,
          status: { $ne: "DONE" },
        });

        if (unfinishedTasks > 0) {
          return Response.json(
            {
              message: `Còn ${unfinishedTasks} công việc chưa hoàn thành`,
            },
            { status: 409 }
          );
        }
      }

      changes.status = nextStatus as string;
    }

    const updatedProject = await projects.findOneAndUpdate(
      { _id: projectId, status: project.status },
      { $set: { ...changes, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!updatedProject) {
      return Response.json(
        { message: "Trạng thái dự án đã thay đổi, hãy thử lại" },
        { status: 409 }
      );
    }

    try {
      await writeAuditLog({
        actorId: currentUser._id,
        action: "status" in changes
          ? "PROJECT_STATUS_CHANGED"
          : "PROJECT_UPDATED",
        entityType: "project",
        entityId: projectId,
        before: {
          name: project.name,
          description: project.description,
          startDate: project.startDate,
          endDate: project.endDate,
          status: project.status,
        },
        after: {
          name: updatedProject.name,
          description: updatedProject.description,
          startDate: updatedProject.startDate,
          endDate: updatedProject.endDate,
          status: updatedProject.status,
        },
      });
    } catch (auditError) {
      console.error("Project audit log error:", auditError);
    }

    return Response.json({
      message:
        updatedProject.status === "COMPLETED"
          ? "Đã đóng dự án"
          : "Cập nhật dự án thành công",
      project: updatedProject,
    });
  } catch (error) {
    console.error("PATCH project error:", error);

    return Response.json(
      { message: "Không thể cập nhật dự án" },
      { status: 500 }
    );
  }
}