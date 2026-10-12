import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";

type DepartmentInput = {
  code?: string;
  name?: string;
  description?: string;
};

// Lấy danh sách phòng ban
export async function GET() {
  try {
    const db = await getDatabase();

    const departments = await db
      .collection("departments")
      .find({ isActive: { $ne: false } })
      .sort({ name: 1 })
      .toArray();

    return Response.json(departments);
  } catch (error) {
    console.error("GET departments error:", error);
    return Response.json(
      { message: "Không thể lấy danh sách phòng ban" },
      { status: 500 }
    );
  }
}

// Tạo phòng ban
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

if (!user || !["ADMIN", "HR"].includes(user.role)) {
  return Response.json(
    { message: "Không có quyền thực hiện" },
    { status: 403 }
  );
}
    const body = (await request.json()) as DepartmentInput;
    const code = body.code?.trim().toUpperCase();
    const name = body.name?.trim();

    if (!code || !name) {
      return Response.json(
        { message: "Mã và tên phòng ban là bắt buộc" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const collection = db.collection("departments");

    const existing = await collection.findOne({ code });
    if (existing) {
      return Response.json(
        { message: "Mã phòng ban đã tồn tại" },
        { status: 409 }
      );
    }

    const department = {
      code,
      name,
      description: body.description?.trim() ?? "",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await collection.insertOne(department);

    return Response.json(
      { _id: result.insertedId, ...department },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST departments error:", error);
    return Response.json(
      { message: "Không thể tạo phòng ban" },
      { status: 500 }
    );
  }
}