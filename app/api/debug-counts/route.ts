/**
 * Diagnostic endpoint: returns raw per-event GA4 counts (activeUsers AND
 * totalUsers) for the requested property and date range, so you can compare
 * them directly with any GA4 Explorer or custom report to identify metric
 * discrepancies.
 *
 * Usage:
 *   /api/debug-counts?property=floweraura-app&start=2026-11-19&end=2026-11-19
 */
import { NextRequest, NextResponse } from "next/server";
import { getProperty } from "@/lib/properties";
import { getPropertyId, ga4Auth } from "@/lib/data-providers/ga4-config";
import { handleApiError, parseQuery } from "@/lib/api-utils";
import { OAuth2Client } from "google-auth-library";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const query = parseQuery(req.nextUrl.searchParams);
    const property = getProperty(query.property);
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

    // Collect all event names from both funnels
    const eventNames: string[] = [
      property.shopping.root.ga4EventName,
      ...property.shopping.stages.map((s) => s.ga4EventName),
      property.checkout.root.ga4EventName,
      ...property.checkout.stages.map((s) => s.ga4EventName),
    ];
    const uniqueEvents = [...new Set(eventNames)];

    const [activeResp, totalResp] = await Promise.all([
      analyticsClient.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: query.range.start, endDate: query.range.end }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "activeUsers" }],
        dimensionFilter: {
          filter: { fieldName: "eventName", inListFilter: { values: uniqueEvents } },
        },
        limit: 1000,
      }),
      analyticsClient.runReport({
        property: `properties/${propertyId}`,
        dateRanges: [{ startDate: query.range.start, endDate: query.range.end }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: {
          filter: { fieldName: "eventName", inListFilter: { values: uniqueEvents } },
        },
        limit: 1000,
      }),
    ]);

    const activeMap: Record<string, number> = {};
    for (const row of activeResp[0]?.rows ?? []) {
      const event = row.dimensionValues?.[0]?.value ?? "";
      activeMap[event] = Number(row.metricValues?.[0]?.value ?? 0);
    }
    const totalMap: Record<string, number> = {};
    for (const row of totalResp[0]?.rows ?? []) {
      const event = row.dimensionValues?.[0]?.value ?? "";
      totalMap[event] = Number(row.metricValues?.[0]?.value ?? 0);
    }

    const rows = uniqueEvents.map((event) => ({
      event,
      activeUsers: activeMap[event] ?? 0,
      totalUsers: totalMap[event] ?? 0,
    }));

    // Compute ECR both ways for quick comparison
    const checkoutRoot = property.checkout.root.ga4EventName;
    const orderEvent = property.checkout.stages.at(-1)?.ga4EventName ?? "";

    const ecrActive =
      activeMap[checkoutRoot] && activeMap[orderEvent]
        ? ((activeMap[orderEvent] / activeMap[checkoutRoot]) * 100).toFixed(2) + "%"
        : "n/a";
    const ecrTotal =
      totalMap[checkoutRoot] && totalMap[orderEvent]
        ? ((totalMap[orderEvent] / totalMap[checkoutRoot]) * 100).toFixed(2) + "%"
        : "n/a";

    return NextResponse.json({
      property: property.key,
      range: query.range,
      checkoutEcr: {
        numeratorEvent: orderEvent,
        denominatorEvent: checkoutRoot,
        activeUsers: ecrActive,
        totalUsers: ecrTotal,
      },
      events: rows,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
