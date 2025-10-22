import { db, requestAuditLog } from "@server/db";
import logger from "@server/logger";

/** 

Reasons:
100 - Allowed by Rule
101 - Allowed No Auth
102 - Valid Access Token
103 - Valid header auth
104 - Valid Pincode
105 - Valid Password
106 - Valid email
107 - Valid SSO

201 - Resource Not Found
202 - Resource Blocked
203 - Dropped by Rule
204 - No Sessions
205 - Temporary Request Token
299 - No More Auth Methods

 */

export async function logRequestAudit(
    data: {
        action: boolean;
        reason: number;
        resourceId?: number;
        orgId?: string;
        location?: string;
        user?: { username: string; userId: string; };
        apiKey?: { name: string | null; apiKeyId: string; };
        metadata?: any;
        // userAgent?: string;
    },
    body: {
        path: string;
        originalRequestURL: string;
        scheme: string;
        host: string;
        method: string;
        tls: boolean;
        sessions?: Record<string, string>;
        headers?: Record<string, string>;
        query?: Record<string, string>; 
        requestIp?: string;
    }
) {
    try {
        let actorType: string | undefined;
        let actor: string | undefined;
        let actorId: string | undefined;

        const user = data.user;
        if (user) {
            actorType = "user";
            actor = user.username;
            actorId = user.userId;
        }
        const apiKey = data.apiKey;
        if (apiKey) {
            actorType = "apiKey";
            actor = apiKey.name || apiKey.apiKeyId;
            actorId = apiKey.apiKeyId;
        }

        // if (!actorType || !actor || !actorId) {
        //     logger.warn("logRequestAudit: Incomplete actor information");
        //     return;
        // }

        const timestamp = Math.floor(Date.now() / 1000);

        let metadata = null;
        if (metadata) {
            metadata = JSON.stringify(metadata);
        }

        const clientIp = body.requestIp
            ? (() => {
                  if (body.requestIp.startsWith("[") && body.requestIp.includes("]")) {
                      // if brackets are found, extract the IPv6 address from between the brackets
                      const ipv6Match = body.requestIp.match(/\[(.*?)\]/);
                      if (ipv6Match) {
                          return ipv6Match[1];
                      }
                  }

                  // ivp4
                  // split at last colon
                  const lastColonIndex = body.requestIp.lastIndexOf(":");
                  if (lastColonIndex !== -1) {
                      return body.requestIp.substring(0, lastColonIndex);
                  }
                  return body.requestIp;
              })()
            : undefined;

        await db.insert(requestAuditLog).values({
            timestamp,
            orgId: data.orgId,
            actorType,
            actor,
            actorId,
            metadata,
            action: data.action,
            resourceId: data.resourceId,
            reason: data.reason,
            location: data.location,
            // userAgent: data.userAgent, // TODO: add this
            // headers: data.body.headers,
            // query: data.body.query,
            originalRequestURL: body.originalRequestURL,
            scheme: body.scheme,
            host: body.host,
            path: body.path,
            method: body.method,
            ip: clientIp,
            tls: body.tls
        });
    } catch (error) {
        logger.error(error);
    }
}
