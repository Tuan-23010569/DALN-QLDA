import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function validId(id: string) {
  return /^[a-fA-F0-9]{24}$/.test(id);
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser();

    if (!user || !["ADMIN", "HR"].includes(user.role)) {
      return Response.json(
        { message: "Không có quyền sửa phòng ban" },
        { status: 403 }
      );
    }

    const { id } = await context.params;

    if (!validId(id)) {
      return Response.json(
        { message: "ID phòng ban không hợp lệ" },
        { status: 400 }
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
    const changes: Record<string, string | Date> = {};

    if ("name" in input) {
      if (typeof input.name !== "string" || !input.name.trim()) {
        return Response.json(
          { message: "Tên phòng ban không được để trống" },
          { status: 400 }
        );
      }
      changes.name = input.name.trim();
    }

    if ("description" in input) {
      if (typeof input.description !== "string") {
        return Response.json(
          { message: "description phải là chuỗi" },
          { status: 400 }
        );
      }
      changes.description = input.description.trim();
    }

    if (Object.keys(changes).length === 0) {
      return Response.json(
        { message: "Cần gửi name hoặc description" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const departmentId = new ObjectId(id);
    const departments = db.collection("departments");

    const before = await departments.findOne({
      _id: departmentId,
      isActive: { $ne: false },
    });

    if (!before) {
      return Response.json(
        { message: "Không tìm thấy phòng ban đang hoạt động" },
        { status: 404 }
      );
    }

    changes.updatedAt = new Date();

    const updated = await departments.findOneAndUpdate(
      { _id: departmentId, isActive: { $ne: false } },
      { $set: changes },
      { returnDocument: "after" }
    );

    if (!updated) {
      return Response.json(
        { message: "Không thể cập nhật phòng ban" },
        { status: 409 }
      );
    }

    try {
      await writeAuditLog({
        actorId: user._id,
        action: "DEPARTMENT_UPDATED",
        entityType: "DEPARTMENT",
        entityId: departmentId,
        before: {
          name: before.name,
          description: before.description,
        },
        after: {
          name: updated.name,
          description: updated.description,
        },
      });
    } catch (error) {
      console.error("Audit Log phòng ban:", error);
    }

    return Response.json(updated);
  } catch (error) {
    console.error("PATCH department error:", error);
    return Response.json(
      { message: "Không thể sửa phòng ban" },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const user = await getCurrentUser();

    if (!user || !["ADMIN", "HR"].includes(user.role)) {
      return Response.json(
        { message: "Không có quyền ngừng sử dụng phòng ban" },
        { status: 403 }
      );
    }

    const { id } = await context.params;

    if (!validId(id)) {
      return Response.json(
        { message: "ID phòng ban không hợp lệ" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const departmentId = new ObjectId(id);

    const activeEmployees = await db.collection("employees").countDocuments({
      departmentId,
      isActive: { $ne: false },
    });

    if (activeEmployees > 0) {
      return Response.json(
        {
          message:
            "Phòng ban còn nhân viên đang hoạt động. Hãy chuyển nhân viên sang phòng ban khác trước.",
        },
        { status: 409 }
      );
    }

    const updated = await db.collection("departments").findOneAndUpdate(
      { _id: departmentId, isActive: { $ne: false } },
      { $set: { isActive: false, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!updated) {
      return Response.json(
        { message: "Không tìm thấy phòng ban đang hoạt động" },
        { status: 404 }
      );
    }

    try {
      await writeAuditLog({
        actorId: user._id,
        action: "DEPARTMENT_DEACTIVATED",
        entityType: "DEPARTMENT",
        entityId: departmentId,
        before: { isActive: true },
        after: { isActive: false },
      });
    } catch (error) {
      console.error("Audit Log phòng ban:", error);
    }

    return Response.json({
      message: "Đã ngừng sử dụng phòng ban",
      department: updated,
    });
  } catch (error) {
    console.error("DELETE department error:", error);
    return Response.json(
      { message: "Không thể ngừng sử dụng phòng ban" },
      { status: 500 }
    );
  }
}