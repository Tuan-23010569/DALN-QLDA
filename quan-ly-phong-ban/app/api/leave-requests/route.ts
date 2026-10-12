import { getDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/auth";

const leaveTypes = ["ANNUAL", "SICK", "UNPAID"] as const;

type LeaveRequestInput = {
  leaveType?: string;
  startDate?: string;
  endDate?: string;
  reason?: string;
};

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

// Nhân viên gửi đơn nghỉ phép
export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return Response.json(
        { message: "Chưa đăng nhập" },
        { status: 401 }
      );
    }

    if (!currentUser.employeeId) {
      return Response.json(
        { message: "Tài khoản chưa liên kết với hồ sơ nhân viên" },
        { status: 400 }
      );
    }

    const body: unknown = await request.json().catch(() => null);

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json(
        { message: "Body phải là JSON hợp lệ" },
        { status: 400 }
      );
    }

    const input = body as LeaveRequestInput;
    const leaveType = input.leaveType?.trim().toUpperCase();
    const startDate = input.startDate?.trim();
    const endDate = input.endDate?.trim();
    const reason = input.reason?.trim();

    if (
      !leaveType ||
      !leaveTypes.includes(leaveType as (typeof leaveTypes)[number])
    ) {
      return Response.json(
        { message: "leaveType phải là ANNUAL, SICK hoặc UNPAID" },
        { status: 400 }
      );
    }

    if (
      !startDate ||
      !endDate ||
      !isValidDate(startDate) ||
      !isValidDate(endDate) ||
      startDate > endDate
    ) {
      return Response.json(
        { message: "Khoảng ngày nghỉ không hợp lệ" },
        { status: 400 }
      );
    }

    if (!reason || reason.length > 1000) {
      return Response.json(
        { message: "Lý do phải từ 1 đến 1000 ký tự" },
        { status: 400 }
      );
    }

    const db = await getDatabase();

    const leaveRequest = {
      userId: currentUser._id,
      employeeId: currentUser.employeeId,
      leaveType,
      startDate,
      endDate,
      reason,
      status: "PENDING",
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await db
      .collection("leave_requests")
      .insertOne(leaveRequest);

    return Response.json(
      {
        message: "Gửi đơn nghỉ phép thành công",
        leaveRequest: {
          _id: result.insertedId,
          ...leaveRequest,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST leave request error:", error);

    return Response.json(
      { message: "Không thể gửi đơn nghỉ phép" },
      { status: 500 }
    );
  }
}

// Nhân viên xem đơn của mình; HR/Admin xem tất cả
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
    const canViewAll = ["HR", "ADMIN"].includes(currentUser.role);

    const filter = canViewAll
      ? {}
      : { userId: currentUser._id };

    const requests = await db
      .collection("leave_requests")
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    return Response.json(requests);
  } catch (error) {
    console.error("GET leave requests error:", error);

    return Response.json(
      { message: "Không thể lấy danh sách đơn nghỉ phép" },
      { status: 500 }
    );
  }
}