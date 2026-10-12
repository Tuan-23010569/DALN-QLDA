import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";

type AddMemberInput = {
  projectId?: string;
  userId?: string;
};

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return Response.json(
        { message: "Chưa đăng nhập" },
        { status: 401 }
      );
    }

    const body = (await request.json()) as AddMemberInput;
    const projectId = body.projectId?.trim();
    const userId = body.userId?.trim();

    if (!projectId || !userId) {
      return Response.json(
        { message: "Thiếu projectId hoặc userId" },
        { status: 400 }
      );
    }

    if (!ObjectId.isValid(projectId) || !ObjectId.isValid(userId)) {
      return Response.json(
        { message: "projectId hoặc userId không hợp lệ" },
        { status: 400 }
      );
    }

    const db = await getDatabase();
    const projectObjectId = new ObjectId(projectId);
    const userObjectId = new ObjectId(userId);

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
    const isProjectManager =
      currentUser.role === "PM" &&
      project.managerId instanceof ObjectId &&
      project.managerId.equals(currentUser._id);

    if (!isAdmin && !isProjectManager) {
      return Response.json(
        { message: "Bạn không có quyền thêm thành viên vào dự án này" },
        { status: 403 }
      );
    }

    const member = await db.collection("users").findOne({
      _id: userObjectId,
      isActive: true,
    });

    if (!member) {
      return Response.json(
        { message: "Không tìm thấy tài khoản nhân viên đang hoạt động" },
        { status: 404 }
      );
    }

    const collection = db.collection("project_members");

    const existing = await collection.findOne({
      projectId: projectObjectId,
      userId: userObjectId,
    });

    if (existing) {
      return Response.json(
        { message: "Người này đã là thành viên dự án" },
        { status: 409 }
      );
    }

    const projectMember = {
      projectId: projectObjectId,
      userId: userObjectId,
      joinedAt: new Date(),
    };

    const result = await collection.insertOne(projectMember);

    return Response.json(
      { _id: result.insertedId, ...projectMember },
      { status: 201 }
    );
  } catch (error) {
    console.error("Add project member error:", error);

    return Response.json(
      { message: "Không thể thêm thành viên dự án" },
      { status: 500 }
    );
  }
}