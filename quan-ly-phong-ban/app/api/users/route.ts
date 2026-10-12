import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";

const allowedRoles = ["EMPLOYEE", "LEADER", "PM", "HR"] as const;

type CreateUserInput = {
  employeeId?: string;
  password?: string;
  role?: string;
};

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (currentUser?.role !== "ADMIN") {
      return Response.json(
        { message: "Chỉ Admin được tạo tài khoản" },
        { status: 403 }
      );
    }

    const body = (await request.json()) as CreateUserInput;
    const employeeId = body.employeeId?.trim();
    const password = body.password;
    const role = body.role?.trim().toUpperCase();

    if (!employeeId || !ObjectId.isValid(employeeId)) {
      return Response.json(
        { message: "employeeId không hợp lệ" },
        { status: 400 }
      );
    }

    if (!password || password.length < 12) {
      return Response.json(
        { message: "Mật khẩu phải có ít nhất 12 ký tự" },
        { status: 400 }
      );
    }

    if (!role || !allowedRoles.includes(role as (typeof allowedRoles)[number])) {
      return Response.json(
        { message: "Vai trò không hợp lệ" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const employeeObjectId = new ObjectId(employeeId);

    const employee = await db
      .collection("employees")
      .findOne({ _id: employeeObjectId });

    if (!employee) {
      return Response.json(
        { message: "Không tìm thấy nhân viên" },
        { status: 404 }
      );
    }

    const users = db.collection("users");
    const existing = await users.findOne({
      $or: [
        { employeeId: employeeObjectId },
        { email: employee.email },
      ],
    });
    

    if (existing) {
      return Response.json(
        { message: "Nhân viên hoặc email này đã có tài khoản" },
        { status: 409 }
      );
    }

    const result = await users.insertOne({
      employeeId: employeeObjectId,
      email: employee.email,
      passwordHash: await bcrypt.hash(password, 12),
      role,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return Response.json(
      {
        message: "Tạo tài khoản thành công",
        user: {
          id: result.insertedId.toString(),
          employeeId,
          email: employee.email,
          role,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create user error:", error);

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      return Response.json(
        { message: "Email đã có tài khoản" },
        { status: 409 }
      );
    }

    return Response.json(
      { message: "Không thể tạo tài khoản" },
      { status: 500 }
    );
  }
}