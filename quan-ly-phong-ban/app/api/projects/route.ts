import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";

type ProjectInput = {
  code?: string;
  name?: string;
  description?: string;
  managerId?: string;
  startDate?: string;
  endDate?: string;
};

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

    const projects = await db
      .collection("projects")
      .aggregate([
        {
          $lookup: {
            from: "users",
            localField: "managerId",
            foreignField: "_id",
            as: "manager",
          },
        },
        {
          $addFields: {
            manager: { $first: "$manager" },
          },
        },
        {
          $project: {
            code: 1,
            name: 1,
            description: 1,
            managerId: 1,
            managerEmail: "$manager.email",
            startDate: 1,
            endDate: 1,
            status: 1,
            createdAt: 1,
          },
        },
        { $sort: { createdAt: -1 } },
      ])
      .toArray();

    return Response.json(projects);
  } catch (error) {
    console.error("GET projects error:", error);

    return Response.json(
      { message: "Không thể lấy danh sách dự án" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser || !["ADMIN", "PM"].includes(currentUser.role)) {
      return Response.json(
        { message: "Không có quyền tạo dự án" },
        { status: 403 }
      );
    }

    const body = (await request.json()) as ProjectInput;
    const code = body.code?.trim().toUpperCase();
    const name = body.name?.trim();
    const managerId = body.managerId?.trim();

    if (!code || !name || !managerId) {
      return Response.json(
        { message: "Mã, tên dự án và người quản lý là bắt buộc" },
        { status: 400 }
      );
    }

    if (!ObjectId.isValid(managerId)) {
      return Response.json(
        { message: "managerId không hợp lệ" },
        { status: 400 }
      );
    }

    const startDate = body.startDate ? new Date(body.startDate) : null;
    const endDate = body.endDate ? new Date(body.endDate) : null;

    if (
      (startDate && Number.isNaN(startDate.getTime())) ||
      (endDate && Number.isNaN(endDate.getTime())) ||
      (startDate && endDate && endDate < startDate)
    ) {
      return Response.json(
        { message: "Ngày bắt đầu hoặc ngày kết thúc không hợp lệ" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const managerObjectId = new ObjectId(managerId);

    const manager = await db.collection("users").findOne({
      _id: managerObjectId,
      role: "PM",
      isActive: true,
    });

    if (!manager) {
      return Response.json(
        { message: "Người quản lý phải là tài khoản PM đang hoạt động" },
        { status: 400 }
      );
    }

    // PM chỉ được tạo dự án do chính mình quản lý.
    if (
      currentUser.role === "PM" &&
      !currentUser._id.equals(managerObjectId)
    ) {
      return Response.json(
        { message: "PM chỉ được tạo dự án do mình quản lý" },
        { status: 403 }
      );
    }

    const collection = db.collection("projects");

    if (await collection.findOne({ code })) {
      return Response.json(
        { message: "Mã dự án đã tồn tại" },
        { status: 409 }
      );
    }

    const project = {
      code,
      name,
      description: body.description?.trim() ?? "",
      managerId: managerObjectId,
      startDate,
      endDate,
      status: "PLANNING",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await collection.insertOne(project);

    return Response.json(
      { _id: result.insertedId, ...project },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST projects error:", error);

    return Response.json(
      { message: "Không thể tạo dự án" },
      { status: 500 }
    );
  }
}