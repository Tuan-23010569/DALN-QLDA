import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return Response.json(
        { message: "Chưa đăng nhập" },
        { status: 401 }
      );
    }

    const params = new URL(request.url).searchParams;
    const projectId = params.get("projectId");
    const from = params.get("from");
    const to = params.get("to");

    if (!projectId || !/^[a-fA-F0-9]{24}$/.test(projectId)) {
      return Response.json(
        { message: "projectId không hợp lệ" },
        { status: 400 }
      );
    }

    if (!from || !to || !isValidDate(from) || !isValidDate(to) || from > to) {
      return Response.json(
        { message: "from và to phải là ngày hợp lệ dạng YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const projectObjectId = new ObjectId(projectId);

    const project = await db.collection("projects").findOne({
      _id: projectObjectId,
    });

    if (!project) {
      return Response.json(
        { message: "Không tìm thấy dự án" },
        { status: 404 }
      );
    }

    const isAdmin = currentUser.role === "ADMIN";
    const isManager =
      currentUser.role === "PM" &&
      project.managerId instanceof ObjectId &&
      project.managerId.equals(currentUser._id);

    if (!isAdmin && !isManager) {
      return Response.json(
        { message: "Bạn không có quyền xem báo cáo dự án này" },
        { status: 403 }
      );
    }

    const rows = await db
      .collection("task_logs")
      .aggregate([
        {
          $match: {
            projectId: projectObjectId,
            workDate: { $gte: from, $lte: to },
            minutesSpent: { $type: "number" },
          },
        },
        {
          $group: {
            _id: "$userId",
            totalMinutes: { $sum: "$minutesSpent" },
            logCount: { $sum: 1 },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "user",
          },
        },
        { $unwind: "$user" },
        {
          $lookup: {
            from: "employees",
            localField: "user.employeeId",
            foreignField: "_id",
            as: "employee",
          },
        },
        {
          $project: {
            _id: 0,
            userId: "$_id",
            email: "$user.email",
            fullName: { $first: "$employee.fullName" },
            totalMinutes: 1,
            logCount: 1,
          },
        },
        { $sort: { totalMinutes: -1, email: 1 } },
      ])
      .toArray();

    const totalMinutes = rows.reduce(
      (sum, row) => sum + Number(row.totalMinutes),
      0
    );

    return Response.json({
      projectId,
      projectName: project.name,
      from,
      to,
      totalMinutes,
      employees: rows,
    });
  } catch (error) {
    console.error("GET work-time report error:", error);

    return Response.json(
      { message: "Không thể tạo báo cáo thời gian làm việc" },
      { status: 500 }
    );
  }
}