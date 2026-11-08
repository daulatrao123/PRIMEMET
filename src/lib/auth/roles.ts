/**
 * The role vocabulary and where each role belongs.
 *
 * Kept in its own module so middleware (edge, no database) and the server session layer share one
 * definition instead of two strings that can drift.
 */

export type Role = "ADMIN" | "BUYER" | "SELLER";

export const ROLES: readonly Role[] = ["ADMIN", "BUYER", "SELLER"];

export function homeForRole(role: Role): string {
  if (role === "ADMIN") return "/admin/dashboard";
  if (role === "SELLER") return "/seller/dashboard";
  return "/buyer/dashboard";
}

/** The area a path belongs to, or `null` for the public site. */
export function areaForPath(pathname: string): Role | null {
  if (pathname.startsWith("/admin")) return "ADMIN";
  if (pathname.startsWith("/buyer")) return "BUYER";
  if (pathname.startsWith("/seller")) return "SELLER";
  return null;
}