/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { actionAuditLog, db } from "@server/db";
import { registry } from "@server/openApi";
import { NextFunction } from "express";
import { Request, Response } from "express";
import { eq, gt, lt, and, count } from "drizzle-orm";
import { OpenAPITags } from "@server/openApi";
import { z } from "zod";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { fromError } from "zod-validation-error";
import { QueryActionAuditLogResponse } from "@server/routers/auditLogs/types";
import response from "@server/lib/response";
import logger from "@server/logger";

export const queryActionAuditLogsQuery = z.object({
    // iso string just validate its a parseable date
    timeStart: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            message: "timeStart must be a valid ISO date string"
        })
        .transform((val) => Math.floor(new Date(val).getTime() / 1000)),
    timeEnd: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            message: "timeEnd must be a valid ISO date string"
        })
        .transform((val) => Math.floor(new Date(val).getTime() / 1000))
        .optional()
        .default(new Date().toISOString()),
    action: z.string().optional(),
    actorType: z.string().optional(),
    actorId: z.string().optional(),
    actor: z.string().optional(),
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.number().int().positive()),
    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.number().int().nonnegative())
});

export const queryActionAuditLogsParams = z.object({
    orgId: z.string()
});

export const queryActionAuditLogsCombined =
    queryActionAuditLogsQuery.merge(queryActionAuditLogsParams);
type Q = z.infer<typeof queryActionAuditLogsCombined>;

function getWhere(data: Q) {
    return and(
        gt(actionAuditLog.timestamp, data.timeStart),
        lt(actionAuditLog.timestamp, data.timeEnd),
        eq(actionAuditLog.orgId, data.orgId),
        data.actor ? eq(actionAuditLog.actor, data.actor) : undefined,
        data.actorType ? eq(actionAuditLog.actorType, data.actorType) : undefined,
        data.actorId ? eq(actionAuditLog.actorId, data.actorId) : undefined,
        data.action ? eq(actionAuditLog.action, data.action) : undefined
    );
}

export function queryAction(data: Q) {
    return db
        .select({
            orgId: actionAuditLog.orgId,
            action: actionAuditLog.action,
            actorType: actionAuditLog.actorType,
            metadata: actionAuditLog.metadata,
            actorId: actionAuditLog.actorId,
            timestamp: actionAuditLog.timestamp,
            actor: actionAuditLog.actor
        })
        .from(actionAuditLog)
        .where(getWhere(data))
        .orderBy(actionAuditLog.timestamp);
}

export function countActionQuery(data: Q) {
    const countQuery = db
        .select({ count: count() })
        .from(actionAuditLog)
        .where(getWhere(data));
    return countQuery;
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/action",
    description: "Query the action audit log for an organization",
    tags: [OpenAPITags.Org],
    request: {
        query: queryActionAuditLogsQuery,
        params: queryActionAuditLogsParams
    },
    responses: {}
});

export async function queryActionAuditLogs(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = queryActionAuditLogsQuery.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }
        const parsedParams = queryActionAuditLogsParams.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }

        const data = { ...parsedQuery.data, ...parsedParams.data };

        const baseQuery = queryAction(data);

        const log = await baseQuery.limit(data.limit).offset(data.offset);

        const totalCountResult = await countActionQuery(data);
        const totalCount = totalCountResult[0].count;

        return response<QueryActionAuditLogResponse>(res, {
            data: {
                log: log,
                pagination: {
                    total: totalCount,
                    limit: data.limit,
                    offset: data.offset
                }
            },
            success: true,
            error: false,
            message: "Action audit logs retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
