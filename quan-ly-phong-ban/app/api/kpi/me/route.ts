import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return Response.json(
        { message: "Chưa đăng nhập" },
        { status: 401 }
      );
    }

    const month = new URL(request.url).searchParams.get("month");

    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return Response.json(
        { message: "month phải có dạng YYYY-MM, ví dụ 2026-09" },
        { status: 400 }
      );
    }

    const [year, monthNumber] = month.split("-").map(Number);

    const startDate = new Date(
      Date.UTC(year, monthNumber - 1, 1)
    );

    const nextMonth = new Date(
      Date.UTC(year, monthNumber, 1)
    );

    const nextMonthString = nextMonth.toISOString().slice(0, 10);
    const db = await getDatabase();

    // Công việc được giao cho người dùng và đến hạn trong tháng.
    const tasks = await db.collection("tasks").find({
      assigneeId: currentUser._id,
      dueDate: {
        $gte: startDate,
        $lt: nextMonth,
      },
    }).toArray();

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(
      (task) => task.status === "DONE"
    ).length;

    const completionRate =
      totalTasks === 0
        ? 0
        : Math.round((completedTasks / totalTasks) * 100);

    // Tổng thời gian từ nhật ký có ngày làm việc trong tháng.
    const workTime = await db
      .collection("task_logs")
      .aggregate<{ totalMinutes: number; logCount: number }>([
        {
          $match: {
            userId: currentUser._id,
            workDate: {
              $gte: `${month}-01`,
              $lt: nextMonthString,
            },
            minutesSpent: { $type: "number" },
          },
        },
        {
          $group: {
            _id: null,
            totalMinutes: { $sum: "$minutesSpent" },
            logCount: { $sum: 1 },
          },
        },
      ])
      .toArray();

    return Response.json({
      month,
      userId: currentUser._id,
      totalTasks,
      completedTasks,
      completionRate,
      totalMinutes: workTime[0]?.totalMinutes ?? 0,
      logCount: workTime[0]?.logCount ?? 0,
    });
  } catch (error) {
    console.error("GET personal KPI error:", error);

    return Response.json(
      { message: "Không thể lấy KPI cá nhân" },
      { status: 500 }
    );
  }
}