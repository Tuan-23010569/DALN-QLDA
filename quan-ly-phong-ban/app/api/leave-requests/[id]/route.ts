import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import { writeAuditLog } from "@/lib/audit-log";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type ReviewInput = {
  status?: string;
  reviewNote?: string;
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

    if (!["HR", "ADMIN"].includes(currentUser.role)) {
      return Response.json(
        { message: "Bạn không có quyền duyệt đơn nghỉ phép" },
        { status: 403 }
      );
    }

    const { id } = await context.params;

    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return Response.json(
        { message: "ID đơn nghỉ phép không hợp lệ" },
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

    const input = body as ReviewInput;
    const status = input.status?.trim().toUpperCase();
    const reviewNote = input.reviewNote?.trim() ?? "";

    if (status !== "APPROVED" && status !== "REJECTED") {
      return Response.json(
        { message: "status phải là APPROVED hoặc REJECTED" },
        { status: 400 }
      );
    }

    if (reviewNote.length > 1000) {
      return Response.json(
        { message: "Ghi chú không được quá 1000 ký tự" },
        { status: 400 }
      );
    }

    if (status === "REJECTED" && !reviewNote) {
      return Response.json(
        { message: "Cần ghi lý do khi từ chối đơn" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const collection = db.collection("leave_requests");
    const leaveRequestId = new ObjectId(id);

    const existing = await collection.findOne({
      _id: leaveRequestId,
    });

    if (!existing) {
      return Response.json(
        { message: "Không tìm thấy đơn nghỉ phép" },
        { status: 404 }
      );
    }

    if (
      existing.userId instanceof ObjectId &&
      existing.userId.equals(currentUser._id)
    ) {
      return Response.json(
        { message: "Bạn không thể tự duyệt đơn của mình" },
        { status: 403 }
      );
    }

    // Chỉ cập nhật nếu đơn vẫn đang chờ; tránh duyệt hai lần.
    const updated = await collection.findOneAndUpdate(
      {
        _id: leaveRequestId,
        status: "PENDING",
      },
      {
        $set: {
          status,
          reviewNote,
          reviewedBy: currentUser._id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );

    if (!updated) {
      return Response.json(
        { message: "Đơn này đã được xử lý trước đó" },
        { status: 409 }
      );
    }
    try {
  await writeAuditLog({
    actorId: currentUser._id,
    action: "LEAVE_REQUEST_REVIEWED",
    entityType: "LEAVE_REQUEST",
    entityId: updated._id,
    before: {
      status: existing.status,
      reviewNote: existing.reviewNote,
    },
    after: {
      status: updated.status,
      reviewNote: updated.reviewNote,
      reviewedBy: currentUser._id,
    },
  });
} catch (error) {
  console.error("Không thể ghi Audit Log nghỉ phép:", error);
}
    if (updated.userId instanceof ObjectId) {
  try {
    await createNotification({
      userId: updated.userId,
      title:
        status === "APPROVED"
          ? "Đơn nghỉ phép đã được duyệt"
          : "Đơn nghỉ phép đã bị từ chối",
      message:
        status === "APPROVED"
          ? `Đơn nghỉ từ ${updated.startDate} đến ${updated.endDate} đã được duyệt.`
          : `Đơn nghỉ từ ${updated.startDate} đến ${updated.endDate} đã bị từ chối. Lý do: ${reviewNote}`,
      type: "LEAVE_REVIEWED",
      referenceId: updated._id,
    });
  } catch (error) {
    console.error("Không thể tạo thông báo nghỉ phép:", error);
  }
}

    return Response.json({
      message:
        status === "APPROVED"
          ? "Đã duyệt đơn nghỉ phép"
          : "Đã từ chối đơn nghỉ phép",
      leaveRequest: updated,
    });
  } catch (error) {
    console.error("PATCH leave request error:", error);

    return Response.json(
      { message: "Không thể xử lý đơn nghỉ phép" },
      { status: 500 }
    );
  }
}