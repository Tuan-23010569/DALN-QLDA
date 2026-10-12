import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";

type RouteContext = {
  params: Promise<{ id: string }>;
};

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
        { message: "ID tài khoản không hợp lệ" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const users = db.collection("users");

    // Kiểm tra lại quyền Admin và trạng thái tài khoản trong database.
    const admin = await users.findOne({
      _id: currentUser._id,
      role: "ADMIN",
      isActive: { $ne: false },
    });

    if (!admin) {
      return Response.json(
        { message: "Chỉ Admin đang hoạt động được thực hiện" },
        { status: 403 }
      );
    }

    const targetId = new ObjectId(id);
    const target = await users.findOne({ _id: targetId });

    if (!target) {
      return Response.json(
        { message: "Không tìm thấy tài khoản" },
        { status: 404 }
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

    if (
      Object.keys(body).length !== 1 ||
      typeof body.isActive !== "boolean"
    ) {
      return Response.json(
        { message: "Chỉ gửi isActive dạng true hoặc false" },
        { status: 400 }
      );
    }

    const desiredActive = body.isActive;
    const currentlyActive = target.isActive !== false;

    if (
      !desiredActive &&
      targetId.equals(admin._id)
    ) {
      return Response.json(
        { message: "Admin không thể tự khóa tài khoản của mình" },
        { status: 400 }
      );
    }

    if (desiredActive === currentlyActive) {
      return Response.json({
        message: "Tài khoản đã ở trạng thái này",
        user: {
          id: target._id.toString(),
          email: target.email,
          role: target.role,
          isActive: currentlyActive,
        },
      });
    }

    // Điều kiện trạng thái giúp tránh ghi đè nếu có người vừa cập nhật.
    const filter = desiredActive
      ? { _id: targetId, isActive: false }
      : { _id: targetId, isActive: { $ne: false } };

    const updated = await users.findOneAndUpdate(
      filter,
      {
        $set: {
          isActive: desiredActive,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );

    if (!updated) {
      return Response.json(
        { message: "Trạng thái tài khoản vừa thay đổi, hãy thử lại" },
        { status: 409 }
      );
    }

    try {
      await writeAuditLog({
        actorId: admin._id,
        action: desiredActive ? "USER_UNLOCKED" : "USER_LOCKED",
        entityType: "user",
        entityId: targetId,
        before: { isActive: currentlyActive },
        after: { isActive: desiredActive },
      });
    } catch (auditError) {
      console.error("User status audit log error:", auditError);
    }

    return Response.json({
      message: desiredActive
        ? "Mở khóa tài khoản thành công"
        : "Khóa tài khoản thành công",
      user: {
        id: updated._id.toString(),
        email: updated.email,
        role: updated.role,
        isActive: updated.isActive,
      },
    });
  } catch (error) {
    console.error("PATCH user status error:", error);

    return Response.json(
      { message: "Không thể cập nhật trạng thái tài khoản" },
      { status: 500 }
    );
  }
}