import { ObjectId } from "mongodb";
import { getDatabase, getMongoClient } from "@/lib/mongodb";
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
        { message: "Không có quyền sửa nhân viên" },
        { status: 403 }
      );
    }

    const { id } = await context.params;

    if (!validId(id)) {
      return Response.json(
        { message: "ID nhân viên không hợp lệ" },
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
    const db = await getDatabase();
    const employeeId = new ObjectId(id);
    const employees = db.collection("employees");

    const before = await employees.findOne({
      _id: employeeId,
      isActive: { $ne: false },
    });

    if (!before) {
      return Response.json(
        { message: "Không tìm thấy nhân viên đang hoạt động" },
        { status: 404 }
      );
    }

    const changes: Record<string, string | ObjectId | Date> = {};

    if ("fullName" in input) {
      if (typeof input.fullName !== "string" || !input.fullName.trim()) {
        return Response.json(
          { message: "Tên nhân viên không được để trống" },
          { status: 400 }
        );
      }
      changes.fullName = input.fullName.trim();
    }

    if ("phone" in input) {
      if (typeof input.phone !== "string") {
        return Response.json(
          { message: "phone phải là chuỗi" },
          { status: 400 }
        );
      }
      changes.phone = input.phone.trim();
    }

    if ("departmentId" in input) {
      if (
        typeof input.departmentId !== "string" ||
        !validId(input.departmentId)
      ) {
        return Response.json(
          { message: "departmentId không hợp lệ" },
          { status: 400 }
        );
      }

      const departmentId = new ObjectId(input.departmentId);
      const department = await db.collection("departments").findOne({
        _id: departmentId,
        isActive: { $ne: false },
      });

      if (!department) {
        return Response.json(
          { message: "Phòng ban không tồn tại hoặc đã ngừng sử dụng" },
          { status: 400 }
        );
      }

      changes.departmentId = departmentId;
    }

    if ("positionId" in input) {
      if (
        typeof input.positionId !== "string" ||
        !validId(input.positionId)
      ) {
        return Response.json(
          { message: "positionId không hợp lệ" },
          { status: 400 }
        );
      }

      const positionId = new ObjectId(input.positionId);
      const position = await db.collection("positions").findOne({
        _id: positionId,
        isActive: { $ne: false },
      });

      if (!position) {
        return Response.json(
          { message: "Chức vụ không tồn tại hoặc đã ngừng sử dụng" },
          { status: 400 }
        );
      }

      changes.positionId = positionId;
    }

    if (Object.keys(changes).length === 0) {
      return Response.json(
        {
          message:
            "Cần gửi fullName, phone, departmentId hoặc positionId",
        },
        { status: 400 }
      );
    }

    changes.updatedAt = new Date();

    const updated = await employees.findOneAndUpdate(
      { _id: employeeId, isActive: { $ne: false } },
      { $set: changes },
      { returnDocument: "after" }
    );

    if (!updated) {
      return Response.json(
        { message: "Không thể cập nhật nhân viên" },
        { status: 409 }
      );
    }

    try {
      await writeAuditLog({
        actorId: user._id,
        action: "EMPLOYEE_UPDATED",
        entityType: "EMPLOYEE",
        entityId: employeeId,
        before: {
          fullName: before.fullName,
          phone: before.phone,
          departmentId: before.departmentId,
          positionId: before.positionId,
        },
        after: {
          fullName: updated.fullName,
          phone: updated.phone,
          departmentId: updated.departmentId,
          positionId: updated.positionId,
        },
      });
    } catch (error) {
      console.error("Audit Log nhân viên:", error);
    }

    return Response.json(updated);
  } catch (error) {
    console.error("PATCH employee error:", error);
    return Response.json(
      { message: "Không thể sửa nhân viên" },
      { status: 500 }
    );
  }
}