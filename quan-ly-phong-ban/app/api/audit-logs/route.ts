import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return Response.json(
        { message: "Chưa đăng nhập" },
        { status: 401 }
      );
    }

    if (currentUser.role !== "ADMIN") {
      return Response.json(
        { message: "Chỉ Admin được xem Audit Log" },
        { status: 403 }
      );
    }

    const pageValue = Number(
      new URL(request.url).searchParams.get("page") ?? "1"
    );

    const page =
      Number.isInteger(pageValue) && pageValue > 0
        ? pageValue
        : 1;

    const limit = 20;
    const db = await getDatabase();
    const collection = db.collection("audit_logs");

    const [items, total] = await Promise.all([
      collection
        .find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      collection.countDocuments(),
    ]);

    return Response.json({
      page,
      limit,
      total,
      items,
    });
  } catch (error) {
    console.error("GET audit logs error:", error);

    return Response.json(
      { message: "Không thể lấy Audit Log" },
      { status: 500 }
    );
  }
}