import * as z from 'zod';
/** Login can validate its own small contract without loading the content/editor API graph. */
export const accountProof=z.object({password:z.string().min(1).max(1024),code:z.string().max(100).optional()});
export const sessionResult=z.object({authenticated:z.boolean(),initialized:z.boolean(),version:z.string(),accountLinks:z.literal(true).optional()});
export const loginBody=accountProof.extend({username:z.string().max(64).optional()});
export const loginResult=z.object({authenticated:z.literal(true)});
export const logoutResult=z.object({ok:z.literal(true)});
export const apiErrorSchema=z.object({error:z.string(),details:z.unknown().optional()});
export const accountAccessBody=z.object({token:z.string().regex(/^[a-f0-9]{64}$/)});
export const accountAccessResult=z.object({mode:z.enum(['initialize','reset']),expiresAt:z.string(),username:z.string(),twoFactorEnabled:z.boolean(),resetTwoFactor:z.boolean()});
export const completeAccountAccessBody=accountAccessBody.extend({username:z.string().min(3).max(64),password:z.string().min(1).max(1024),confirmPassword:z.string().min(1).max(1024)});
export const completeAccountAccessResult=z.object({ok:z.literal(true),username:z.string(),adminPath:z.string()});
export const anonymousSessionOperations=['session','login','accountAccess','completeAccountAccess'] as const;
