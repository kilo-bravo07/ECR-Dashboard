/**
 * Diagnostic endpoint: validates users + sessions for two date ranges side-by-side.
 * Useful for verifying YoY click-to-session ratio data.
 *
 * Usage:
 *   /api/debug-sessions?property=floweraura-web&start=2026-11-16&end=2026-11-22&cstart=2025-11-16&cend=2025-11-22
 */
import { NextRequest, NextResponse } from "next/server";
import { getProperty } from "@/lib/properties";
import { getPropertyId, ga4Auth } from "@/lib/data-providers/ga4-config";
import { handleApiError } from "@/lib/api-utils";
import { OAuth2Client } from "google-auth-library";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const propertyKey = sp.get("property") ?? "floweraura-web";
    const start = sp.get("start") ?? "";
    const end = sp.get("end") ?? "";
    const cstart = sp.get("cstart") ?? "";
    const cend = sp.get("cend") ?? "";

    const property = getProperty(propertyKey as never);
    const propertyId = getPropertyId(property);

    if (!propertyId) {
      return NextResponse.json({ error: "Property not configured" }, { status: 400 });
    }

    let analyticsClient: BetaAnalyticsDataClient;
    if (ga4Auth.oauthClientId && ga4Auth.oauthClientSecret && ga4Auth.oauthRefreshToken) {
      const oauth2Client = new OAuth2Client(ga4Auth.oauthClientId, ga4Auth.oauthClientSecret);
      oauth2Client.setCredentials({ refresh_token: ga4Auth.oauthRefreshToken });
      analyticsClient = new BetaAnalyticsDataClient({ authClient: oauth2Client as never });
    } else {
      return NextResponse.json({ error: "No auth configured" }, { status: 400 });
    }

    const dateRanges = [{ startDate: start, endDate: end, name: "current" }];
    if (cstart && cend) {
      dateRanges.push({ startDate: cstart, endDate: cend, name: "comparison" });
    }

    const [resp] = await analyticsClient.runReport({
      property: `properties/${propertyId}`,
      dateRanges,
      dimensions: [{ name: "dateRange" }],
      metrics: [
        { name: "totalUsers" },
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "sessionsPerUser" },
      ],
    });

    const results: Record<string, {
      totalUsers: number;
      activeUsers: number;
      sessions: number;
      sessionsPerUser: number;
      sessionToUserRatioPct: string;
    }> = {};

    for (const row of resp?.rows ?? []) {
      const rangeName = row.dimensionValues?.[0]?.value ?? "unknown";
      const totalUsers = Number(row.metricValues?.[0]?.value ?? 0);
      const activeUsers = Number(row.metricValues?.[1]?.value ?? 0);
      const sessions = Number(row.metricValues?.[2]?.value ?? 0);
      const sessionsPerUser = Number(row.metricValues?.[3]?.value ?? 0);
      results[rangeName] = {
        totalUsers,
        activeUsers,
        sessions,
        sessionsPerUser,
        sessionToUserRatioPct: totalUsers > 0
          ? ((sessions / totalUsers) * 100).toFixed(1) + "%"
          : "n/a",
      };
    }

    return NextResponse.json({
      property: propertyKey,
      current: { range: { start, end }, ...results["current"] },
      comparison: cstart && cend
        ? { range: { start: cstart, end: cend }, ...results["comparison"] }
        : null,
      note: "sessionToUserRatioPct = sessions / totalUsers × 100 (matches click-to-session ratio in email)",
    });
  } catch (err) {
    return handleApiError(err);
  }
}
