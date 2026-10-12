import { deleteSession } from "@/lib/auth";

export async function POST() {
  await deleteSession();

  return Response.json(
    { message: "Đăng xuất thành công" },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }
  );
}