import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";
import { writeAuditLog } from "@/lib/audit-log";

type ReviewInput = {
  projectId?: string;
  userId?: string;
  month?: string;
  score?: number;
  comment?: string;
};

function isValidId(value: string): boolean {
  return /^[a-fA-F0-9]{24}$/.test(value);
}

function isValidMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

// PM hoặc Admin chấm KPI
export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return Response.json(
        { message: "Chưa đăng nhập" },
        { status: 401 }
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
    const projectId = input.projectId?.trim() ?? "";
    const userId = input.userId?.trim() ?? "";
    const month = input.month?.trim() ?? "";
    const comment = input.comment?.trim() ?? "";
    const score = input.score;

    if (!isValidId(projectId) || !isValidId(userId)) {
      return Response.json(
        { message: "projectId hoặc userId không hợp lệ" },
        { status: 400 }
      );
    }

    if (!isValidMonth(month)) {
      return Response.json(
        { message: "month phải có dạng YYYY-MM" },
        { status: 400 }
      );
    }

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

    if (comment.length > 2000) {
      return Response.json(
        { message: "Nhận xét không được quá 2000 ký tự" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const projectObjectId = new ObjectId(projectId);
    const userObjectId = new ObjectId(userId);

    const project = await db.collection("projects").findOne({
      _id: projectObjectId,
    });

    if (!project) {
      return Response.json(
        { message: "Không tìm thấy dự án" },
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
        { message: "Bạn không có quyền chấm KPI dự án này" },
        { status: 403 }
      );
    }

    if (userObjectId.equals(currentUser._id)) {
      return Response.json(
        { message: "Bạn không thể tự chấm KPI cho mình" },
        { status: 403 }
      );
    }

    const member = await db.collection("project_members").findOne({
      projectId: projectObjectId,
      userId: userObjectId,
    });

    if (!member) {
      return Response.json(
        { message: "Người được chấm chưa là thành viên dự án" },
        { status: 400 }
      );
    }

    const user = await db.collection("users").findOne({
      _id: userObjectId,
      isActive: true,
    });

    if (!user) {
      return Response.json(
        { message: "Tài khoản người được chấm không hoạt động" },
        { status: 400 }
      );
    }

    const reviews = db.collection("kpi_reviews");

    // Mỗi người chỉ có một đánh giá cho mỗi dự án trong một tháng.
    await reviews.createIndex(
      { projectId: 1, userId: 1, month: 1 },
      { unique: true }
    );

    const review = {
      projectId: projectObjectId,
      userId: userObjectId,
      month,
      score,
      comment,
      reviewedBy: currentUser._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await reviews.insertOne(review);
    try {
  await writeAuditLog({
    actorId: currentUser._id,
    action: "KPI_REVIEW_CREATED",
    entityType: "KPI_REVIEW",
    entityId: result.insertedId,
    before: {},
    after: {
      projectId: projectObjectId,
      userId: userObjectId,
      month,
      score,
      comment,
    },
  });
} catch (error) {
  console.error("Không thể ghi Audit Log tạo KPI:", error);
}
    try {
  await createNotification({
    userId: userObjectId,
    title: "Bạn có đánh giá KPI mới",
    message: `KPI tháng ${month} của bạn đã được đánh giá.`,
    type: "KPI_REVIEWED",
    referenceId: result.insertedId,
  });
} catch (error) {
  console.error("Không thể tạo thông báo KPI:", error);
}

    return Response.json(
      {
        message: "Đã lưu đánh giá KPI",
        review: { _id: result.insertedId, ...review },
      },
      { status: 201 }
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      return Response.json(
        { message: "Nhân viên đã được chấm KPI cho dự án trong tháng này" },
        { status: 409 }
      );
    }

    console.error("POST KPI review error:", error);

    return Response.json(
      { message: "Không thể lưu đánh giá KPI" },
      { status: 500 }
    );
  }
}

// Xem đánh giá KPI của một dự án trong một tháng
export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return Response.json(
        { message: "Chưa đăng nhập" },
        { status: 401 }
      );
    }

    const params = new URL(request.url).searchParams;
    const projectId = params.get("projectId") ?? "";
    const month = params.get("month") ?? "";

    if (!isValidId(projectId) || !isValidMonth(month)) {
      return Response.json(
        { message: "Cần projectId hợp lệ và month dạng YYYY-MM" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const projectObjectId = new ObjectId(projectId);

    const project = await db.collection("projects").findOne({
      _id: projectObjectId,
    });

    if (!project) {
      return Response.json(
        { message: "Không tìm thấy dự án" },
        { status: 404 }
      );
    }

    const canViewAll =
      ["ADMIN", "HR"].includes(currentUser.role) ||
      (currentUser.role === "PM" &&
        project.managerId instanceof ObjectId &&
        project.managerId.equals(currentUser._id));

    if (!canViewAll) {
      const membership = await db.collection("project_members").findOne({
        projectId: projectObjectId,
        userId: currentUser._id,
      });

      if (!membership) {
        return Response.json(
          { message: "Bạn không thuộc dự án này" },
          { status: 403 }
        );
      }
    }

    const filter = {
      projectId: projectObjectId,
      month,
      ...(canViewAll ? {} : { userId: currentUser._id }),
    };

    const reviews = await db
      .collection("kpi_reviews")
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    return Response.json(reviews);
  } catch (error) {
    console.error("GET KPI reviews error:", error);

    return Response.json(
      { message: "Không thể lấy đánh giá KPI" },
      { status: 500 }
    );
  }
}