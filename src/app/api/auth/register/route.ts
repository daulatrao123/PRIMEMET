import type { NextRequest } from "next/server";

import { writeAuthEvent } from "@/lib/auth/audit";
import { hashPassword } from "@/lib/auth/password";
import { LIMITS, consume, retryAfterSeconds } from "@/lib/auth/rate-limit";
import { SESSION_COOKIE, cookieOptions, createSession, homeForRole } from "@/lib/auth/session";
import { isConfigured } from "@/lib/db";
import { RegistrationConflictError, registerAccount } from "@/lib/data/accounts";
import { env } from "@/lib/env";
import {
  clientIp,
  isCrossSite,
  jsonError,
  jsonOk,
  readInput,
  redirectTo,
  safeNextPath,
  shortMessage,
  wantsJson,
} from "@/lib/http";
import { buyerRegistrationSchema, firstIssue, sellerRegistrationSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/register — create a buyer or seller account.
 *
 * One route, two schemas. The role is still chosen by the applicant, which is safe because the role is
 * written once at creation and every read path re-derives it from the database; nothing in the request
 * can elevate an account afterwards.
 *
 * A buyer is signed in immediately. A seller is not: the account is created INVITED and the login route
 * refuses it until an admin approves the application. The response says so explicitly rather than
 * pretending the registration finished.
 */
export async function POST(request: NextRequest) {
  if (isCrossSite(request)) return jsonError(403, "Cross-site requests are not accepted.", "cross_site");
  if (!isConfigured()) return jsonError(503, "Accounts are not available on this deployment yet.", "unavailable");

  const input = await readInput(request);
  const role = input.role === "SELLER" ? "SELLER" : input.role === "BUYER" ? "BUYER" : null;
  const asForm = !wantsJson(request);
  const backPath = role === "SELLER" ? "/register/seller" : "/register/buyer";

  if (!role) {
    const message = "Choose whether you are registering as a buyer or a supplier.";
    return asForm ? redirectTo(request, "/register/buyer", { error: message }) : jsonError(400, message, "role");
  }

  const ip = clientIp(request);
  const limit = consume(`register:${ip ?? "unknown"}:${role}`, LIMITS.register.limit, LIMITS.register.windowMs);
  if (!limit.ok) {
    const message = `Too many registration attempts. Try again in ${retryAfterSeconds(limit.retryAfterMs)} seconds.`;
    return asForm ? redirectTo(request, backPath, { error: message }) : jsonError(429, message, "rate_limited");
  }

  const schema = role === "BUYER" ? buyerRegistrationSchema : sellerRegistrationSchema;
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = firstIssue(parsed.error);
    return asForm
      ? redirectTo(request, backPath, { error: shortMessage(issue.message), field: issue.field ?? "" })
      : jsonError(400, issue.message, issue.field ?? "validation");
  }

  const value = parsed.data;
  try {
    const passwordHash = await hashPassword(value.password);
    const account = await registerAccount({
      company: value.company,
      contactName: value.contactName,
      email: value.email,
      phone: value.phone,
      gstin: value.gstin,
      city: value.city,
      stateCode: value.stateCode,
      addressLine1: "addressLine1" in value ? value.addressLine1 : undefined,
      postalCode: "postalCode" in value ? value.postalCode : undefined,
      businessType: "businessType" in value ? value.businessType : undefined,
      description: "description" in value ? value.description : undefined,
      notes: "notes" in value ? value.notes : undefined,
      materials: "materials" in value ? value.materials : undefined,
      passwordHash,
      role,
    });

    await writeAuthEvent({
      userId: account.userId,
      emailAttempted: value.email,
      eventType: role === "BUYER" ? "register.buyer" : "register.seller",
      success: true,
      ip,
      userAgent: request.headers.get("user-agent"),
      detail: { organisationId: account.organisationId, active: account.active },
    });

    if (!account.active) {
      const message = "Application received. A PRIMEMET administrator must approve your account before you can sign in.";
      return asForm
        ? redirectTo(request, "/login", { registered: "seller", notice: message })
        : jsonOk({ role, pendingApproval: true, redirect: "/login" }, 201);
    }

    const session = await createSession({ id: account.userId, role }, {
      ip,
      userAgent: request.headers.get("user-agent"),
    });
    const destination = safeNextPath(input.next) ?? homeForRole(role);

    if (!asForm) {
      const response = jsonOk({ role, pendingApproval: false, redirect: destination }, 201);
      response.cookies.set(SESSION_COOKIE, session.value, cookieOptions(env.NEXT_PUBLIC_APP_URL, session.expiresAt));
      return response;
    }

    const response = redirectTo(request, destination);
    response.cookies.set(SESSION_COOKIE, session.value, cookieOptions(env.NEXT_PUBLIC_APP_URL, session.expiresAt));
    return response;
  } catch (error) {
    if (error instanceof RegistrationConflictError) {
      await writeAuthEvent({
        emailAttempted: value.email,
        eventType: role === "BUYER" ? "register.buyer" : "register.seller",
        success: false,
        ip,
        userAgent: request.headers.get("user-agent"),
        detail: { reason: "duplicate_email" },
      });
      return asForm
        ? redirectTo(request, backPath, { error: error.message })
        : jsonError(409, error.message, "duplicate_email");
    }
    throw error;
  }
}