import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type TaskStats = {
  _id: ObjectId;
  total: number;
  todo: number;
  inProgress: number;
  done: number;
};

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return Response.json(
        { message: "Chưa đăng nhập" },
        { status: 401 }
      );
    }

    const db = await getDatabase();
    const admin = await db.collection("users").findOne({
      _id: currentUser._id,
      role: "ADMIN",
      isActive: true,
    });

    if (!admin) {
      return Response.json(
        { message: "Chỉ Admin được xem báo cáo" },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const pageText = url.searchParams.get("page") ?? "1";
    const limitText = url.searchParams.get("limit") ?? "10";

    if (
      status !== null &&
      !["PLANNING", "ACTIVE", "COMPLETED"].includes(status)
    ) {
      return Response.json(
        { message: "Trạng thái dự án không hợp lệ" },
        { status: 400 }
      );
    }

    const page = Number(pageText);
    const limit = Number(limitText);

    if (
      !/^[1-9]\d*$/.test(pageText) ||
      !Number.isSafeInteger(page) ||
      !/^[1-9]\d*$/.test(limitText) ||
      !Number.isSafeInteger(limit) ||
      limit > 50 ||
      !Number.isSafeInteger((page - 1) * limit)
    ) {
      return Response.json(
        { message: "page phải từ 1; limit phải từ 1 đến 50" },
        { status: 400 }
      );
    }

    const projectFilter = status === null ? {} : { status };
    const projectsCollection = db.collection("projects");

    const [projectPage, totalProjects] = await Promise.all([
      projectsCollection
        .find(projectFilter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      projectsCollection.countDocuments(projectFilter),
    ]);

    const projectIds = projectPage.map((project) => project._id);

    const groupedTasks =
      projectIds.length === 0
        ? []
        : await db.collection("tasks").aggregate<TaskStats>([
            {
              $match: {
                projectId: { $in: projectIds },
              },
            },
            {
              $group: {
                _id: "$projectId",
                total: { $sum: 1 },
                todo: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "TODO"] }, 1, 0],
                  },
                },
                inProgress: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "IN_PROGRESS"] }, 1, 0],
                  },
                },
                done: {
                  $sum: {
                    $cond: [{ $eq: ["$status", "DONE"] }, 1, 0],
                  },
                },
              },
            },
          ]).toArray();

    const statsByProject = new Map(
      groupedTasks.map((item) => [item._id.toString(), item])
    );

    const reports = projectPage.map((project) => {
      const stats = statsByProject.get(project._id.toString());
      const taskTotal = stats?.total ?? 0;
      const done = stats?.done ?? 0;

      return {
        projectId: project._id.toString(),
        code: project.code,
        name: project.name,
        status: project.status,
        tasks: {
          total: taskTotal,
          todo: stats?.todo ?? 0,
          inProgress: stats?.inProgress ?? 0,
          done,
          completionRate:
            taskTotal === 0
              ? 0
              : Math.round((done / taskTotal) * 100),
        },
      };
    });

    return Response.json(
      {
        reports,
        pagination: {
          page,
          limit,
          total: totalProjects,
          totalPages: Math.ceil(totalProjects / limit),
        },
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    console.error("GET project reports error:", error);

    return Response.json(
      { message: "Không thể lấy báo cáo dự án" },
      { status: 500 }
    );
  }
}