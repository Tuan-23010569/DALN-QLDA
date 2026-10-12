import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(_request: Request, context: RouteContext) {
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
        { message: "ID thông báo không hợp lệ" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const notifications = db.collection("notifications");

    const updated = await notifications.findOneAndUpdate(
      {
        _id: new ObjectId(id),
        userId: currentUser._id,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );

    if (!updated) {
      return Response.json(
        { message: "Không tìm thấy thông báo của bạn" },
        { status: 404 }
      );
    }

    return Response.json({
      message: "Đã đánh dấu thông báo là đã đọc",
      notification: updated,
    });
  } catch (error) {
    console.error("PATCH notification error:", error);

    return Response.json(
      { message: "Không thể cập nhật thông báo" },
      { status: 500 }
    );
  }
}