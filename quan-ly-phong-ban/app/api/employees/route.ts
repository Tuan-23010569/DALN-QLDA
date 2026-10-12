import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";

type EmployeeInput = {
  employeeCode?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  departmentId?: string;
  positionId?: string;
};

// Lấy danh sách nhân viên kèm tên phòng ban và chức vụ
export async function GET() {
  try {
    const user = await getCurrentUser();

if (!user) {
  return Response.json({ message: "Chưa đăng nhập" }, { status: 401 });
}
    const db = await getDatabase();

    const employees = await db
      .collection("employees")
      .aggregate([
        {
          $lookup: {
            from: "departments",
            localField: "departmentId",
            foreignField: "_id",
            as: "department",
          },
        },
        {
          $lookup: {
            from: "positions",
            localField: "positionId",
            foreignField: "_id",
            as: "position",
          },
        },
        {
          $addFields: {
            department: { $first: "$department" },
            position: { $first: "$position" },
          },
        },
        {
          $project: {
            employeeCode: 1,
            fullName: 1,
            email: 1,
            phone: 1,
            departmentId: 1,
            positionId: 1,
            departmentName: "$department.name",
            positionName: "$position.name",
            createdAt: 1,
            updatedAt: 1,
          },
        },
        { $sort: { createdAt: -1 } },
      ])
      .toArray();

    return Response.json(employees);
  } catch (error) {
    console.error("GET employees error:", error);

    return Response.json(
      { message: "Không thể lấy danh sách nhân viên" },
      { status: 500 }
    );
  }
}

// Tạo nhân viên
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

if (!user || !["ADMIN", "HR"].includes(user.role)) {
  return Response.json(
    { message: "Không có quyền thực hiện" },
    { status: 403 }
  );
}
    const body = (await request.json()) as EmployeeInput;

    const employeeCode = body.employeeCode?.trim().toUpperCase();
    const fullName = body.fullName?.trim();
    const email = body.email?.trim().toLowerCase();
    const phone = body.phone?.trim() ?? "";
    const departmentId = body.departmentId?.trim() ?? "";
    const positionId = body.positionId?.trim() ?? "";

    if (!employeeCode || !fullName || !email || !departmentId || !positionId) {
      return Response.json(
        { message: "Vui lòng nhập mã, tên, email, phòng ban và chức vụ" },
        { status: 400 }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json(
        { message: "Email không hợp lệ" },
        { status: 400 }
      );
    }

    if (!ObjectId.isValid(departmentId) || !ObjectId.isValid(positionId)) {
      return Response.json(
        { message: "ID phòng ban hoặc chức vụ không hợp lệ" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const departmentObjectId = new ObjectId(departmentId);
    const positionObjectId = new ObjectId(positionId);

    const [department, position] = await Promise.all([
      db.collection("departments").findOne({ _id: departmentObjectId }),
      db.collection("positions").findOne({ _id: positionObjectId }),
    ]);

    if (!department || !position) {
      return Response.json(
        { message: "Phòng ban hoặc chức vụ không tồn tại" },
        { status: 400 }
      );
    }

    const collection = db.collection("employees");

    const existing = await collection.findOne({
      $or: [{ employeeCode }, { email }],
    });

    if (existing) {
      return Response.json(
        { message: "Mã nhân viên hoặc email đã tồn tại" },
        { status: 409 }
      );
    }

    const employee = {
      employeeCode,
      fullName,
      email,
      phone,
      departmentId: departmentObjectId,
      positionId: positionObjectId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await collection.insertOne(employee);

    return Response.json(
      { _id: result.insertedId, ...employee },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST employees error:", error);

    return Response.json(
      { message: "Không thể tạo nhân viên" },
      { status: 500 }
    );
  }
}