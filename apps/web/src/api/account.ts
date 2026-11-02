import type { ApiServices, AdminHandlers } from './types.ts';
import { WeavaError } from '@weava/contracts';
async function proof<T>(action:()=>Promise<T>) {
  try { return await action(); } catch(error) {
    if(error instanceof WeavaError && error.status===401) throw new WeavaError(error.message,403,error.details);
    throw error;
  }
}
export function accountHandlers({site}: Pick<ApiServices,'site'>) {
  return {
    account:async (_, context) => site.auth.account(context.cookies.get('weava-session')?.value ?? ''),
    saveAccount:async ({body}, context) => proof(()=>site.auth.updateAccount(body.password, context.identity.network, body)),
    revokeSession:async ({body}, context) => proof(()=>site.auth.revokeSessions(body.password, context.identity.network, body.id, context.cookies.get('weava-session')?.value ?? '', body.code)),
    beginTwoFactor:async ({body}, context) => proof(()=>site.auth.beginTwoFactor(body.password, context.identity.network)),
    confirmTwoFactor:async ({body}, context) => proof(()=>site.auth.confirmTwoFactor(body.password, context.identity.network, body.code)),
    disableTwoFactor:async ({body}, context) => proof(()=>site.auth.disableTwoFactor(body.password, context.identity.network, body.code)),
    renewRecoveryCodes:async ({body},context)=>proof(()=>site.auth.renewRecoveryCodes(body.password,context.identity.network,body.code)),
    changeAdminPath:async ({body},context)=>proof(()=>site.auth.changeAdminPath(body.password,context.identity.network,body.path,body.code)),
    rotateCliToken:async ({body},context)=>proof(()=>site.auth.rotateCredentials(body.password,context.identity.network,body.revokeSessions,body.code)),
  } satisfies Pick<AdminHandlers,'account'|'saveAccount'|'revokeSession'|'beginTwoFactor'|'confirmTwoFactor'|'disableTwoFactor'|'renewRecoveryCodes'|'changeAdminPath'|'rotateCliToken'>;
}
