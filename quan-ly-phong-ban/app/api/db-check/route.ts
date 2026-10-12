import { getDatabase } from "@/lib/mongodb";

export async function GET() {
  try {
    const db = await getDatabase();
    await db.command({ ping: 1 });

    return Response.json({
      connected: true,
      database: db.databaseName,
    });
  } catch (error) {
    console.error("MongoDB connection error:", error);

    return Response.json(
      { connected: false, message: "Không thể kết nối MongoDB" },
      { status: 500 }
    );
  }
}