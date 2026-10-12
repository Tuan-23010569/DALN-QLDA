import bcrypt from "bcryptjs";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit-log";

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return Response.json(
        { message: "Chưa đăng nhập" },
        { status: 401 }
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
    const currentPassword = body.currentPassword;
    const newPassword = body.newPassword;

    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string"
    ) {
      return Response.json(
        { message: "Cần gửi currentPassword và newPassword" },
        { status: 400 }
      );
    }

    if (
      newPassword.length < 12 ||
      Buffer.byteLength(newPassword, "utf8") > 72
    ) {
      return Response.json(
        { message: "Mật khẩu mới phải từ 12 ký tự đến tối đa 72 byte" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const users = db.collection("users");
    const user = await users.findOne({ _id: currentUser._id });

    if (!user || user.isActive === false) {
      return Response.json(
        { message: "Tài khoản không hoạt động" },
        { status: 403 }
      );
    }

    if (typeof user.passwordHash !== "string") {
      return Response.json(
        { message: "Tài khoản chưa có mật khẩu hợp lệ" },
        { status: 409 }
      );
    }

    const correctPassword = await bcrypt.compare(
      currentPassword,
      user.passwordHash
    );

    if (!correctPassword) {
      return Response.json(
        { message: "Mật khẩu hiện tại không đúng" },
        { status: 400 }
      );
    }

    const samePassword = await bcrypt.compare(
      newPassword,
      user.passwordHash
    );

    if (samePassword) {
      return Response.json(
        { message: "Mật khẩu mới phải khác mật khẩu hiện tại" },
        { status: 400 }
      );
    }

    const now = new Date();
    const newHash = await bcrypt.hash(newPassword, 12);

    const result = await users.updateOne(
      {
        _id: user._id,
        passwordHash: user.passwordHash,
        isActive: { $ne: false },
      },
      {
        $set: {
          passwordHash: newHash,
          passwordChangedAt: now,
          updatedAt: now,
        },
      }
    );

    if (result.matchedCount === 0) {
      return Response.json(
        { message: "Tài khoản vừa thay đổi, hãy thử lại" },
        { status: 409 }
      );
    }

    try {
      await writeAuditLog({
        actorId: user._id,
        action: "USER_PASSWORD_CHANGED",
        entityType: "user",
        entityId: user._id,
        before: {
          passwordChangedAt: user.passwordChangedAt ?? null,
        },
        after: {
          passwordChangedAt: now,
        },
      });
    } catch (auditError) {
      console.error("Password audit log error:", auditError);
    }

    return Response.json({
      message: "Đổi mật khẩu thành công",
    });
  } catch (error) {
    console.error("Change password error:", error);

    return Response.json(
      { message: "Không thể đổi mật khẩu" },
      { status: 500 }
    );
  }
}