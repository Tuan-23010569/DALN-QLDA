import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

if (!uri || !dbName || !email || !password) {
  throw new Error(
    "Thiếu MONGODB_URI, MONGODB_DB, ADMIN_EMAIL hoặc ADMIN_PASSWORD"
  );
}

if (password.length < 12) {
  throw new Error("ADMIN_PASSWORD phải có ít nhất 12 ký tự");
}

const client = new MongoClient(uri);

try {
  await client.connect();

  const db = client.db(dbName);
  const users = db.collection("users");

  // Ngăn hai tài khoản dùng cùng email.
  await users.createIndex({ email: 1 }, { unique: true });

  const existingAdmin = await users.findOne({ role: "ADMIN" });

  if (existingAdmin) {
    console.log("Đã có tài khoản Admin. Không tạo thêm.");
  } else {
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await users.insertOne({
      email,
      passwordHash,
      role: "ADMIN",
      employeeId: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(`Đã tạo Admin với ID: ${result.insertedId}`);
  }
} finally {
  await client.close();
}