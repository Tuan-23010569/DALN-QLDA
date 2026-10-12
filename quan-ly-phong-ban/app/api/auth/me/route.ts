import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json(
      { message: "Chưa đăng nhập" },
      { status: 401 }
    );
  }

  return Response.json({
    id: user._id.toString(),
    email: user.email,
    role: user.role,
  });
}