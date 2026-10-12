import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";

type PositionInput = {
  code?: string;
  name?: string;
  description?: string;
};

// Lấy danh sách chức vụ
export async function GET() {
  try {
    const db = await getDatabase();

    const positions = await db
      .collection("positions")
      .find()
      .sort({ name: 1 })
      .toArray();

    return Response.json(positions);
  } catch (error) {
    console.error("GET positions error:", error);

    return Response.json(
      { message: "Không thể lấy danh sách chức vụ" },
      { status: 500 }
    );
  }
}

// Tạo chức vụ
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

if (!user || !["ADMIN", "HR"].includes(user.role)) {
  return Response.json(
    { message: "Không có quyền thực hiện" },
    { status: 403 }
  );
}
    const body = (await request.json()) as PositionInput;
    const code = body.code?.trim().toUpperCase();
    const name = body.name?.trim();

    if (!code || !name) {
      return Response.json(
        { message: "Mã và tên chức vụ là bắt buộc" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const collection = db.collection("positions");

    const existing = await collection.findOne({ code });
    if (existing) {
      return Response.json(
        { message: "Mã chức vụ đã tồn tại" },
        { status: 409 }
      );
    }

    const position = {
      code,
      name,
      description: body.description?.trim() ?? "",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await collection.insertOne(position);

    return Response.json(
      { _id: result.insertedId, ...position },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST positions error:", error);

    return Response.json(
      { message: "Không thể tạo chức vụ" },
      { status: 500 }
    );
  }
}