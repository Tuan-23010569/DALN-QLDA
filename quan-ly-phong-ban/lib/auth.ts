import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";

const COOKIE_NAME = "session";
const secret = process.env.AUTH_SECRET;

if (!secret || secret.length < 32) {
  throw new Error("AUTH_SECRET phải có ít nhất 32 ký tự");
}

const key = new TextEncoder().encode(secret);

export async function createSession(userId: string) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key);

  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function getCurrentUser() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
    });

    if (!payload.sub || !ObjectId.isValid(payload.sub)) return null;

    const db = await getDatabase();

    return db.collection("users").findOne(
      { _id: new ObjectId(payload.sub), isActive: true },
      { projection: { passwordHash: 0 } }
    );
  } catch {
    return null;
  }
}
export async function deleteSession() {
  (await cookies()).delete(COOKIE_NAME);
}