import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return Response.json(
        { message: "Chưa đăng nhập" },
        { status: 401 }
      );
    }

    const db = await getDatabase();

    const notifications = await db
      .collection("notifications")
      .find({ userId: currentUser._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    return Response.json(notifications);
  } catch (error) {
    console.error("GET notifications error:", error);

    return Response.json(
      { message: "Không thể lấy thông báo" },
      { status: 500 }
    );
  }
}