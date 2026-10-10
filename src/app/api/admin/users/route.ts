import { listRecentUsers } from "@/lib/auth/profile";
import { authorizeRequest } from "@/lib/auth/session";

/** Teacher-only JSON listing of recent users. Authorised on the server per request. */
export async function GET() {
  const { response } = await authorizeRequest("teacher");
  if (response) return response;

  const users = await listRecentUsers();
  return Response.json({
    users: users.map((u) => ({
      uid: u.uid,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      createdAt: u.createdAt?.toDate().toISOString() ?? null,
    })),
  });
}
