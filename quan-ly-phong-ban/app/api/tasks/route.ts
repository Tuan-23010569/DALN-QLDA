import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";
import { createNotification } from "@/lib/notifications";

type TaskInput = {
  projectId?: string;
  assigneeId?: string;
  title?: string;
  description?: string;
  dueDate?: string;
};

export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return Response.json({ message: "Chưa đăng nhập" }, { status: 401 });
    }

    const projectId = new URL(request.url).searchParams.get("projectId");

    if (!projectId || !ObjectId.isValid(projectId)) {
      return Response.json(
        { message: "Cần cung cấp projectId hợp lệ" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const projectObjectId = new ObjectId(projectId);

    const project = await db
      .collection("projects")
      .findOne({ _id: projectObjectId });

    if (!project) {
      return Response.json(
        { message: "Không tìm thấy dự án" },
        { status: 404 }
      );
    }

    const isAdmin = currentUser.role === "ADMIN";
    const isManager =
      project.managerId instanceof ObjectId &&
      project.managerId.equals(currentUser._id);

    const membership = await db.collection("project_members").findOne({
      projectId: projectObjectId,
      userId: currentUser._id,
    });

    if (!isAdmin && !isManager && !membership) {
      return Response.json(
        { message: "Bạn không thuộc dự án này" },
        { status: 403 }
      );
    }

    const tasks = await db
      .collection("tasks")
      .find({ projectId: projectObjectId })
      .sort({ createdAt: -1 })
      .toArray();

    return Response.json(tasks);
  } catch (error) {
    console.error("GET tasks error:", error);

    return Response.json(
      { message: "Không thể lấy danh sách công việc" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return Response.json({ message: "Chưa đăng nhập" }, { status: 401 });
    }

    const body = (await request.json()) as TaskInput;
    const title = body.title?.trim();
    const projectId = body.projectId?.trim();
    const assigneeId = body.assigneeId?.trim();

    if (
      !title ||
      !projectId ||
      !assigneeId ||
      !ObjectId.isValid(projectId) ||
      !ObjectId.isValid(assigneeId)
    ) {
      return Response.json(
        { message: "Tên công việc, projectId hoặc assigneeId không hợp lệ" },
        { status: 400 }
      );
    }

    const dueDate = body.dueDate ? new Date(body.dueDate) : null;

    if (dueDate && Number.isNaN(dueDate.getTime())) {
      return Response.json(
        { message: "dueDate không hợp lệ" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const projectObjectId = new ObjectId(projectId);
    const assigneeObjectId = new ObjectId(assigneeId);

    const project = await db
      .collection("projects")
      .findOne({ _id: projectObjectId });

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
        { message: "Bạn không có quyền giao việc trong dự án này" },
        { status: 403 }
      );
    }

    const membership = await db.collection("project_members").findOne({
      projectId: projectObjectId,
      userId: assigneeObjectId,
    });

    if (!membership) {
      return Response.json(
        { message: "Người được giao chưa là thành viên dự án" },
        { status: 400 }
      );
    }

    const assignee = await db.collection("users").findOne({
      _id: assigneeObjectId,
      isActive: true,
    });

    if (!assignee) {
      return Response.json(
        { message: "Tài khoản người được giao không hoạt động" },
        { status: 400 }
      );
    }

    const task = {
      projectId: projectObjectId,
      assigneeId: assigneeObjectId,
      title,
      description: body.description?.trim() ?? "",
      status: "TODO",
      progress: 0,
      dueDate,
      createdBy: currentUser._id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db.collection("tasks").insertOne(task);
    try {
  await createNotification({
    userId: assigneeObjectId,
    title: "Bạn có công việc mới",
    message: `Bạn được giao công việc: ${title}`,
    type: "TASK_ASSIGNED",
    referenceId: result.insertedId,
  });
} catch (error) {
  console.error("Không thể tạo thông báo giao việc:", error);
}

    return Response.json(
      { _id: result.insertedId, ...task },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST tasks error:", error);

    return Response.json(
      { message: "Không thể tạo công việc" },
      { status: 500 }
    );
  }
}