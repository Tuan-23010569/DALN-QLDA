import bcrypt from "bcryptjs";
import { getDatabase } from "@/lib/mongodb";
import { createSession } from "@/lib/auth";

type LoginInput = {
  email?: string;
  password?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LoginInput;
    const email = body.email?.trim().toLowerCase();
    const password = body.password;

    if (!email || !password) {
      return Response.json(
        { message: "Vui lòng nhập email và mật khẩu" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const user = await db.collection("users").findOne({ email });

    if (
      !user ||
      user.isActive !== true ||
      typeof user.passwordHash !== "string" ||
      !(await bcrypt.compare(password, user.passwordHash))
    ) {
      return Response.json(
        { message: "Email hoặc mật khẩu không đúng" },
        { status: 401 }
      );
    }

    await createSession(user._id.toString());

    return Response.json({
      message: "Đăng nhập thành công",
      user: {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return Response.json(
      { message: "Không thể đăng nhập" },
      { status: 500 }
    );
  }
}