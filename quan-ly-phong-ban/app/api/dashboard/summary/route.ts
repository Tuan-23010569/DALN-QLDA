import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return Response.json(
        { message: "Chưa đăng nhập" },
        { status: 401 }
      );
    }

    const db = await getDatabase();

    // Kiểm tra quyền Admin và trạng thái mới nhất trong database.
    const admin = await db.collection("users").findOne({
      _id: currentUser._id,
      role: "ADMIN",
      isActive: true,
    });

    if (!admin) {
      return Response.json(
        { message: "Chỉ Admin được xem Dashboard tổng quan" },
        { status: 403 }
      );
    }

    const employees = db.collection("employees");
    const departments = db.collection("departments");
    const projects = db.collection("projects");
    const tasks = db.collection("tasks");

    const [
      employeeCount,
      departmentCount,
      projectCount,
      planningProjects,
      activeProjects,
      completedProjects,
      taskCount,
      todoTasks,
      inProgressTasks,
      doneTasks,
    ] = await Promise.all([
      employees.countDocuments({ isActive: { $ne: false } }),
      departments.countDocuments({ isActive: { $ne: false } }),
      projects.countDocuments({}),
      projects.countDocuments({ status: "PLANNING" }),
      projects.countDocuments({ status: "ACTIVE" }),
      projects.countDocuments({ status: "COMPLETED" }),
      tasks.countDocuments({}),
      tasks.countDocuments({ status: "TODO" }),
      tasks.countDocuments({ status: "IN_PROGRESS" }),
      tasks.countDocuments({ status: "DONE" }),
    ]);

    return Response.json(
      {
        employees: employeeCount,
        departments: departmentCount,
        projects: {
          total: projectCount,
          planning: planningProjects,
          active: activeProjects,
          completed: completedProjects,
        },
        tasks: {
          total: taskCount,
          todo: todoTasks,
          inProgress: inProgressTasks,
          done: doneTasks,
          completionRate:
            taskCount === 0
              ? 0
              : Math.round((doneTasks / taskCount) * 100),
        },
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    console.error("GET dashboard summary error:", error);

    return Response.json(
      { message: "Không thể lấy dữ liệu Dashboard" },
      { status: 500 }
    );
  }
}