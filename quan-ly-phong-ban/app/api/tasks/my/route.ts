import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";

type TaskStatus = "TODO" | "IN_PROGRESS" | "DONE";

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return Response.json(
        { message: "Chưa đăng nhập" },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const pageText = url.searchParams.get("page") ?? "1";
    const limitText = url.searchParams.get("limit") ?? "10";
    const status = url.searchParams.get("status");

    const page = Number(pageText);
    const limit = Number(limitText);

    if (
      !/^[1-9]\d*$/.test(pageText) ||
      !Number.isSafeInteger(page) ||
      !/^[1-9]\d*$/.test(limitText) ||
      !Number.isSafeInteger(limit) ||
      limit > 50
    ) {
      return Response.json(
        { message: "page phải từ 1; limit phải từ 1 đến 50" },
        { status: 400 }
      );
    }

    if (
      status !== null &&
      !["TODO", "IN_PROGRESS", "DONE"].includes(status)
    ) {
      return Response.json(
        { message: "status không hợp lệ" },
        { status: 400 }
      );
    }

    const skip = (page - 1) * limit;

    if (!Number.isSafeInteger(skip)) {
      return Response.json(
        { message: "page quá lớn" },
        { status: 400 }
      );
    }

    const filter: {
      assigneeId: ObjectId;
      status?: TaskStatus;
    } = {
      assigneeId: currentUser._id,
    };

    if (status !== null) {
      filter.status = status as TaskStatus;
    }

    const db = await getDatabase();
    const tasksCollection = db.collection("tasks");

    const [tasks, total] = await Promise.all([
      tasksCollection
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      tasksCollection.countDocuments(filter),
    ]);

    return Response.json({
      tasks,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("GET my tasks error:", error);

    return Response.json(
      { message: "Không thể lấy công việc của tôi" },
      { status: 500 }
    );
  }
}