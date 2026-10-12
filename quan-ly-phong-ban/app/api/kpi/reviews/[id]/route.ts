import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import { writeAuditLog } from "@/lib/audit-log";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UpdateReviewInput = {
  score?: number;
  comment?: string;
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
        { message: "ID đánh giá không hợp lệ" },
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

    const input = body as UpdateReviewInput;
    const score = input.score;
    const comment =
      typeof input.comment === "string" ? input.comment.trim() : null;

    if (
      typeof score !== "number" ||
      !Number.isInteger(score) ||
      score < 0 ||
      score > 100
    ) {
      return Response.json(
        { message: "score phải là số nguyên từ 0 đến 100" },
        { status: 400 }
      );
    }

    if (comment === null || comment.length > 2000) {
      return Response.json(
        { message: "comment phải là chuỗi tối đa 2000 ký tự" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const reviews = db.collection("kpi_reviews");
    const reviewId = new ObjectId(id);

    const review = await reviews.findOne({ _id: reviewId });

    if (!review) {
      return Response.json(
        { message: "Không tìm thấy đánh giá KPI" },
        { status: 404 }
      );
    }

    const project = await db.collection("projects").findOne({
      _id: review.projectId,
    });

    if (!project) {
      return Response.json(
        { message: "Không tìm thấy dự án của đánh giá này" },
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
        { message: "Bạn không có quyền sửa đánh giá này" },
        { status: 403 }
      );
    }

    if (
      review.userId instanceof ObjectId &&
      review.userId.equals(currentUser._id)
    ) {
      return Response.json(
        { message: "Bạn không thể tự chấm KPI cho mình" },
        { status: 403 }
      );
    }

    const updated = await reviews.findOneAndUpdate(
      { _id: reviewId },
      {
        $set: {
          score,
          comment,
          reviewedBy: currentUser._id,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );
    if (!updated) {
  return Response.json(
    { message: "Không thể cập nhật đánh giá KPI" },
    { status: 409 }
  );
}

try {
  await writeAuditLog({
    actorId: currentUser._id,
    action: "KPI_REVIEW_UPDATED",
    entityType: "KPI_REVIEW",
    entityId: reviewId,
    before: {
      score: review.score,
      comment: review.comment,
    },
    after: {
      score: updated.score,
      comment: updated.comment,
    },
  });
} catch (error) {
  console.error("Không thể ghi Audit Log sửa KPI:", error);
}
    if (updated && updated.userId instanceof ObjectId) {
  try {
    await createNotification({
      userId: updated.userId,
      title: "Đánh giá KPI của bạn đã được cập nhật",
      message: `KPI tháng ${updated.month} của bạn đã được điều chỉnh.`,
      type: "KPI_REVIEWED",
      referenceId: updated._id,
    });
  } catch (error) {
    console.error("Không thể tạo thông báo cập nhật KPI:", error);
  }
}

    return Response.json({
      message: "Cập nhật đánh giá KPI thành công",
      review: updated,
    });
  } catch (error) {
    console.error("PATCH KPI review error:", error);

    return Response.json(
      { message: "Không thể cập nhật đánh giá KPI" },
      { status: 500 }
    );
  }
}